// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "hardhat/console.sol";
import "../openzeppelin/IERC20.sol";

/// @notice Partial implementation of IComptroller
contract PoolStub {

  function transferToReceiver(address token_, uint amount_, address receiver_) external {
    uint balanceTokens = IERC20(token_).balanceOf(address(this));
    console.log("PoolStub.transferToReceiver token_=%s amount_=%d receiver_=%s",token_, amount_, receiver_);
    console.log("Tokens balance=%d", balanceTokens);

    require(balanceTokens >= amount_, "not enough tokens on balance");

    console.log("transferToReceiver amount=%d from=%d to=%d"
      , amount_, address(this), receiver_
    );
    IERC20(token_).transfer(receiver_, amount_);
  }
}