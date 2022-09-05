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
  function getAprForPeriod18(
    uint amount,
    uint price18,
    uint currentN,
    uint currentLiquidityIndex,
    uint rate,
    uint countBlocks,
    uint blocksPerDay_,
    uint amountDecimals_
  ) internal view returns (uint) {
    console.log("getAprForPeriod18");
    console.log("amount", amount);
    console.log("price18", price18);
    console.log("currentLiquidityIndex", currentLiquidityIndex);
    console.log("currentN", currentN);
    console.log("rate", rate);
    console.log("countBlocks", countBlocks);
    console.log("blocksPerDay_", blocksPerDay_);
    uint scaledBalance0 = amount * RAY / currentN;
    console.log("scaledBalance0", scaledBalance0);
    uint nextN = rayMul(RAY
      + rate * (
        // count seconds
        countBlocks * COUNT_SECONDS_PER_YEAR / (blocksPerDay_ * 365)
      ) / COUNT_SECONDS_PER_YEAR, currentLiquidityIndex);
    console.log("nextN", nextN);
    uint userBalance0 = scaledBalance0 * currentN * price18 / RAY / 1e18;
    uint userBalance1 = scaledBalance0 * nextN * price18 / RAY / 1e18;
    console.log("userBalance0", userBalance0);
    console.log("userBalance1", userBalance1);
    console.log("countBlocks * COUNT_SECONDS_PER_YEAR / (blocksPerDay_ * 365)", countBlocks * COUNT_SECONDS_PER_YEAR / (blocksPerDay_ * 365));
    console.log("userBalanceDeltaBase", userBalance1 - userBalance0);
    console.log("userBalanceDelta", (userBalance1 - userBalance0) * 1e18 / price18);
    return userBalance1 - userBalance0;
  }

  function rayMul(uint x, uint y) internal pure returns (uint) {
    return (x * y + HALF_RAY) / RAY;
  }
}