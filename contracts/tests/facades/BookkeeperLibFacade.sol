// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/EnumerableSet.sol";
import "../../libs/AppUtils.sol";
import "../../libs/BookkeeperLib.sol";

contract BookkeeperLibFacade {
  using EnumerableSet for EnumerableSet.AddressSet;

  BookkeeperLib.BaseState internal _state;

  //region ----------------------------------------------------- set up
  function setPoolAdapterCheckpoint(address poolAdapter, BookkeeperLib.PoolAdapterCheckpoint memory c) external {
    _state.checkpoints[poolAdapter] = c;
  }
  function setActions(address poolAdapter, BookkeeperLib.Action[] memory actions) external {
    for (uint i; i < actions.length; ++i) {
      _state.actions[poolAdapter].push(actions[i]);
    }
  }
  function setActionsWithRepayInfo(address poolAdapter,
    BookkeeperLib.Action[] memory actions,
    BookkeeperLib.RepayInfo[] memory repayInfo
  ) external {
    for (uint i; i < actions.length; ++i) {
      _state.actions[poolAdapter].push(actions[i]);
      if (actions[i].actionKind == BookkeeperLib.ActionKind.REPAY_1) {
        _state.repayInfo[poolAdapter][_state.actions[poolAdapter].length - 1] = repayInfo[i];
      }
    }
  }
  function setPoolAdaptersPerUser(address user, address[] memory poolAdapters) external {
    for (uint i = 0; i < poolAdapters.length; ++i) {
      _state.poolAdaptersPerUser[user].add(poolAdapters[i]);
    }
  }
  function setPeriods(address poolAdapter, uint[] memory periods) external {
    _state.periods[poolAdapter] = periods;
  }
  //endregion ----------------------------------------------------- set up

  //region ----------------------------------------------------- BookkeeperLib

  function getPoolAdapterCheckpoint(address poolAdapter) external view returns (BookkeeperLib.PoolAdapterCheckpoint memory) {
    return _state.checkpoints[poolAdapter];
  }
  function getActions(address poolAdapter) external view returns (BookkeeperLib.Action[] memory) {
    return _state.actions[poolAdapter];
  }
  function getPoolAdaptersPerUser(address user, address poolAdapter) external view returns (bool) {
    return _state.poolAdaptersPerUser[user].contains(poolAdapter);
  }

  function checkpointForPoolAdapter(IPoolAdapter poolAdapter_) external returns (uint deltaGain, uint deltaLoss) {
    return BookkeeperLib.checkpointForPoolAdapter(_state, poolAdapter_);
  }

  function checkpointForUser(address[] memory tokens) external returns (uint[] memory deltaGains, uint[] memory deltaLosses) {
    return BookkeeperLib.checkpointForUser(_state, msg.sender, tokens);
  }

  function previewCheckpointForPoolAdapter(IPoolAdapter poolAdapter_) external view returns (uint deltaGain, uint deltaLoss) {
    return BookkeeperLib.previewCheckpointForPoolAdapter(_state, poolAdapter_);
  }

  function previewCheckpointForUser(address[] memory tokens) external view returns (uint[] memory deltaGains, uint[] memory deltaLosses) {
    return BookkeeperLib.previewCheckpointForUser(_state, msg.sender, tokens);
  }

  /// @notice calculate total amount of gains and looses in underlying by all pool adapters of the user
  ///         for the current period, start new period.
  function startPeriod(IDebtMonitor debtMonitor, address user_, address underlying_) external returns (
    uint gains,
    uint losses
  ) {
    return BookkeeperLib.startPeriod(_state, debtMonitor, user_, underlying_);
  }

  function onHardwork(IPoolAdapter poolAdapter_, bool isCollateralUnderlying_, uint[] memory decs) external view returns (
    uint gains,
    uint loss,
    uint countActions
  ) {
    return BookkeeperLib.onHardwork(_state, poolAdapter_, isCollateralUnderlying_, decs);
  }

  function poolAdaptersPerUserContains(address user, address poolAdapter) external view returns (bool) {
    return _state.poolAdaptersPerUser[user].contains(poolAdapter);
  }
  function lastPeriodValue(address poolAdapter) external view returns (uint) {
    uint len = _state.periods[poolAdapter].length;
    return (len == 0)
      ? 0
      : _state.periods[poolAdapter][len - 1];
  }
  //endregion ----------------------------------------------------- BookkeeperLib
}
