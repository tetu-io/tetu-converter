// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/EnumerableSet.sol";
import "../openzeppelin/Math.sol";
import "../openzeppelin/IERC20Metadata.sol";
import "../interfaces/IBookkeeper.sol";
import "../libs/AppUtils.sol";
import "../proxy/ControllableV3.sol";
import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPriceOracle.sol";
import "../libs/BookkeeperLib.sol";

import "hardhat/console.sol";

/// @notice Calculate amounts of losses and gains for debts/supply for all pool adapters
/// @dev Each repay/borrow operation is registered, balances of currently supplied and borrowed amounts are stored.
///      User is able to make two checkpoints and calculate what
///      increase to debt/collateral happened in the period between the checkpoints.
///      Theses increases are named "gain" (for collateral) and "debt-loss" (for borrow asset).
///      (typically first checkpoint is made at the end of previous operation and new checkpoint is made at the
///      beginning of new operation: result amounts are used by fix-change-price procedure).
///      Another case: user should be able to calculate total amount of received gains and paid debt-lost.
///      Periodically user will reset data to start calculation of that total amounts from zero
///      (typically reset will happen at hardworking point).
contract Bookkeeper is IBookkeeper, ControllableV3 {
  using SafeERC20 for IERC20;
  using AppUtils for uint;
  using EnumerableSet for EnumerableSet.AddressSet;

  //region ----------------------------------------------------- Constants
  string public constant BOOKKEEPER_VERSION = "1.0.0";
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Data types
  //endregion ----------------------------------------------------- Data types

  //region ----------------------------------------------------- Variables
  BookkeeperLib.BaseState internal _state;
  //endregion ----------------------------------------------------- Variables

  //region ----------------------------------------------------- Initialization
  function init(address controller_) external initializer {
    __Controllable_init(controller_);
  }
  //endregion ----------------------------------------------------- Initialization

  //region ----------------------------------------------------- OnBorrow, OnRepay
  /// @notice Register a new loan
  /// @param collateralAmount Amount of supplied collateral for the new loan
  /// @param borrowedAmount Borrowed amount provided for the given {collateralAmount}
  function onBorrow(uint collateralAmount, uint borrowedAmount) external {
    IConverterController _controller = IConverterController(controller());
    IBorrowManager borrowManager = IBorrowManager(_controller.borrowManager());
    require(borrowManager.isPoolAdapter(msg.sender), AppErrors.POOL_ADAPTER_NOT_FOUND);

    BookkeeperLib.onBorrow(_state, IPoolAdapter(msg.sender), collateralAmount, borrowedAmount);
  }

  /// @notice Register loan payment
  /// @param withdrawnCollateral Amount of collateral received by the user during the repaying.
  /// @param paidAmount Amount paid by the user during the repaying.
  function onRepay(uint withdrawnCollateral, uint paidAmount) external {
    IConverterController _controller = IConverterController(controller());
    IBorrowManager borrowManager = IBorrowManager(_controller.borrowManager());

    // onRepay is allowed for registered platform adapters only
    // if some dirty (de-registered) pool adapter will try to call onRepay
    // we shouldn't prevent its attempt to make repay but
    // it's too dangerous to take results into account here because a malicious contract can try to give us wrong data
    // so, no revert, silent ignore

    if (borrowManager.isPoolAdapter(msg.sender)) {
      BookkeeperLib.onRepay(_state, _controller, IPoolAdapter(msg.sender), withdrawnCollateral, paidAmount);
    }
  }
  //endregion ----------------------------------------------------- OnBorrow, OnRepay

  //region ----------------------------------------------------- Checkpoints
  /// @notice Save checkpoint for all pool adapters of the given {user_}
  /// @return deltaGains Total amount of gains for the {tokens_} by all pool adapter
  /// @return deltaLosses Total amount of losses for the {tokens_} by all pool adapter
  function checkpoint(address[] memory tokens_) external returns (
    uint[] memory deltaGains,
    uint[] memory deltaLosses
  ) {
    // no restrictions: any user is allowed
    // to receive any values the user should have empty state_.poolAdaptersPerUser

    return BookkeeperLib.checkpointForUser(_state, msg.sender, tokens_);
  }

  /// @notice Calculate deltas that user would receive if he creates a checkpoint at the moment
  /// @return deltaGains Total amount of gains for the {tokens_} by all pool adapter
  /// @return deltaLosses Total amount of losses for the {tokens_} by all pool adapter
  function previewCheckpoint(address user, address[] memory tokens_) external view returns (
    uint[] memory deltaGains,
    uint[] memory deltaLosses
  ) {
    // no restrictions: any user is allowed
    // to receive any values the user should have empty state_.poolAdaptersPerUser

    return BookkeeperLib.previewCheckpointForUser(_state, user, tokens_);
  }

  /// @notice Get last saved checkpoint for the given {user}
  function getLastCheckpoint(address poolAdapter_) external view returns (
    uint suppliedAmount,
    uint borrowedAmount,
    uint totalCollateral,
    uint totalDebt,
    uint countActions
  ) {
    BookkeeperLib.PoolAdapterCheckpoint memory c = _state.checkpoints[poolAdapter_];
    return (
      c.suppliedAmount,
      c.borrowedAmount,
      c.totalCollateral,
      c.totalDebt,
      c.countActions
    );
  }
  //endregion ----------------------------------------------------- Checkpoints

  //region ----------------------------------------------------- Logic for period

  //endregion ----------------------------------------------------- Logic for period

  //region ----------------------------------------------------- View mapping data
  function poolAdaptersPerUserLength(address user) external view returns (uint) {
    return _state.poolAdaptersPerUser[user].length();
  }
  function poolAdaptersPerUserAt(address user, uint index) external view returns (address) {
    return _state.poolAdaptersPerUser[user].at(index);
  }

  function actionsLength(address poolAdapter) external view returns (uint) {
    return _state.actions[poolAdapter].length;
  }
  function actionsAt(address poolAdapter, uint index) external view returns (
    uint suppliedAmount,
    uint borrowedAmount,
    uint totalCollateral,
    uint totalDebt,
    uint actionKind
  ) {
    BookkeeperLib.Action memory action = _state.actions[poolAdapter][index];
    return (
      action.suppliedAmount,
      action.borrowedAmount,
      action.totalCollateral,
      action.totalDebt,
      uint(action.actionKind)
    );
  }

  function repayInfoAt(address poolAdapter, uint index) external view returns (
    uint gain,
    uint loss,
    uint[2] memory prices
  ) {
    BookkeeperLib.RepayInfo memory repayInfo = _state.repayInfo[poolAdapter][index];
    return (
      repayInfo.gain,
      repayInfo.loss,
      repayInfo.prices
    );
  }

  //endregion ----------------------------------------------------- View mapping data

}