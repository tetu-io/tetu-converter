// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice Keeper sends notifications to TetuConverter using following interface
interface IKeeperCallback {

  /// @notice This function is called by a keeper if there is unhealthy borrow
  ///         and it's necessary to return a part of borrowed amount back
  /// @param amountToRepay_ The borrower must return given amount back to the TetuConverter
  ///                       in order to restore health factor to target value
  /// @param lendingPoolAdapter_ Address of the pool adapter that has problem health factor
  function requireRepay(
    uint amountToRepay_,
    address lendingPoolAdapter_
  ) external;

  /// @notice This function is called by a keeper if the health factor of the borrow is too big,
  ///         and so it's possible to borrow additional amount using the exist collateral amount.
  ///         The borrowed amount is sent to the balance of the pool-adapter's user.
  /// @param amountToBorrow_ It's safe to borrow given amount. As result health factor will reduce to target value.
  /// @param lendingPoolAdapter_ Address of the pool adapter that has too big health factor
  function requireAdditionalBorrow(
    uint amountToBorrow_,
    address lendingPoolAdapter_
  ) external;

  /// @notice This function is called by a keeper if the keeper has found MUCH better way of borrow than current one
  function requireReconversion(
    address lendingPoolAdapter_
  ) external;

}