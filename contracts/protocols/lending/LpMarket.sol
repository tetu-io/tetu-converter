// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../interfaces/ILendingPlatform.sol";
import "../../third_party/market/ICErc20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/SafeERC20.sol";

/// @notice Lending Platform Market-XYZ, see https://docs.market.xyz/
contract LpMarket is ILendingPlatform {
  using SafeERC20 for IERC20;


  /// @notice Return a plan of possible most efficient borrowing strategy
  /// @notice sourceAsset An asset for collateral
  /// @notice amountSourceAsset Max allowed amount of the source asset that can be used as collateral
  /// @notice targetAsset An asset that should be borrowed
  /// @notice amountTargetAsset Required amount of the target asset
  /// @notice lendingPeriodInBlocks Approx period of borrowing in ethereum blocks
  /// @notice params Required health factor, possible range of collateral factor and so on
  /// @return outPlan Optimal pool to borrow from
  /// @return outEstimatedAmountToRepay Estimated amount of target asset to be repaid in {lendingPeriodInBlocks}
  /// @return outErrorMessage Possible reason why the plan wasn't built. Empty for success
  function buildBorrowPlan(
    address sourceAsset,
    uint amountSourceAsset,
    address targetAsset,
    uint amountTargetAsset,
    uint lendingPeriodInBlocks,
    uint params
  ) external view override returns (
    PoolData memory outPlan,
    uint outEstimatedAmountToRepay,
    string memory outErrorMessage
  ) {
    // get all suitable pools that can provide allowed amount
    // select a pool with best conditions

    return (outPlan, outEstimatedAmountToRepay, outErrorMessage);
  }
}
