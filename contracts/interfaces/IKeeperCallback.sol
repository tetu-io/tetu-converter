// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Keeper sends notifications to TetuConverter using following interface
interface IKeeperCallback {

  /// @notice This function is called by a keeper if there is unhealthy borrow
  ///         The called contract should send either collateral-amount or borrowed-amount to TetuConverter
  /// @param requiredAmountBorrowAsset_ The borrower should return given borrowed amount back to TetuConverter
  ///                                   in order to restore health factor to target value
  /// @param requiredAmountCollateralAsset_ The borrower should send given amount of collateral to TetuConverter
  ///                                       in order to restore health factor to target value
  /// @param lendingPoolAdapter_ Address of the pool adapter that has problem health factor
  function requireRepay(
    uint requiredAmountBorrowAsset_,
    uint requiredAmountCollateralAsset_,
    address lendingPoolAdapter_
  ) external;
}
