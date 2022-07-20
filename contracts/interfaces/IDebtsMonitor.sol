// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Collects list of registered loans. Allow to check state of the loan collaterals.
interface IDebtMonitor {

  /// @notice Create new position or increase amount of already registered position
  /// @dev This function is called from a pool adapter after any borrow
  function onBorrow(address cToken_, uint amountReceivedCTokens_, address borrowedToken_) external;

  /// @notice Decrease amount of already registered position or close the position
  /// @dev This function is called from a pool adapter after any repaying
  function onRepay(address cToken_, uint amountBurntCTokens_, address borrowedToken_) external;

  /// @notice Enumerate {count} pool adapters starting from {index0} and return true if any of them is unhealthy
  function checkUnhealthyPoolAdapterExist(uint index0, uint count) external view returns (bool);

  /// @notice Get total count of pool adapters with opened positions
  function getCountActivePoolAdapters() external view returns (uint);

}