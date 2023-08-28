// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPoolAdapter.sol";

/// @notice TetuConverter-app logic-related utils
library ConverterLogicLib {
  function checkPositionHealth(IPoolAdapter pa, IBorrowManager borrowManager, uint healthFactorThreshold18) internal view returns (
    uint requiredBorrowAssetAmount,
    uint requiredCollateralAssetAmount
  ) {
    (uint collateralAmount, uint amountToPay, uint healthFactor18,,,) = pa.getStatus();
    // If full liquidation happens we will have collateralAmount = 0 and amountToPay > 0
    // In this case the open position should be just closed (we lost all collateral)
    // We cannot do it here because it's read-only function.
    // We should call a IKeeperCallback in the same way as for rebalancing, but with requiredAmountCollateralAsset=0

    (,,address collateralAsset,) = pa.getConfig();

    uint healthFactorTarget18 = uint(borrowManager.getTargetHealthFactor2(collateralAsset)) * 10 ** (18 - 2);

    // check if the position is unhealthy
    if (healthFactorThreshold18 < healthFactorTarget18 && healthFactor18 < healthFactorThreshold18) {
      // Health Factor = Collateral Factor * CollateralAmount * Price_collateral / (BorrowAmount * Price_borrow)
      // => requiredAmountBorrowAsset = BorrowAmount * (HealthFactorCurrent/HealthFactorTarget - 1)
      // => requiredAmountCollateralAsset = CollateralAmount * (HealthFactorTarget/HealthFactorCurrent - 1)
      requiredBorrowAssetAmount = (amountToPay - amountToPay * healthFactor18 / healthFactorTarget18);
      requiredCollateralAssetAmount = (collateralAmount * healthFactorTarget18 / healthFactor18 - collateralAmount);
    }

    return (requiredBorrowAssetAmount, requiredCollateralAssetAmount);
  }
}