// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IDForceCTokenMatic {
  function mint(address _recipient) external payable;
  function repayBorrow() external payable;
}
