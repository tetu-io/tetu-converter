// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../proxy/UpgradeableProxy.sol";

contract UpgradeableProxyFacade is UpgradeableProxy{
  function init(address _logic) external {
    _init(_logic);
  }
}
