// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IAccountant {
  /// @notice Register a new loan
  /// @dev This function can be called by a pool adapter only
  /// @param collateralAmount Amount of supplied collateral for the new loan
  /// @param borrowedAmount Borrowed amount provided for the given {collateralAmount}
  function onBorrow(uint collateralAmount, uint borrowedAmount) external;

  /// @notice Register loan payment
  /// @dev This function can be called by a pool adapter only
  /// @param withdrawnCollateral Amount of collateral received by the user during the repaying.
  /// @param paidAmount Amount paid by the user during the repaying.
  function onRepay(uint withdrawnCollateral, uint paidAmount) external;

}