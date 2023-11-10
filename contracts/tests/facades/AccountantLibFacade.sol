// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/EnumerableSet.sol";
import "../../libs/AppUtils.sol";
import "../../libs/AccountantLib.sol";

contract AccountantLibFacade {
  using EnumerableSet for EnumerableSet.AddressSet;

  AccountantLib.BaseState internal _state;

  function setPoolAdapterCheckpoint(address poolAdapter, AccountantLib.PoolAdapterCheckpoint memory c) external {
    _state.checkpoints[poolAdapter] = c;
  }
  function setActions(address poolAdapter, AccountantLib.Action[] memory values) external {
    for (uint i; i < values.length; ++i) {
      _state.actions[poolAdapter].push(values[i]);
    }
  }
  function setPoolAdaptersPerUser(address user, address[] memory poolAdapters) external {
    for (uint i = 0; i < poolAdapters.length; ++i) {
      _state.poolAdaptersPerUser[user].add(poolAdapters[i]);
    }
  }

  function getPoolAdapterCheckpoint(address poolAdapter) external view returns (AccountantLib.PoolAdapterCheckpoint memory) {
    return _state.checkpoints[poolAdapter];
  }
  function getActions(address poolAdapter) external view returns (AccountantLib.Action[] memory) {
    return _state.actions[poolAdapter];
  }
  function getPoolAdaptersPerUser(address user, address poolAdapter) external returns (bool) {
    return _state.poolAdaptersPerUser[user].contains(poolAdapter);
  }

  function checkpointForPoolAdapter(IPoolAdapter poolAdapter_) external returns (uint deltaGain, uint deltaLoss) {
    return AccountantLib.checkpointForPoolAdapter(_state, poolAdapter_);
  }

  function checkpointForUser(address[] memory tokens) external returns (uint[] memory deltaGains, uint[] memory deltaLosses) {
    return AccountantLib.checkpointForUser(_state, msg.sender, tokens);
  }

  function previewCheckpointForPoolAdapter(IPoolAdapter poolAdapter_) external view returns (uint deltaGain, uint deltaLoss) {
    return AccountantLib.previewCheckpointForPoolAdapter(_state, poolAdapter_);
  }

  function previewCheckpointForUser(address[] memory tokens) external view returns (uint[] memory deltaGains, uint[] memory deltaLosses) {
    return AccountantLib.previewCheckpointForUser(_state, msg.sender, tokens);
  }
}
