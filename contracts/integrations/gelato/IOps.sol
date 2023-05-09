// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

interface IOps {
  function gelato() external view returns (address payable);
  function taskTreasury() external view returns (address);
}