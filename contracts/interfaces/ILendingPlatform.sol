// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/DataTypes.sol";

/// @notice A lending platform. Allow to borrow a loan and repay it back.
interface ILendingPlatform {

  /// @notice Estimate borrowing results
  /// @param pool A pool for source OR target assets. We need it to access comptroller.
  /// @return outCollateralAmount Required amount of collateral <= sourceAmount
  /// @return outEstimatedAmountToRepay How much target tokens should be paid at the end of the borrowing
  /// @return outErrorMessage A reason why the borrowing cannot be made; empty for success
  function buildBorrowPlan(
    address pool,
    DataTypes.BorrowParams memory params
  ) external view returns (
    uint outCollateralAmount,
    uint outEstimatedAmountToRepay,
    string memory outErrorMessage
  );
}
