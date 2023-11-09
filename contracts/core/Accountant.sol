// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/EnumerableSet.sol";
import "../openzeppelin/Math.sol";
import "../openzeppelin/IERC20Metadata.sol";
import "../interfaces/IAccountant.sol";
import "../libs/AppUtils.sol";
import "hardhat/console.sol";
import "../proxy/ControllableV3.sol";
import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPriceOracle.sol";
import "../libs/AccountantLib.sol";

/// @notice Calculate amounts of losses and gains for debts/supply for all pool adapters
contract Accountant is IAccountant, ControllableV3 {
  using SafeERC20 for IERC20;
  using AppUtils for uint;
  using EnumerableSet for EnumerableSet.AddressSet;

  //region ----------------------------------------------------- Constants
  string public constant ACCOUNTANT_VERSION = "1.0.0";
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Data types
  //endregion ----------------------------------------------------- Data types

  //region ----------------------------------------------------- Variables
  AccountantLib.BaseState internal _state;
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

    AccountantLib.onBorrow(_state, _controller, IPoolAdapter(msg.sender), collateralAmount, borrowedAmount);
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
      AccountantLib.onRepay(_state, IPoolAdapter(msg.sender), withdrawnCollateral, paidAmount);
    }
  }
  //endregion ----------------------------------------------------- OnBorrow, OnRepay

  //region ----------------------------------------------------- Checkpoints

  /// @notice Save checkpoint for the given {poolAdapter_} for the current moment
  function _checkpoint(IPoolAdapter poolAdapter_) internal returns (int deltaGain, int deltaLoss) {
    return AccountantLib.checkpoint(poolAdapter_, _state);
  }

  /// @notice Get last saved checkpoint for the given {user}
  function getLastCheckpoint(address poolAdapter_) external view returns (
    uint suppliedAmount,
    uint borrowedAmount,
    uint totalCollateral,
    uint totalDebt,
    int fixedCollateralGain,
    int fixedDebtLoss
  ) {
    AccountantLib.PoolAdapterCheckpoint memory c = _state.checkpoints[poolAdapter_];
    return (
      c.suppliedAmount,
      c.borrowedAmount,
      c.totalCollateral,
      c.totalDebt,
      c.fixedCollateralGain,
      c.fixedDebtLoss
    );
  }
  //endregion ----------------------------------------------------- Checkpoints

  //region ----------------------------------------------------- Logic for period
  /// @notice Start new period of collecting of gains and losses.
  ///         Set current total gains and total losses for each pool adapter to zero.
  ///         Remove pool adapters with zero debts from the user.
  /// @return totalGain Total amount of collateral earned by the pool adapters in the previous period,
  ///                   in terms of underlying
  /// @return totalLosses Total loan repayment losses in terms of borrowed amount in the previous period,
  ///                     in terms of underlying
  function startNewPeriod(address user) external returns (int totalGain, int totalLosses) {
//    period += 1;

//    uint countPoolAdapters = _state.poolAdaptersPerUser[user].length();
//    for (uint i = countPoolAdapters; i > 0; i--) {
//      address poolAdapter = _state.poolAdaptersPerUser[user].at(i - 1);
//      AccountantLib.FixedValues memory lossInfo = _state.fixedValues[poolAdapter];
//      totalGain += lossInfo.gainInUnderlying;
//      totalLosses += lossInfo.lossInUnderlying;
//      (,,, bool opened, ,) = IPoolAdapter(poolAdapter).getStatus();
//      if (! opened) {
//        delete _state.fixedValues[poolAdapter];
//        delete _state.states[poolAdapter];
//        _state.poolAdaptersPerUser[user].remove(poolAdapter);
//      }
//    }
    return (totalGain, totalLosses);
  }

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
  ) {
//    AccountantLib.PoolAdapterState memory state = _state.states[poolAdapter];
//    AccountantLib.FixedValues memory lossInfo = _state.fixedValues[poolAdapter];
//
//    return (
//      lossInfo.gainInUnderlying,
//      lossInfo.lossInUnderlying,
//      state.suppliedAmount,
//      state.borrowedAmount,
//      state.lastTotalCollateral,
//      state.lastTotalDebt
//    );
  }

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
  ) {
//    countPoolAdapters = _poolAdaptersPerUser[user].length();
//    for (uint i; i < countPoolAdapters; ++i) {
//      address poolAdapter = _poolAdaptersPerUser[user].at(i);
//      FixedValues memory lossInfo = _fixedValues[poolAdapter];
//      totalGain += lossInfo.gainInUnderlying;
//      totalLosses += lossInfo.lossInUnderlying;
//    }
    return (countPoolAdapters, totalGain, totalLosses);
  }
  //endregion ----------------------------------------------------- Logic for period

  //region ----------------------------------------------------- Utils
  function poolAdaptersPerUserLength(address user) external view returns (uint) {
    return _state.poolAdaptersPerUser[user].length();
  }
  function poolAdaptersPerUserAt(address user, uint index) external view returns (address) {
    return _state.poolAdaptersPerUser[user].at(index);
  }
  //endregion ----------------------------------------------------- View

}