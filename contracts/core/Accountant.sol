// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";
import "../interfaces/IAccountant.sol";
import "../libs/AppUtils.sol";
import "hardhat/console.sol";

/// @notice Calculate amounts of losses and gains for debts/supply for all pool adapters
contract Accountant is IAccountant {
  using SafeERC20 for IERC20;
  using AppUtils for uint;

  //region ----------------------------------------------------- Constants
  string public constant ACCOUNTANT_VERSION = "1.0.0";
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Data types
  struct UserState {
    /// @notice Current total amount supplied by the user as a collateral
    uint suppliedAmount;
    /// @notice Current total borrowed amount
    uint borrowedAmount;

    /// @notice Current total amount of collateral registered on the lending platform
    uint lastTotalCollateral;
    /// @notice Current total debt registered on the lending platform
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
    console.log("onBorrow");

    UserState memory state = _userStates[msg.sender];
    console.log("onBorrow.state.suppliedAmount", state.suppliedAmount);
    console.log("onBorrow.state.borrowedAmount", state.borrowedAmount);
    console.log("onBorrow.state.lastTotalCollateral", state.lastTotalCollateral);
    console.log("onBorrow.state.lastTotalDebt", state.lastTotalDebt);

    state = UserState({
      suppliedAmount: state.suppliedAmount + collateralAmount,
      borrowedAmount: state.borrowedAmount + borrowedAmount,
      lastTotalCollateral: totalCollateral,
      lastTotalDebt: totalDebt
    });
    _userStates[msg.sender] = state;

    console.log("onBorrow.2.state.suppliedAmount", state.suppliedAmount);
    console.log("onBorrow.2.state.borrowedAmount", state.borrowedAmount);
    console.log("onBorrow.2.state.lastTotalCollateral", state.lastTotalCollateral);
    console.log("onBorrow.2.state.lastTotalDebt", state.lastTotalDebt);
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
    console.log("onRepay.1.state.suppliedAmount", state.suppliedAmount);
    console.log("onRepay.1.state.borrowedAmount", state.borrowedAmount);
    console.log("onRepay.1.state.lastTotalCollateral", state.lastTotalCollateral);
    console.log("onRepay.1.state.lastTotalDebt", state.lastTotalDebt);

    uint debtRatio = 1e18 * paidAmount / (totalDebt + paidAmount);
    uint collateralRatio = 1e18 * withdrawnCollateral / (totalCollateral + withdrawnCollateral);

    uint debt = state.borrowedAmount * debtRatio / 1e18;
    uint collateral = state.suppliedAmount * collateralRatio / 1e18;

    console.log("onRepay.debtRatio", debtRatio);
    console.log("onRepay.collateralRatio", collateralRatio);
    console.log("onRepay.debt", debt);
    console.log("onRepay.collateral", collateral);

    state = UserState({
      borrowedAmount: state.borrowedAmount - debt,
      suppliedAmount: state.suppliedAmount - collateral,
      lastTotalCollateral: totalCollateral,
      lastTotalDebt: totalDebt
    });

    gain = int(withdrawnCollateral) - int(collateral);
    losses = int(paidAmount) - int(debt);
    console.log("onRepay.gain");console.logInt(gain);
    console.log("onRepay.losses");console.logInt(losses);

    _userStates[msg.sender] = state;
    console.log("onRepay.2.state.suppliedAmount", state.suppliedAmount);
    console.log("onRepay.2.state.borrowedAmount", state.borrowedAmount);
    console.log("onRepay.2.state.lastTotalCollateral", state.lastTotalCollateral);
    console.log("onRepay.2.state.lastTotalDebt", state.lastTotalDebt);
  }
  //endregion ----------------------------------------------------- IAccountant

  //region ----------------------------------------------------- View
  function getUserState(address user) external view returns (
    uint suppliedAmount,
    uint borrowedAmount,
    uint lastTotalCollateral,
    uint lastTotalDebt
  ) {
    UserState memory state = _userStates[user];
    return (state.suppliedAmount, state.borrowedAmount, state.lastTotalCollateral, state.lastTotalDebt);
  }
  //endregion ----------------------------------------------------- View

}