// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "hardhat/console.sol";

interface ISimulateTester {
  error ErrorWithAmount(uint amount);
  function makeSwapUsingTetuLiquidatorWithRevert(
    address tetuLiquidatorAddress,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external;

  function simulateLocal(
    address targetContract,
    bytes calldata calldataPayload
  ) external returns (bytes memory response);
}
