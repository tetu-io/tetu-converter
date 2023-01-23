// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IOMatic {
  function mint() external payable;
  function repayBorrow() external payable;
}
