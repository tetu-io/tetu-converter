// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";

/// @notice Main contract of the TetuConverter application
interface ITetuConverter {

  /// @notice Find best conversion strategy (swap or lending) and provide "cost of money" as interest for the period
  /// @param sourceAmount_ Amount to be converted
  /// @param healthFactor2_ For lending: min allowed health factor, decimals 2; 0 - use default value
  /// @param periodInBlocks_ Estimated period to keep target amount. It's required to compute APR
  /// @return converter Result contract that should be used for conversion; it supports IConverter
  /// @return maxTargetAmount Max available amount of target tokens that we can get after conversion
  /// @return aprForPeriod18 Interest on the use of {outMaxTargetAmount} during the given period, decimals 18
  function findConversionStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint16 healthFactor2_,
    uint periodInBlocks_
  ) external view returns (
    address converter,
    uint maxTargetAmount,
    uint aprForPeriod18
  );

  /// @notice Convert {sourceAmount_} to {targetAmount_} using {converter_}
  ///         Target amount will be transferred to {receiver_}
  /// @dev Transferring of sourceAmount_ should be approved by the caller
  /// @param converter_ A converter received from findBestConversionStrategy.
  /// @param sourceAmount_ Amount of {sourceToken_}. This amount should be already sent to balance of the TetuConverter
  /// @param targetAmount_ Amount of {targetToken_} to be borrowed and sent to {receiver_}
  function convert(
    address converter_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_
  ) external;

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
  /// @param healthFactor2_ For lending: min allowed health factor, decimals 2; 0 - use default value
  /// @param periodInBlocks_ Estimated period to keep target amount. It's required to compute APR
  function reconvert(
    address poolAdapter_,
    uint16 healthFactor2_,
    uint periodInBlocks_
  ) external;
}