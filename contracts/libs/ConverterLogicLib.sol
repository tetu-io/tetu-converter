// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPoolAdapter.sol";

/// @notice TetuConverter-app logic-related utils
library ConverterLogicLib {
  enum HealthStatus {
    /// @notice Healthy (normal), threshold < health factor. It's ok to make new borrow using the pool adapter
    NORMAL_0,
    /// @notice Unhealthy, health factor < 1. It means that liquidation happens and the pool adapter is not usable.
    DIRTY_1,
    /// @notice Unhealthy, 1 < health factor < threshold. It means, that rebalance is required ASAP
    REBALANCE_REQUIRED_2
  }

  /// @notice Get borrow/collateral amount required to rebalance and move {healthFactor18} => {targetHealthFactor18}
  ///         Results amount will be negative if healthFactor18 > targetHealthFactor18
  ///         and so we need to make additional borrow for the exist collateral.
  /// @param targetHealthFactor18 Health factor of collateral asset, decimals 18
  /// @param collateralAmount Current collateral amount of the given pool adapter
  /// @param amountToPay Current debts amount of the given pool adapter
  /// @param healthFactor18 Current health factor of the given pool adapter
  /// @param requiredCollateralAssetAmount Amount of collateral asset required for rebalancing.
  ///        Positive amount means, that such amount should be send to the pool adapter to restore health to the target factor
  ///        Negative amount means, that such collateral amount can be redeemed from the lending platform without repay
  /// @param requiredBorrowAssetAmount Amount of borrow asset required for rebalancing
  ///        Positive amount means, that this amount should be send to the pool adapter to restore health to the target factor
  ///        Negative amount means, that is can be borrowed in addition without adding new collateral.
  function getRebalanceAmounts(
    uint targetHealthFactor18,
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18
  ) internal pure returns (
    int requiredCollateralAssetAmount,
    int requiredBorrowAssetAmount
  ) {
    // If full liquidation happens we will have collateralAmount = 0 and amountToPay > 0
    // In this case the open position should be just closed (we lost all collateral)
    // We cannot do it here because it's read-only function.
    // We should call a IKeeperCallback in the same way as for rebalancing, but with requiredAmountCollateralAsset=0

    // Health Factor = Collateral Factor * CollateralAmount * Price_collateral / (BorrowAmount * Price_borrow)
    // => requiredAmountBorrowAsset = BorrowAmount * (HealthFactorCurrent/HealthFactorTarget - 1)
    // => requiredAmountCollateralAsset = CollateralAmount * (HealthFactorTarget/HealthFactorCurrent - 1)
    requiredBorrowAssetAmount = (int(amountToPay) - int(amountToPay * healthFactor18 / targetHealthFactor18));
    requiredCollateralAssetAmount = (int(collateralAmount * targetHealthFactor18 / healthFactor18) - int(collateralAmount));
  }

  /// @notice Check health of the given pool adapter
  /// @param requiredBorrowAssetAmount Amount of borrow asset that should be send to the pool adapter to restore health to the target factor
  /// @param requiredCollateralAssetAmount Amount of collateral asset that should be send to the pool adapter to restore health to the target factor
  function checkPositionHealth(IPoolAdapter pa, IBorrowManager borrowManager, uint minHealthFactor18) internal view returns (
    uint requiredBorrowAssetAmount,
    uint requiredCollateralAssetAmount
  ) {
    (,,address collateralAsset,) = pa.getConfig();
    uint healthFactorTarget18 = uint(borrowManager.getTargetHealthFactor2(collateralAsset)) * 10 ** (18 - 2);

    (uint collateralAmount, uint amountToPay, uint healthFactor18,,,) = pa.getStatus();

    if (_isPositionUnhealthy(healthFactor18, healthFactorTarget18, minHealthFactor18)) {
      (int borrow, int collateral) = getRebalanceAmounts(healthFactorTarget18, collateralAmount, amountToPay, healthFactor18);
      // if borrow/collateral amounts are negative
      // it means, that we can borrow additional amount without adding new collateral
      // there are no problems with the health in this case
      return (borrow > 0 ? uint(borrow) : 0, collateral > 0 ? uint(collateral) : 0);
    } else {
      return (requiredBorrowAssetAmount, requiredCollateralAssetAmount);
    }
  }

  /// @notice Check health status of the pool adapter
  /// @param healthFactor18 Current health factor of the pool adapter, decimals 18
  /// @param minHealthFactor2 Min allowed health factor, decimals 2
  /// @return HealthStatus Health status of the pool adapter
  function getHealthStatus(uint healthFactor18, uint16 minHealthFactor2) internal pure returns (HealthStatus) {
    if (healthFactor18 < 1e18) {
      // the pool adapter is unhealthy, we should mark it as dirty and create new pool adapter for the borrow
      return HealthStatus.DIRTY_1;
    } else if (healthFactor18 <= (uint(minHealthFactor2) * 10 ** (18 - 2))) {
      // the pool adapter is unhealthy, a rebalance is required ASAP to prevent the liquidation
      return HealthStatus.REBALANCE_REQUIRED_2;
    }

    return HealthStatus.NORMAL_0;
  }

  /// @notice Check if the position is unhealthy
  /// @param healthFactor Current health factor of the pool adapter
  /// @param targetHealthFactor Target health factor of the collateral asset of the given pool adapter
  /// @param minHealthFactor Min allowed health factor
  function _isPositionUnhealthy(uint healthFactor, uint targetHealthFactor, uint minHealthFactor) internal pure returns (bool) {
    targetHealthFactor; // hide warning
    return healthFactor <= minHealthFactor;
  }
}