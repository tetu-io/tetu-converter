// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Collects list of registered borrow-positions. Allow to check state of the collaterals.
interface IDebtMonitor {

  /// @notice Register new borrow position if it's not yet registered
  /// @dev This function is called from a pool adapter after any borrow
  function onOpenPosition() external;

  /// @notice Unregister the borrow position if it's completely repaid
  /// @dev This function is called from a pool adapter after any repaying
  function onClosePosition() external;

  /// @notice Enumerate {maxCountToCheck} pool adapters starting from {index0} and return unhealthy pool-adapters
  /// @param minAllowedHealthFactor Decimals 18
  /// @return outNextIndex0 Index of next pool-adapter to check; 0: all pool-adapters were checked
  /// @return outPoolAdapter Unhealthy pool adapters, count of valid items is {countFoundItems}
  function findUnhealthyPositions(
      uint index0,
      uint maxCountToCheck,
      uint maxCountToReturn,
      uint minAllowedHealthFactor
  ) external view returns (
      uint nextIndexToCheck0,
      uint countFoundItems,
      address[] outPoolAdapter
  );

    /// @notice Get total count of pool adapters with opened positions
  function getCountPositions() external view returns (uint);

  /// @notice Get active borrows of the user with given collateral/borrowToken
  /// @return outCountItems Count of valid items in {outPoolAdapters} and {outAmountsToPay}
  /// @return outPoolAdapters An instance of IPoolAdapter
  /// @return outAmountsToPay Amount of {borrowedToken_} that should be repaid to close the borrow
  function getPositions (
    address user_,
    address collateralToken_,
    address borrowedToken_
  ) external view returns (
    uint countItems,
    address[] memory poolAdapters,
    uint[] memory amountsToPay
  );
}