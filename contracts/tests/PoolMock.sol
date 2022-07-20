// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/DataTypes.sol";
import "../interfaces/IPlatformAdapter.sol";
import "hardhat/console.sol";
import "./MockERC20.sol";

/// @notice Partial implementation of IComptroller
contract PoolMock {
  address[] public cTokens;

  constructor(address[] memory cTokens_) {
    cTokens = cTokens_;
  }
}