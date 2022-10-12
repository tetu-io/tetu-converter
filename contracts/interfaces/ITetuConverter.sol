// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Main contract of the TetuConverter application
interface ITetuConverter {
  enum ConversionMode {
    AUTO_0,
    SWAP_1,
    BORROW_2
  }

//todo rename lending to borrowing
  /// @notice Find best conversion strategy (swap or borrow) and provide "cost of money" as interest for the period
  /// @param sourceAmount_ Amount to be converted
  /// @param periodInBlocks_ Estimated period to keep target amount. It's required to compute APR
  /// @param conversionMode Allow to select conversion kind (swap, borrowing) automatically or manually
  /// @return converter Result contract that should be used for conversion; it supports IConverter
  /// @return maxTargetAmount Max available amount of target tokens that we can get after conversion
  /// @return aprForPeriod36 Interest on the use of {outMaxTargetAmount} during the given period, decimals 36
  function findConversionStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint periodInBlocks_,
    ConversionMode conversionMode
  ) external view returns (
    address converter,
    uint maxTargetAmount,
    int aprForPeriod36
  );

  /// @notice Convert {collateralAmount_} to {amountToBorrow_} using {converter_}
  ///         Target amount will be transferred to {receiver_}
  /// @dev Transferring of {collateralAmount_} should be approved by the caller
  /// @param converter_ A converter received from findBestConversionStrategy.
  /// @param collateralAmount_ Amount of {collateralAsset_}. This amount must be approved for TetuConverter.
  /// @param amountToBorrow_ Amount of {borrowAsset_} to be borrowed and sent to {receiver_}
  function borrow(
    address converter_,
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint amountToBorrow_,
    address receiver_
  ) external;

  /// @notice Full or partial repay of the borrow
  /// @param amountToRepay_ Amount of borrowed asset to repay. Pass type(uint).max to make full repayment.
  /// @param poolAdapterOptional_ Allow to make repayment of specified loan (i.e the unhealthy loan)
  ///        If 0, then exist loans will be repaid in order of creation, one by one.
  function repay(
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_,
    address collateralReceiver_,
    address poolAdapterOptional_
  ) external;

  /// @notice Calculate total amount of borrow tokens that should be repaid to close the loan completely.
  function getDebtAmount(address collateralAsset_, address borrowAsset_) external view returns (uint);

  /// @notice User needs to redeem some collateral amount. Calculate an amount that should be repaid
  function estimateRepay(
    address collateralAsset_,
    uint collateralAmountRequired_,
    address borrowAsset_
  ) external view returns (uint borrowAssetAmount);

  /// @notice Transfer all given reward tokens to {receiver_}
  function claimRewards() external returns (
    address[] memory rewardTokens,
    uint[] memory amounts
  );



  //////////////////////////////////////////////////////////////////////////////
  /// Additional functions, remove somewhere?
  //////////////////////////////////////////////////////////////////////////////

  /// @notice Get active borrow positions for the given collateral/borrowToken
  /// @return poolAdapters An instance of IPoolAdapter (with repay function)
  function findBorrows (
    address collateralToken_,
    address borrowedToken_
  ) external view returns (
    address[] memory poolAdapters
  );

  /// @notice Repay the borrow completely and re-convert (borrow or swap) from zero
  /// @dev Revert if re-borrow uses same PA as before
  /// @param periodInBlocks_ Estimated period to keep target amount. It's required to compute APR
  function reconvert(
    address poolAdapter_,
    uint periodInBlocks_,
    address receiver_
  ) external;
}
