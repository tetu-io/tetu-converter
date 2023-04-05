// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../aaveShared/AaveSharedLib.sol";
import "../../libs/AppErrors.sol";
import "../../integrations/aaveTwo/IAaveTwoReserveInterestRateStrategy.sol";
import "../../integrations/aaveTwo/IAaveTwoPriceOracle.sol";
import "../../integrations/aaveTwo/IAaveTwoPool.sol";
import "../../integrations/aaveTwo/AaveTwoReserveConfiguration.sol";
import "../../integrations/aaveTwo/IAaveTwoAToken.sol";
import "../../integrations/aaveTwo/IAaveTwoStableDebtToken.sol";
import "../../integrations/aaveTwo/IAaveTwoProtocolDataProvider.sol";
import "../../integrations/aaveTwo/IAaveTwoLendingPoolAddressesProvider.sol";

/// @notice Library for AAVE v2 to calculate APR: borrow APR and supply APR
library AaveTwoAprLib {
  using AaveTwoReserveConfiguration for DataTypes.ReserveConfigurationMap;

  /// @notice https://docs.aave.com/developers/v/2.0/the-core-protocol/protocol-data-provider
  ///        Each market has a separate Protocol Data Provider.
  ///        To get the address for a particular market, call getAddress() using the value 0x1.
  uint internal constant ID_DATA_PROVIDER = 0x1000000000000000000000000000000000000000000000000000000000000000;

  //-----------------------------------------------------
  // Calculate borrow and liquidity rate in advance
  // in same way as in AAVE v2 protocol
  //-----------------------------------------------------

  /// @notice Calculate estimate variable borrow rate after borrowing {amountToBorrow_}
  /// @dev See explanations in Aave3AprLib.sol
  function getVariableBorrowRateRays(
    DataTypes.ReserveData memory rb_,
    address borrowAsset_,
    uint amountToBorrow_,
    uint totalStableDebt_,
    uint totalVariableDebt_
  ) internal view returns (uint) {
    if (amountToBorrow_ == 0) {
      return rb_.currentVariableBorrowRate;
    }

    uint factor = rb_.configuration.getReserveFactor();
    // see aave-v2-core, DefaultReserveInterestRateStrategy, calculateInterestRates impl
    // to calculate new BR, we need to reduce liquidity on borrowAmount and increase the debt on the same amount
    (,, uint variableBorrowRateRays) = IAaveTwoReserveInterestRateStrategy(
      rb_.interestRateStrategyAddress
    ).calculateInterestRates(
        borrowAsset_,
        rb_.aTokenAddress,
        0,
        amountToBorrow_,
        totalStableDebt_,
        totalVariableDebt_ + amountToBorrow_,
        // we can pass dummy value here, because averageStableBorrowRate is not used in variableBorrowRate-calculations
        rb_.currentStableBorrowRate,
        factor
      );

    return variableBorrowRateRays;
  }

  /// @notice calculate liquidityRate for collateral token after supplying {amountToSupply_} in terms of borrow tokens
  function getLiquidityRateRays(
    DataTypes.ReserveData memory rc_,
    address collateralAsset_,
    uint amountToSupply_,
    uint totalStableDebt_,
    uint totalVariableDebt_
  ) internal view returns (uint) {
    // see aave-v3-core, ReserveLogic.sol, updateInterestRates
    (, uint avgStableRate) = IAaveTwoStableDebtToken(rc_.stableDebtTokenAddress).getTotalSupplyAndAvgRate();

    // see aave-v3-core, DefaultReserveInterestRateStrategy, calculateInterestRates impl
    uint factor = rc_.configuration.getReserveFactor();
    (uint liquidityRateRays,,) = IAaveTwoReserveInterestRateStrategy(rc_.interestRateStrategyAddress)
      .calculateInterestRates(
        collateralAsset_,
        rc_.aTokenAddress,
        amountToSupply_,
        0,
        totalStableDebt_,
        totalVariableDebt_,
        avgStableRate,
        factor
      );

    return liquidityRateRays;
  }

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  function getBorrowRateAfterBorrow(
    address pool_,
    address borrowAsset_,
    uint amountToBorrow_
  ) internal view returns (uint) {
    IAaveTwoPool pool = IAaveTwoPool(pool_);
    DataTypes.ReserveData memory rb = pool.getReserveData(borrowAsset_);

    (, uint totalStableDebt, uint totalVariableDebt,,,,,,,) = IAaveTwoProtocolDataProvider(
      IAaveTwoLendingPoolAddressesProvider(pool.getAddressesProvider()).getAddress(bytes32(ID_DATA_PROVIDER))
    ).getReserveData(borrowAsset_);

    return AaveTwoAprLib.getVariableBorrowRateRays(
      rb,
      borrowAsset_,
      amountToBorrow_,
      totalStableDebt,
      totalVariableDebt
    );
  }
}
