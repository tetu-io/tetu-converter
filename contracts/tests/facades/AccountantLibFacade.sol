// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../libs/AppUtils.sol";
import "../../libs/AccountantLib.sol";

contract AccountantLibFacade {
  AccountantLib.BaseState internal _state;

  function setPoolAdapterCheckpoint(address poolAdapter, AccountantLib.PoolAdapterCheckpoint memory c) external {
    _state.checkpoints[poolAdapter] = c;
  }
  function setActions(address poolAdapter, AccountantLib.Actions[] memory values) external {
    for (uint i; i < values.length; ++i) {
      _state.actions[poolAdapter].push(values[i]);
    }
  }

  function getPoolAdapterCheckpoint(address poolAdapter) external view returns (AccountantLib.PoolAdapterCheckpoint memory) {
    return _state.checkpoints[poolAdapter];
  }
  function getActions(address poolAdapter) external view returns (AccountantLib.Actions[] memory) {
    return _state.actions[poolAdapter];
  }


  function checkpoint(IPoolAdapter poolAdapter_) external returns (uint deltaGain, uint deltaLoss) {
    return AccountantLib.checkpoint(poolAdapter_, _state);
  }

}
