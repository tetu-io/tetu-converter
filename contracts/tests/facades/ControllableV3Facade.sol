// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../proxy/ControllableV3.sol";

contract ControllableV3Facade is ControllableV3 {
  function init(address controller) external {
    __Controllable_init(controller);
  }
}
