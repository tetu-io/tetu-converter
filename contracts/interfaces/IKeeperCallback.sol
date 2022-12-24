// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

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

  // TODO for next versions of the application
//  /// @notice This function is called by a keeper if the health factor of the borrow is too big,
//  ///         and so it's possible to borrow additional amount using the exist collateral amount.
//  ///         The borrowed amount is sent to the balance of the pool-adapter's user.
//  /// @param amountToBorrow_ It's safe to borrow given amount. As result health factor will reduce to target value.
//  /// @param lendingPoolAdapter_ Address of the pool adapter that has too big health factor
//  function requireAdditionalBorrow(
//    uint amountToBorrow_,
//    address lendingPoolAdapter_
//  ) external;
//
//  /// @notice This function is called by a keeper if the keeper has found MUCH better way of borrow than current one
//  /// @param lendingPoolAdapter_ Position to be closed
//  /// @param periodInBlocks_ Estimated period for new borrow, in blocks
//  function requireReconversion(
//    address lendingPoolAdapter_,
//    uint periodInBlocks_
//  ) external;

}