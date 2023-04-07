// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;


interface ICometRewards {
  struct RewardConfig {
    address token;
    uint64 rescaleFactor;
    bool shouldUpscale;
  }

  struct RewardOwed {
    address token;
    uint owed;
  }

  function rewardConfig(address comet) external view returns(RewardConfig memory);
  function getRewardOwed(address comet, address account) external returns (RewardOwed memory);
  function claim(address comet, address src, bool shouldAccrue) external;

}