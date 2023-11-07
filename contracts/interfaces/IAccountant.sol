// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IAccountant {
  /// @notice Register a new loan
  /// @param collateralAmount Amount of supplied collateral for the new loan
  /// @param borrowedAmount Borrowed amount provided for the given {collateralAmount}
  /// @param totalCollateral Total amount of collateral supplied by the user, at the moment after the borrowing.
  /// @param totalDebt Total debt of the user, at the moment after the borrowing.
  function onBorrow(
    uint collateralAmount,
    uint borrowedAmount,
    uint totalCollateral,
    uint totalDebt
  ) external;

  /// @notice Register loan payment
  /// @param withdrawnCollateral Amount of collateral received by the user during the repaying.
  /// @param paidAmount Amount paid by the user during the repaying.
  /// @param totalCollateral Total amount of collateral supplied by the user, at the moment after the repaying.
  /// @param totalDebt Total debt of the user, at the moment after the repaying.
  /// @return gain Amount of collateral earned by the loan in terms of collateral. Positive means profit.
  /// @return losses Loan repayment losses in terms of borrowed amount. Positive means losses.
  function onRepay(
    uint withdrawnCollateral,
    uint paidAmount,
    uint totalCollateral,
    uint totalDebt
  ) external returns (
    int gain,
    int losses
  );
}