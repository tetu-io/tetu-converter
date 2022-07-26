// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";

/// @notice Main contract of the TetuConverter application
interface ITetuConverter {

  /// @notice Find best conversion strategy (swap or lending) and provide "cost of money" as interest for the period
  /// @param sourceAmount Amount to be converted
  /// @param healthFactorOptional For lending: min allowed health factor; 0 - use default value
  /// @return outPool Result pool or 0 if a pool is not found
  /// @return outMaxTargetAmount Max available amount of target tokens that we can get after conversion
  /// @return outInterest Interest on the use of {outMaxTargetAmount} during the period {approxOwnershipPeriodInBlocks}
  ///                     decimals 18
  function findBestConversionStrategy(
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint96 healthFactorOptional,
    uint approxOwnershipPeriodInBlocks
  ) external view returns (
    address outPool,
    uint outMaxTargetAmount,
    uint outInterest
  );

  /// @notice Convert {sourceAmount_} to {targetAmount_} using {pool_}
  ///         Target amount will be transferred to {receiver_}
  /// @param pool_ A pool received from findBestConversionStrategy. Normally this is address of a comptroller
  ///              It can be a pool of DEX or a lending platform.
  /// @param sourceAmount_ Amount of {sourceToken_}. This amount should be already sent to balance of the TetuConverter
  /// @param targetAmount_ Amount of {targetToken_} to be borrowed and sent to {receiver_}
  function convert(
    address pool_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_
  ) external;

  /// @notice Get active borrow with given collateral/borrowToken
  /// @return outCountItems Count of valid items in {outPoolAdapters} and {outAmountsToPay}
  /// @return outPoolAdapters An instance of IPoolAdapter (with repay function)
  /// @return outAmountsToPay Amount of {borrowedToken_} that should be repaid to close the borrow
  function findBorrows (
    address collateralToken_,
    address borrowedToken_
  ) external view returns (
    uint outCountItems,
    address[] memory outPoolAdapters,
    uint[] memory outAmountsToPay
  );
}