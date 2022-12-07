// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "hardhat/console.sol";

interface ISimulateTester {
  error ErrorWithAmount(uint amount);
  function makeSwapUsingTetuLiquidatorWithRevert(
    address tetuLiquidatorAddress,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external;
}