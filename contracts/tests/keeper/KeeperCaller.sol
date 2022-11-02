// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../integrations/gelato/IResolver.sol";
import "hardhat/console.sol";
import "../../integrations/gelato/OpsReady.sol";

contract KeeperCaller is IOps {
  enum LastCallResults {
    NOT_CALLED_0,
    SUCCESS_1,
    FAILED_2
  }
  address public keeper;
  LastCallResults public lastCallResults;

  function setupKeeper(address keeper_) external {
    keeper = keeper_;
  }

  function gelato() external view override returns (address payable) {
    console.log("is gelato", address(this));
    return payable(address(this));
  }

  function callChecker() external {
    console.log("KeeperCaller.callChecker");
    (
      bool canExecOut,
      bytes memory execPayloadOut
    ) = IResolver(keeper).checker();

    if (canExecOut) {
      console.log("KeeperCaller.execute", address(keeper));
      (bool success, bytes memory returnData) = address(keeper).call(execPayloadOut);
      console.log("KeeperCaller.execute success", success);
      lastCallResults = success
        ? LastCallResults.SUCCESS_1
        : LastCallResults.FAILED_2;
    } else {
      lastCallResults = LastCallResults.NOT_CALLED_0;
    }
  }
}