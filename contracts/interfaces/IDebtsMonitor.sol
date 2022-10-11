// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Collects list of registered borrow-positions. Allow to check state of the collaterals.
interface IDebtMonitor {

  /// @notice Register new borrow position if it's not yet registered
  /// @dev This function is called from a pool adapter after any borrow
  function onOpenPosition() external;

  /// @notice Unregister the borrow position if it's completely repaid
  /// @dev This function is called from a pool adapter when the borrow is completely repaid
  function onClosePosition() external;

  /// @notice Enumerate {maxCountToCheck} pool adapters starting from {index0} and return unhealthy pool-adapters
  /// @return nextIndexToCheck0 Index of next pool-adapter to check; 0: all pool-adapters were checked
  /// @return poolAdapters List of pool adapters that should be reconverted
  /// @return outAmountToRepay What amount should be repay to pool adapter to restore health factor
  function checkHealth(
    uint startIndex0,
    uint maxCountToCheck,
    uint maxCountToReturn
  ) external view returns (
    uint nextIndexToCheck0,
    address[] memory poolAdapters,
    uint[] memory outAmountToRepay
  );

  /// @notice Enumerate {maxCountToCheck} pool adapters starting from {index0} and return not-optimal pool-adapters
  /// @param healthFactor2 Health factor that should be used in rebalancing, decimals 2
  /// @param periodInBlocks Period in blocks that should be used in rebalancing
  /// @return nextIndexToCheck0 Index of next pool-adapter to check; 0: all pool-adapters were checked
  /// @return poolAdapters List of pool adapters that should be reconverted
  function checkForBetterBorrow(
      uint startIndex0,
      uint maxCountToCheck,
      uint maxCountToReturn,
      uint16 healthFactor2,
      uint periodInBlocks
  ) external view returns (
      uint nextIndexToCheck0,
      address[] memory poolAdapters
  );

    /// @notice Get total count of pool adapters with opened positions
  function getCountPositions() external view returns (uint);

  /// @notice Get active borrows of the user with given collateral/borrowToken
  /// @return poolAdapters An instance of IPoolAdapter
  function getPositions (
    address user_,
    address collateralToken_,
    address borrowedToken_
  ) external view returns (
    address[] memory poolAdapters
  );

  /// @notice Return true if there is a least once active pool adapter created on the base of the {converter_}
  function isConverterInUse(address converter_) external view returns (bool);
}