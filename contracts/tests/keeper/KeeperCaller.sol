// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/gelato/IResolver.sol";
import "hardhat/console.sol";
import "../../integrations/gelato/IOps.sol";

contract KeeperCaller is IOps {
  enum LastCallResults {
    NOT_CALLED_0,
    SUCCESS_1,
    FAILED_2
  }
  address public keeperChecker;
  address public keeperExecutor;
  LastCallResults public lastCallResults;

  function setupKeeper(
    address keeperChecker_,
    address keeperExecutor_
  ) external {
    keeperChecker = keeperChecker_;
    keeperExecutor = keeperExecutor_;
  }

  function gelato() external view override returns (address payable) {
    console.log("is gelato", address(this));
    return payable(address(this));
  }

  function taskTreasury() external view override returns (address) {
    return address(this);
  }

  function callChecker() external {
    console.log("KeeperCaller.callChecker", address(keeperChecker));
    (
      bool canExecOut,
      bytes memory execPayloadOut
    ) = IResolver(keeperChecker).checker();
    console.log("KeeperCaller.canExecOut", canExecOut);

    if (canExecOut) {
      console.log("KeeperCaller.execute", address(keeperExecutor));
      (bool success,) = address(keeperExecutor).call(execPayloadOut);
      console.log("KeeperCaller.execute success", success);
      lastCallResults = success
        ? LastCallResults.SUCCESS_1
        : LastCallResults.FAILED_2;
    } else {
      lastCallResults = LastCallResults.NOT_CALLED_0;
    }
  }
}
