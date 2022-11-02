// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../integrations/gelato/IResolver.sol";

contract KeeperCaller {
  enum LastCallResults {
    NOT_CALLED_0,
    SUCCESS_1,
    FAILED_2
  }
  address public keeper;
  LastCallResults public lastCallResults;

  constructor(address keeper_) {
    keeper = keeper_;
  }

  function callChecker() external {
    IResolver r;
    (
      bool canExecOut,
      bytes memory execPayloadOut
    ) = IResolver(keeper).checker();

    if (canExecOut) {
      (bool success, bytes memory returnData) = address(keeper).staticcall(execPayloadOut);
      lastCallResults = success
        ? LastCallResults.SUCCESS_1
        : LastCallResults.FAILED_2;
    } else {
      lastCallResults = LastCallResults.NOT_CALLED_0;
    }
  }
}