// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice User of TetuConvert should support this interface, so keeper/TetuConverter will be able to require actions
interface IBorrower {

  /// @notice Result of a required operation: a Borrower sends status back to the keeper
  enum Status {
    UNKNOWN_0,
    DONE_1,
    IGNORED_2,
    FAILED_3
  }

  /// @notice This function is called by a keeper if there is unhealthy borrow
  ///         and it's necessary to return a part of borrowed amount back
  /// @param collateralAsset_ Address of collateral asset
  /// @param borrowAsset_ Address of borrowed asset
  /// @param amountToRepay_ The borrower must return given amount back to the TetuConverter
  ///                       in order to restore health factor to target value
  /// @param converter_ Address of the converter to indicate the pool adapter that has problem health factor
  ///                   This value should be passed as the value of converterOptional_ to ITetuConverter.repay
  function requireRepay(
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_,
    address converter_
  ) external returns (Status);

  /// @notice This function is called by a keeper if the health factor of the borrow is too big,
  ///         and so it's possible to borrow additional amount using the exist collateral amount
  /// @param collateralAsset_ Address of collateral asset
  /// @param borrowAsset_ Address of borrowed asset
  /// @param amountToBorrow_ It's safe to borrow given amount. As result health factor will reduce to target value.
  /// @param converter_ TAddress of the converter to indicate the pool adapter that has too big health factor
  ///                   This value should be passed as the value of converter_ to ITetuConverter.borrow
  function recommendBorrow(
    address collateralAsset_,
    address borrowAsset_,
    uint amountToBorrow_,
    address converter_
  ) external returns (Status);

  /// @notice This function is called by a keeper if the keeper has found MUCH better way of borrow than current one
  function requireReconversion(
    address poolAdapter
  ) external returns (Status);

}