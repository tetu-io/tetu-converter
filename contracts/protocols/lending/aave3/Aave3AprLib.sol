// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../../integrations/aave3/IAaveReserveInterestRateStrategy.sol";
import "../../../integrations/aave3/IAavePriceOracle.sol";
import "../../../core/AppErrors.sol";
import "../../../integrations/aave3/IAavePool.sol";
import "../../../integrations/aave3/IAaveToken.sol";
import "../../../integrations/aave3/IAaveStableDebtToken.sol";
import "../../../integrations/aave3/Aave3ReserveConfiguration.sol";
import "hardhat/console.sol";

/// @notice Library for AAVE v2 to calculate APR: borrow APR and supply APR
library Aave3AprLib {
  using Aave3ReserveConfiguration for Aave3DataTypes.ReserveConfigurationMap;

  uint constant public COUNT_SECONDS_PER_YEAR = 365 days; // 31536000;
  uint constant public RAY = 1e27;
  uint constant public HALF_RAY = 0.5e27;

  struct State {
    uint reserveNormalized;
    uint liquidityIndex;
    uint lastUpdateTimestamp;
    uint rate;
  }

  //////////////////////////////////////////////////////////////////////////
  /// Calculate borrow and liquidity rate - in same way as in AAVE v3 protocol
  ///
  /// See ReserveLogic.sol getNormalizedIncome implementation
  /// Function getNormalizedIncome/getNormalizedDebt return income-ratios
  ///     "A value of 1e27 means there is no debt/income. As time passes, the debt/income is accrued"
  ///     "A value of 2*1e27 means that for each unit of debt/income, one unit worth of interest has been accumulated"
  /// The functions are implemented like following:
  ///     return 0.5 + index * (1 + RATE * dT / (Sy * 1e27))
  /// where
  ///     RATE is liquidity-rate or variable-borrow-rate
  ///     index is liquidityIndex or variableBorrowIndex
  ///     dt is time in seconds
  ///     Sy = seconds per year
  /// So, we can use RATE to calculate APR (for borrow or supply)
  /// because following expression
  ///     (RATE * dT / (Sy * 1e27)) * amount
  /// gives us increment of the amount for period dt (in seconds)
  ///
  /// BUT: we need APR per block, not per second
  /// So, we need to recalculate APR from seconds to blocks
  /// As result, we can rewrite above formula as following:
  ///    APR-sec = RATE * dT / (Sy * 1e27)
  ///    APR-block = RATE * dB / (Sy * 1e27) * blocks-per-day * 365 / Sy
  ///       where dB is period in blocks
  /// or we can re-write it as following
  ///   APR-block = RATE * dB / 1e27 * blocks-per-day * 365 / Sy / Sy
  ///             = RATE * dB / 1e27 * aprFactor
  /// also we need to add mantissa 1e18
  ///   APR-block = RATE * dB / 1e27 * blocks-per-day * 365 / Sy / Sy * 1e18
  ///             = RATE * dB / 1e27 * aprFactor18
  ///
  /// Functions getNormalizedIncome and getNormalizedDebt are different, they use
  ///       calculateLinearInterest and calculateCompoundedInterest
  /// We need to calculate APR for 1 block, so we use linear formula in both cases.
  //////////////////////////////////////////////////////////////////////////

  function getAprFactor18(uint blocksPerDay_) internal pure returns (uint) {
    return (blocksPerDay_ * 365) // total count blocks in the year
      * 10**18
      / COUNT_SECONDS_PER_YEAR
      / COUNT_SECONDS_PER_YEAR
    ;
  }

  function getVariableBorrowRateRays(
    Aave3DataTypes.ReserveData memory rb_,
    address borrowAsset_,
    uint amountToBorrow_,
    uint totalStableDebt_,
    uint totalVariableDebt_
  ) internal view returns (uint) {
    if (amountToBorrow_ == 0) {
      return rb_.currentVariableBorrowRate;
    }

    // see aave-v2-core, DefaultReserveInterestRateStrategy, calculateInterestRates impl
    // to calculate new BR, we need to reduce liquidity on borrowAmount and increase the debt on the same amount
    (,, uint variableBorrowRateRays) = IAaveReserveInterestRateStrategy(
      rb_.interestRateStrategyAddress
    ).calculateInterestRates(
      Aave3DataTypes.CalculateInterestRatesParams({
        unbacked: 0, // this value is not used to calculate variable BR
        liquidityAdded: 0,
        liquidityTaken: amountToBorrow_,
        totalStableDebt: totalStableDebt_,
        totalVariableDebt: totalVariableDebt_ + amountToBorrow_,
        // we can pass dummy value here, because averageStableBorrowRate is not used in variableBorrowRate-calculations
        averageStableBorrowRate: rb_.currentStableBorrowRate,
        reserveFactor: rb_.configuration.getReserveFactor(),
        reserve: borrowAsset_,
        aToken: rb_.aTokenAddress
      })
    );

    return variableBorrowRateRays;
  }

  /// @notice calculate liquidityRate for collateral token after supplying {amountToSupply_}
  function getLiquidityRateRays(
    Aave3DataTypes.ReserveData memory rc_,
    address collateralAsset_,
    uint amountToSupply_,
    uint totalStableDebt_,
    uint totalVariableDebt_
  ) internal view returns (uint) {
    // see aave-v3-core, ReserveLogic.sol, updateInterestRates
    (, uint avgStableRate) = IAaveStableDebtToken(rc_.stableDebtTokenAddress).getTotalSupplyAndAvgRate();

    // see aave-v3-core, DefaultReserveInterestRateStrategy, calculateInterestRates impl
    (uint liquidityRateRays,,) = IAaveReserveInterestRateStrategy(
      rc_.interestRateStrategyAddress
    ).calculateInterestRates(
      Aave3DataTypes.CalculateInterestRatesParams({
        unbacked: rc_.unbacked,
        liquidityAdded: amountToSupply_,
        liquidityTaken: 0,
        totalStableDebt: totalStableDebt_,
        totalVariableDebt: totalVariableDebt_,
        averageStableBorrowRate: avgStableRate,
        reserveFactor: rc_.configuration.getReserveFactor(),
        reserve: collateralAsset_,
        aToken: rc_.aTokenAddress
      })
    );

    return liquidityRateRays;
  }

  //////////////////////////////////////////////////////////////////////////
  // APR for period = result income/debt in period
  //                  without any compound
  // APR = user-balance-after - user-balance-before
  // where user-balance = scaled-user-balance * N * price
  // So,
  //      APR = (SB_1 - SB_0) * N * price
  // where N = normalized income / debt (for collateral / borrow)
  //       N = rayMul(RAY + rate * dT / Sy, LI)
  //       rayMul(x, y) => (x * y + HALF_RAY) / RAY
  // where Sy = seconds per year = 31536000
  //       dT = period in seconds
  //       LI = liquidity index
  //
  // Assume
  //       SB_0 ~ Amount / N_current
  // where amount is amount to supply/borrow.
  //
  // So, APR ~ func(amount, N_current, dT, LI_current, price)
  //////////////////////////////////////////////////////////////////////////

  /// @notice Calculate APR for period {countBlocks} in the point AFTER supply/borrow operation
  ///         APR is total amount of generated income/debt for the period in the terms of amount's asset
  /// @param amount Amount of collateral or borrow
  /// @param reserveNormalized Current value of normalized income / debt
  /// @param liquidityIndex Value of liquidityIndex / variableBorrowIndex
  /// @param predictedRate Predicted value of liquidity/borrow rate
  /// @param countBlocks Duration of the period in blocks
  /// @param blocksPerDay Count blocks per day (about 40 ths)
  /// @param price18 Price of collateral/borrow asset
  ///                1 token of the amount costs {price18} base tokens
  function getAprForPeriodAfter(
    uint amount,
    uint reserveNormalized,
    uint liquidityIndex,
    uint predictedRate,
    uint countBlocks,
    uint blocksPerDay,
    uint price18
  ) internal pure returns (int) {
    // calculate income/debt in the period of {countBlocks} since the supply/borrow operation
    uint reserveNormalizedAfterPeriod = rayMul(
      RAY + predictedRate * (
        countBlocks * COUNT_SECONDS_PER_YEAR / (blocksPerDay * 365)  // count seconds
      ) / COUNT_SECONDS_PER_YEAR,
        liquidityIndex
    );

    return int(amount)
      * (int(reserveNormalizedAfterPeriod) - int(reserveNormalized))
      * int(price18) / 1e18
      / int(reserveNormalized);
  }

  /// @notice Calculate APR for period {countBlocks} in the point before the supply/borrow operation
  ///         APR is total amount of generated income/debt for the period in the terms of amount's asset
  /// @param amount Amount of collateral or borrow
  /// @param state Current state (before the supply/borrow operation)
  /// @param predictedRate Predicted value of liquidity/borrow rate
  /// @param countBlocks Duration of the period in blocks
  /// @param blocksPerDay Count blocks per day (about 40 ths)
  /// @param price18 Price of collateral/borrow asset
  ///                1 token of the amount costs {price18} base tokens
  function getAprForPeriodBefore(
    State memory state,
    uint amount,
    uint predictedRate,
    uint countBlocks,
    uint blocksPerDay,
    uint price18,
    uint operationTimestamp
  ) internal pure returns (int) {
    // recalculate reserveNormalized and liquidityIndex
    // after the supply/borrow operation
    uint liquidityIndexAfter = rayMul(
      RAY + (state.rate * (operationTimestamp - state.lastUpdateTimestamp) / COUNT_SECONDS_PER_YEAR),
      state.liquidityIndex
    );

    return getAprForPeriodAfter(
      amount,
      liquidityIndexAfter, // reserveNormalizedAfter is the same as liquidityIndexAfter
      liquidityIndexAfter,
      predictedRate,
      countBlocks,
      blocksPerDay,
      price18
    );
  }

  function rayMul(uint x, uint y) internal pure returns (uint) {
    return (x * y + HALF_RAY) / RAY;
  }
}