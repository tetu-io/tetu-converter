// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../libs/AppUtils.sol";
import "../../libs/AccountantLib.sol";

contract AccountantLibFacade {
  AccountantLib.BaseState internal _state;

  function setPoolAdapterState(address poolAdapter, AccountantLib.PoolAdapterState memory state_) external {
    _state.states[poolAdapter] = state_;
  }
  function setPoolAdapterCheckpoint(address poolAdapter, AccountantLib.PoolAdapterCheckpoint memory c) external {
    _state.checkpoints[poolAdapter] = c;
  }
  function setFixedValues(address poolAdapter, AccountantLib.FixedValues[] memory values) external {
    for (uint i; i < values.length; ++i) {
      _state.fixedValues[poolAdapter].push(values[i]);
    }
  }

  function getPoolAdapterState(address poolAdapter) external view returns (AccountantLib.PoolAdapterState memory) {
    return _state.states[poolAdapter];
  }
  function getPoolAdapterCheckpoint(address poolAdapter) external view returns (AccountantLib.PoolAdapterCheckpoint memory) {
    return _state.checkpoints[poolAdapter];
  }
  function getFixedValues(address poolAdapter) external view returns (AccountantLib.FixedValues[] memory) {
    return _state.fixedValues[poolAdapter];
  }


  function checkpoint(IPoolAdapter poolAdapter_) external returns (int deltaGain, int deltaLoss) {
    return AccountantLib.checkpoint(poolAdapter_, _state);
  }

}
