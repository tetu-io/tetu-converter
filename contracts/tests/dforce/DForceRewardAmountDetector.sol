// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../integrations/dforce/IDForceLendingData.sol";

/// @notice Call getAccountRewardAmount and store received value to public variable
contract DForceRewardAmountDetector {
  IDForceLendingData private lendingData;
  uint public rewardsAmount;

  constructor (address lendingData_) {
    lendingData = IDForceLendingData(lendingData_);
  }

  function getAccountRewardAmount(address account) external {
    rewardsAmount = lendingData.getAccountRewardAmount(account);
  }
}