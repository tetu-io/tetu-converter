// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../interfaces/ILendingPlatformWrapper.sol";


/// @notice Lending Platform Market-XYZ, see https://docs.market.xyz/
contract LpMarket is ILendingPlatformWrapper {
  /// @notice Return a plan of possible most efficient borrowing strategy
  /// @notice sourceAsset An asset for collateral
  /// @notice amountSourceAsset Max allowed amount of the source asset that can be used as collateral
  /// @notice targetAsset An asset that should be borrowed
  /// @notice amountTargetAsset Required amount of the target asset
  /// @notice lendingPeriodInBlocks Approx period of borrowing in ethereum blocks
  /// @notice params Required health factor, possible range of collateral factor and so on
  /// @return outPlan Encoded plan of the borrow
  /// @return outEstimatedAmountToRepay Estimated amount of target asset to be repaid in {lendingPeriodInBlocks}
  function getBorrowPlan(
    address sourceAsset,
    uint amountSourceAsset,
    address targetAsset,
    uint amountTargetAsset,
    uint lendingPeriodInBlocks,
    uint params
  ) external view override returns (
    uint outPlan,
    uint outEstimatedAmountToRepay
  ) {
    outPlan = 0; // assets-pair is not supported
    outEstimatedAmountToRepay = 0;
  }
}
