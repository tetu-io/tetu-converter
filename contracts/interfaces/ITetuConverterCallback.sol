// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice TetuConverter sends callback notifications to its user via this interface
interface ITetuConverterCallback {
  /// @notice TetuConverter calls this function when it needs to return some borrowed amount back
  ///         i.e. for re-balancing or re-conversion
  /// @param collateralAsset_ Collateral asset of the borrow to identify the borrow on the borrower's side
  /// @param borrowAsset_ Borrow asset of the borrow to identify the borrow on the borrower's side
  /// @param amountToReturn_ What amount of borrow asset the Borrower should send back to TetuConverter
  /// @return amountBorrowAssetReturned Exact amount that borrower has sent to balance of TetuConverter
  ///                                   It should be equal to amountToReturn_
  function requireBorrowedAmountBack (
    address collateralAsset_,
    address borrowAsset_,
    uint amountToReturn_
  ) external returns (uint amountBorrowAssetReturned);

  /// @notice TetuConverter calls this function when it needs to get additional collateral to fix health factor.
  /// @param collateralAsset_ Collateral asset of the borrow to identify the borrow on the borrower's side
  /// @param borrowAsset_ Borrow asset of the borrow to identify the borrow on the borrower's side
  /// @param requiredCollateralAmount_  What amount of collateral asset the Borrower should send to TetuConverter
  /// @return amountCollateralAssetOut Exact amount that borrower has sent to balance of TetuConverter
  ///                                  It should be equal to requiredCollateralAmount_
  function requireCollateralAmount(
    address collateralAsset_,
    address borrowAsset_,
    uint requiredCollateralAmount_
  ) external returns (uint amountCollateralAssetOut);

  /// @notice TetuConverter calls this function when it makes additional borrow (using exist collateral).
  ///         The given amount has already be sent to balance of the user, the user just should use it.
  /// @param collateralAsset_ Collateral asset of the borrow to identify the borrow on the borrower's side
  /// @param borrowAsset_ Borrow asset of the borrow to identify the borrow on the borrower's side
  /// @param amountBorrowAssetSentToBorrower_ This amount has been sent to the borrower's balance
  function onTransferBorrowedAmount (
    address collateralAsset_,
    address borrowAsset_,
    uint amountBorrowAssetSentToBorrower_
  ) external;

  /// @notice TetuConverter calls this function health factor becomes too healthy and it's possible to return
  ///         some collateral amount back to the user.
  ///         The given amount has already be sent to balance of the user, the user just should use it.
  /// @param collateralAsset_ Collateral asset of the borrow to identify the borrow on the borrower's side
  /// @param borrowAsset_ Borrow asset of the borrow to identify the borrow on the borrower's side
  /// @param amountCollateralAssetSentToBorrower_ This amount has been sent to the borrower's balance
  function onTransferCollateralAmount (
    address collateralAsset_,
    address borrowAsset_,
    uint amountCollateralAssetSentToBorrower_
  ) external;
}