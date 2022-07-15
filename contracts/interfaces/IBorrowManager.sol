// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/DataTypes.sol";

/// @notice A facade for the set of available lending platforms
interface IBorrowManager {
  /// @param pool_ It's comptroller
  /// @param decorator_ Implementation of ILendingPlatform that knows how to work with the pool
  /// @param assets_ All assets supported by the pool (duplicates are not allowed)
  function addPool(address pool_, address decorator_, address[] calldata assets_) external;

  /// @notice Set default health factor for {asset}. Default value is used only if user hasn't provided custom value
  /// @param value Health factor must be greater then 1.
  function setHealthFactor(address asset, uint96 value) external;

  /// @notice Find lending pool capable of providing {targetAmount} and having best normalized borrow rate
  /// @param sourceAmount Max possible collateral value in source tokens
  /// @param targetAmount Minimum required target amount; result outMaxTargetAmount must be greater
  /// @param healthFactorOptional if 0 than default health factor specified for the target asset will be used
  /// @return outPool Result pool or 0 if a pool is not found
  /// @return outBorrowRate Pool normalized borrow rate per ethereum block
  /// @return outMaxTargetAmount Max available amount of target tokens that we can borrow using {sourceAmount}
  function findPool(
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount,
    uint96 healthFactorOptional
  ) external view returns (
    address outPool,
    uint outBorrowRate,
    uint outMaxTargetAmount
  );

  /// @notice Borrow {targetAmount} from the pool using {sourceAmount} as collateral.
  /// @dev Result health factor cannot be less the default health factor specified for the target asset by governance.
  /// @param sourceToken Asset to be used as collateral
  /// @param sourceAmount Max available amount of collateral
  /// @param targetToken Asset to borrow
  /// @param targetAmount Required amount to borrow
  function borrow (
    address pool,
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount
  ) external;
}
