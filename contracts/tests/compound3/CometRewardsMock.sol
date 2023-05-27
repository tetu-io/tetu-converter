// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/compound3/ICometRewards.sol";
import "hardhat/console.sol";

contract CometRewardsMock is ICometRewards {
  address internal comet;
  ICometRewards internal cometRewards;
  constructor(address comet_, address cometRewards_) {
    comet = comet_;
    cometRewards = ICometRewards(cometRewards_);
  }
  function rewardConfig(address /*comet_*/) external view returns(RewardConfig memory) {
    console.log("CometRewardsMock.rewardConfig");
    return cometRewards.rewardConfig(comet);
  }
  function getRewardOwed(address /*comet_*/, address /*account*/) external returns (RewardOwed memory) {
    console.log("CometRewardsMock.getRewardOwed");
    return cometRewards.getRewardOwed(comet, address(this));
  }
  function claim(address /*comet_*/, address src, bool shouldAccrue) external {
    console.log("CometRewardsMock.claim");
    cometRewards.claim(comet, src, shouldAccrue);
  }
}