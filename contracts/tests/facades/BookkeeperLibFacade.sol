// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/EnumerableSet.sol";
import "../../libs/AppUtils.sol";
import "../../libs/BookkeeperLib.sol";

contract BookkeeperLibFacade {
  using EnumerableSet for EnumerableSet.AddressSet;

  BookkeeperLib.BaseState internal _state;

  function setPoolAdapterCheckpoint(address poolAdapter, BookkeeperLib.PoolAdapterCheckpoint memory c) external {
    _state.checkpoints[poolAdapter] = c;
  }
  function setActions(address poolAdapter, BookkeeperLib.Action[] memory values) external {
    for (uint i; i < values.length; ++i) {
      _state.actions[poolAdapter].push(values[i]);
    }
  }
  function setPoolAdaptersPerUser(address user, address[] memory poolAdapters) external {
    for (uint i = 0; i < poolAdapters.length; ++i) {
      _state.poolAdaptersPerUser[user].add(poolAdapters[i]);
    }
  }

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
}
