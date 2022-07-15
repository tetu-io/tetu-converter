// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/DataTypes.sol";

/// @notice Main contract of the TetuConverter application
interface ITetuConverter {

  /// @notice Find best conversion strategy (swap or lending) and provide "cost of money" as interest for the period
  /// @param sourceAmount Amount to be converted
  /// @param targetAmount Minimum required amount that should be received
  /// @param healthFactorOptional For lending: min allowed health factor; 0 - use default value
  /// @return outStrategyKind 0 - not found, 1 - Swap, 2 - lending
  /// @return outPool Result pool or 0 if a pool is not found
  /// @return outBorrowRate Pool normalized borrow rate per ethereum block
  /// @return outMaxTargetAmount Max available amount of target tokens that we can get after conversion
  function findBestConversionStrategy(
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount,
    uint96 healthFactorOptional,
    uint approxOwnershipPeriodInBlocks
  ) external view returns (
    uint outStrategyKind,
    address outPool,
    uint outBorrowRate,
    uint outMaxTargetAmount
  );

  /// @notice Borrow {targetAmount} from the pool using {sourceToken} as collateral
  ///         The collateral should be transferred to the balance of the TetuConverter before calling borrow function
  /// @dev Result health factor cannot be less the default health factor specified for the target asset by governance.
  /// @param sourceToken_ Asset to be used as collateral
  /// @param targetToken_ Asset to borrow
  /// @param targetAmount_ Required amount to borrow
  /// @param receiver_ Receiver of cTokens
  function borrow (
    address pool_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_
  ) external;
}