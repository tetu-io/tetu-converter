// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../../integrations/aaveTwo/IAaveTwoReserveInterestRateStrategy.sol";
import "../../../integrations/aaveTwo/IAaveTwoPriceOracle.sol";
import "../../../core/AppErrors.sol";
import "../../../integrations/aaveTwo/IAaveTwoPool.sol";
import "../../../integrations/aaveTwo/AaveTwoReserveConfiguration.sol";
import "../../../integrations/aaveTwo/IAaveTwoAToken.sol";
import "../../../integrations/aaveTwo/IAaveTwoStableDebtToken.sol";

/// @notice Library for AAVE v2 to calculate APR: borrow APR and supply APR
library AaveTwoAprLib {
  using AaveTwoReserveConfiguration for DataTypes.ReserveConfigurationMap;

  uint constant public COUNT_SECONDS_PER_YEAR = 31536000;

  function getAprFactor18(uint blocksPerDay_) internal pure returns (uint) {
    return blocksPerDay_ * 365
      / 10**18
      / COUNT_SECONDS_PER_YEAR
      / COUNT_SECONDS_PER_YEAR;
  }

  function getBorrowApr18(
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
    (,, uint variableBorrowRate) = IAaveTwoReserveInterestRateStrategy(
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

    return variableBorrowRate;
  }

  /// @notice calculate liquidityRate for collateral token after supplying {amountToSupply_} in terms of borrow tokens
  function getSupplyApr18(
    DataTypes.ReserveData memory rc_,
    address collateralAsset_,
    uint amountToSupply_,
    address borrowAsset_,
    uint totalStableDebt_,
    uint totalVariableDebt_,
    address priceOracle_
  ) internal view returns (uint) {
    // see aave-v3-core, ReserveLogic.sol, updateInterestRates
    (, uint avgStableRate) = IAaveTwoStableDebtToken(rc_.stableDebtTokenAddress).getTotalSupplyAndAvgRate();

    // see aave-v3-core, DefaultReserveInterestRateStrategy, calculateInterestRates impl
    uint factor = rc_.configuration.getReserveFactor();
    (uint liquidityRate,,) = IAaveTwoReserveInterestRateStrategy(rc_.interestRateStrategyAddress)
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

    // recalculate liquidityRate to borrow tokens
    address[] memory assets = new address[](2);
    assets[0] = collateralAsset_;
    assets[1] = borrowAsset_;

    uint[] memory prices = IAaveTwoPriceOracle(priceOracle_).getAssetsPrices(assets);
    require(prices[1] != 0, AppErrors.ZERO_PRICE);

    return liquidityRate
      * prices[0]
      / prices[1];
  }
}