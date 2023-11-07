// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";
import "../libs/AppUtils.sol";
import "../interfaces/IAccountant.sol";

/// @notice Calculate amounts of losses and gains for debts/supply for all pool adapters
contract Accountant is IAccountant {
  using SafeERC20 for IERC20;
  using AppUtils for uint;

  //region ----------------------------------------------------- Constants
  string public constant ACCOUNTANT_VERSION = "1.0.0";
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Data types
  struct UserState {
    uint suppliedAmount;
    uint borrowedAmount;

    uint lastTotalCollateral;
    uint lastTotalDebt;
  }
  //endregion ----------------------------------------------------- Data types

  //region ----------------------------------------------------- Variables

  /// @notice user (pool adapter) => state
  mapping(address => UserState) internal _userStates;

  //endregion ----------------------------------------------------- Variables

  //region ----------------------------------------------------- IAccountant
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
  ) external {
    // todo Pool adapter only

    UserState memory state = _userStates[msg.sender];
    state = UserState({
      borrowedAmount: state.borrowedAmount + borrowedAmount,
      suppliedAmount: state.suppliedAmount + collateralAmount,
      lastTotalCollateral: totalCollateral,
      lastTotalDebt: totalDebt
    });
  }

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
  ) {
    // todo Pool adapter only
    UserState memory state = _userStates[msg.sender];
    // todo require debt is not zero ???

    uint debtRatio = 1e18 * paidAmount / (totalDebt + paidAmount);
    uint collateralRatio = 1e18 * withdrawnCollateral / (totalCollateral + withdrawnCollateral);

    uint debt = state.borrowedAmount * debtRatio / 1e18;
    uint collateral = state.suppliedAmount * collateralRatio / 1e18;

    state = UserState({
      borrowedAmount: state.borrowedAmount - debt,
      suppliedAmount: state.suppliedAmount - collateral,
      lastTotalCollateral: totalCollateral,
      lastTotalDebt: totalDebt
    });

    gain = (int(totalDebt + paidAmount) - int(state.borrowedAmount)) *  int(debtRatio) / 1e18;
    losses = (int(totalCollateral + withdrawnCollateral) - int(state.suppliedAmount)) * int(collateralRatio) / 1e18;
  }
  //endregion ----------------------------------------------------- IAccountant
}