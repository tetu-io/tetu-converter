// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/DataTypes.sol";

/// @notice A facade for the set of available lending platforms
interface IBorrowManager {
  /// @param pool_ It's comptroller
  /// @param adapter_ Implementation of ILendingPlatform that knows how to work with the pool
  /// @param assets_ All assets supported by the pool (duplicates are not allowed)
  function addPool(address pool_, address adapter_, address[] calldata assets_) external;

  /// @notice Set default health factor for {asset}. Default value is used only if user hasn't provided custom value
  /// @param value Health factor must be greater then 1.
  function setHealthFactor(address asset, uint96 value) external;

  /// @notice Find lending pool capable of providing {targetAmount} and having best normalized borrow rate
  /// @return outPool Result pool or 0 if a pool is not found
  /// @return outAdapter implementation of IConverter that is able to work with outPool
  /// @return outBorrowRate Pool normalized borrow rate per ethereum block
  /// @return outMaxTargetAmount Max available amount of target tokens that we can borrow using {sourceAmount}
  function findPool(DataTypes.ExecuteFindPoolParams memory params) external view returns (
    address outPool,
    address outAdapter,
    uint outBorrowRate,
    uint outMaxTargetAmount
  );

  function getLendingPlatform(address pool_) external view returns (address);
}
