// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Collects list of registered borrow-positions. Allow to check state of the collaterals.
interface IDebtMonitor {

  /// @notice Enumerate {maxCountToCheck} pool adapters starting from {index0} and return unhealthy pool-adapters
  ///         i.e. adapters with health factor below min allowed value
  ///         It calculates two amounts: amount of borrow asset and amount of collateral asset
  ///         To fix the health factor it's necessary to send EITHER one amount OR another one.
  ///         There is special case: a liquidation happens inside the pool adapter.
  ///         It means, that this is "dirty" pool adapter and this position must be closed and never used again.
  ///         In this case, both amounts are zero (we need to make FULL repay)
  /// @return nextIndexToCheck0 Index of next pool-adapter to check; 0: all pool-adapters were checked
  /// @return outPoolAdapters List of pool adapters that should be reconverted
  /// @return outAmountBorrowAsset What borrow-asset amount should be send to pool adapter to fix health factor
  /// @return outAmountCollateralAsset What collateral-asset amount should be send to pool adapter to fix health factor
  function checkHealth(
    uint startIndex0,
    uint maxCountToCheck,
    uint maxCountToReturn
  ) external view returns (
    uint nextIndexToCheck0,
    address[] memory outPoolAdapters,
    uint[] memory outAmountBorrowAsset,
    uint[] memory outAmountCollateralAsset
  );

  /// @notice Register new borrow position if it's not yet registered
  /// @dev This function is called from a pool adapter after any borrow
  function onOpenPosition() external;

  /// @notice Unregister the borrow position if it's completely repaid
  /// @dev This function is called from a pool adapter when the borrow is completely repaid
  function onClosePosition() external;

  /// @notice Check if the pool-adapter-caller has an opened position
  function isPositionOpened() external view returns (bool);

  /// @notice Pool adapter has opened borrow, but full liquidation happens and we've lost all collateral
  ///         Close position without paying the debt and never use the pool adapter again.
  function closeLiquidatedPosition(address poolAdapter_) external;

  /// @notice Get total count of pool adapters with opened positions
  function getCountPositions() external view returns (uint);

  /// @notice Get active borrows of the user with given collateral/borrowToken
  /// @return poolAdaptersOut The instances of IPoolAdapter
  function getPositions (
    address user_,
    address collateralToken_,
    address borrowedToken_
  ) external view returns (
    address[] memory poolAdaptersOut
  );

  /// @notice Get active borrows of the given user
  /// @return poolAdaptersOut The instances of IPoolAdapter
  function getPositionsForUser(address user_) external view returns(
    address[] memory poolAdaptersOut
  );

  /// @notice Return true if there is a least once active pool adapter created on the base of the {converter_}
  function isConverterInUse(address converter_) external view returns (bool);

// TODO for next versions of the application
//  /// @notice Enumerate {maxCountToCheck} pool adapters starting from {index0} and return all pool-adapters
//  ///         with health factor exceeds max allowed value. In other words, it's safe to make additional borrow.
//  /// @return nextIndexToCheck0 Index of next pool-adapter to check; 0: all pool-adapters were checked
//  /// @return outPoolAdapters List of pool adapters that should be reconverted
//  /// @return outAmountsToBorrow What amount can be additionally borrowed using exist collateral
//  function checkAdditionalBorrow(
//    uint startIndex0,
//    uint maxCountToCheck,
//    uint maxCountToReturn
//  ) external view returns (
//    uint nextIndexToCheck0,
//    address[] memory outPoolAdapters,
//    uint[] memory outAmountsToBorrow
//  );

// TODO for next versions of the application
//  /// @notice Enumerate {maxCountToCheck} pool adapters starting from {index0} and return not-optimal pool-adapters
//  /// @param periodInBlocks Period in blocks that should be used in rebalancing
//  /// @return nextIndexToCheck0 Index of next pool-adapter to check; 0: all pool-adapters were checked
//  /// @return poolAdapters List of pool adapters that should be reconverted
//  function checkBetterBorrowExists(
//    uint startIndex0,
//    uint maxCountToCheck,
//    uint maxCountToReturn,
//    uint periodInBlocks
//  ) external view returns (
//    uint nextIndexToCheck0,
//    address[] memory poolAdapters
//  );
}