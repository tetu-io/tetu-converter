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

  /// @notice Decrease amount of already registered position or close the position
  /// @dev governance only
  function onRepayBehalf(address borrower_, address cToken_, uint amountBurntCTokens_, address borrowedToken_) external;

  /// @notice Enumerate {count} pool adapters starting from {index0} and return first found unhealthy pool-adapter
  /// @notice minAllowedHealthFactor Decimals 18
  /// @return outNextIndex0 Index of next pool to check
  ///                       0: there are no unhealthy pool-adapters in the range [index0, index0 + count)
  /// @return outPoolAdapter Unhealthy pool adapter
  /// @return outCountBorrowedTokens Count of valid items in outBorrowedTokens
  /// @return outBorrowedTokens Borrow tokens that have bad healthy factors in the given pool adapter.
  function findFirst(uint index0, uint count, uint minAllowedHealthFactor) external view returns (
      uint outNextIndex0,
      address outPoolAdapter,
      uint outCountBorrowedTokens,
      address[] memory outBorrowedTokens
  );

  /// @notice Get total count of pool adapters with opened positions
  function getCountActivePoolAdapters() external view returns (uint);

}