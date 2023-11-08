// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IAccountant {
  /// @notice Register a new loan
  /// @dev This function can be called by a pool adapter only
  /// @param collateralAmount Amount of supplied collateral for the new loan
  /// @param borrowedAmount Borrowed amount provided for the given {collateralAmount}
  function onBorrow(uint collateralAmount, uint borrowedAmount) external;

  /// @notice Register loan payment
  /// @dev This function can be called by a pool adapter only
  /// @param withdrawnCollateral Amount of collateral received by the user during the repaying.
  /// @param paidAmount Amount paid by the user during the repaying.
  function onRepay(uint withdrawnCollateral, uint paidAmount) external;

  /// @notice Get current state of the given pool adapter
  /// @return totalGain Total amount of collateral earned by the loan in the current period, in terms of underlying.
  ///                   Positive means profit.
  /// @return totalLosses Total loan repayment losses in the current period, in terms of underlying.
  ///                     Positive means losses.
  /// @return suppliedAmount Current total amount supplied by the user as a collateral
  /// @return borrowedAmount Current total borrowed amount
  /// @return lastTotalCollateral Current total amount of collateral registered on the lending platform
  /// @return lastTotalDebt Current total debt registered on the lending platform
  function getPoolAdapterState(address poolAdapter) external view returns (
    int totalGain,
    int totalLosses,
    uint suppliedAmount,
    uint borrowedAmount,
    uint lastTotalCollateral,
    uint lastTotalDebt
  );

  /// @notice Get current state of the given user (== strategy, the user of pool adapters)
  /// @return countPoolAdapters Current count of pool adapters
  /// @return totalGain Total amount of collateral earned by the pool adapters in the current period,
  ///                   in terms of underlying
  /// @return totalLosses Total loan repayment losses in terms of borrowed amount in the current period,
  ///                     in terms of underlying
  function getStateForPeriod(address user) external view returns (
    uint countPoolAdapters,
    int totalGain,
    int totalLosses
  );

  /// @notice Start new period of collecting of gains and losses.
  ///         Set current total gains and total losses for each pool adapter to zero.
  ///         Remove pool adapters with zero debts from the user.
  /// @return totalGain Total amount of collateral earned by the pool adapters in the previous period,
  ///                   in terms of underlying
  /// @return totalLosses Total loan repayment losses in terms of borrowed amount in the previous period,
  ///                     in terms of underlying
  function startNewPeriod(address user) external returns (int totalGain, int totalLosses);
}