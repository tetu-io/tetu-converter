// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";
import "../interfaces/IPlatformAdapter.sol";
import "hardhat/console.sol";
import "./MockERC20.sol";
import "../openzeppelin/IERC20.sol";

/// @notice Partial implementation of IComptroller
contract PoolMock {
  address[] public cTokens;

  constructor(address[] memory cTokens_) {
    cTokens = cTokens_;
  }

  function transferToReceiver(address token_, uint amount_, address receiver_) external {
    require(IERC20(token_).balanceOf(address(this)) >= amount_, "not enough tokens on balance");

    console.log("transferToReceiver amount=%d from=%d to=%d"
      , amount_, address(this), receiver_
    );
    IERC20(token_).transfer(receiver_, amount_);
  }
}