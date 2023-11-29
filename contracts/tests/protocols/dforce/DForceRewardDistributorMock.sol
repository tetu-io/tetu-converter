// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../integrations/dforce/IDForceRewardDistributor.sol";
import "../../../openzeppelin/IERC20.sol";
import "hardhat/console.sol";

contract DForceRewardDistributorMock is IDForceRewardDistributor {
  IDForceRewardDistributor internal rd;
  /// @notice token => address => isBorrow => rewards amount
  mapping(address => mapping(address => mapping(bool => uint))) internal earnedRewards;
  /// @notice holder => amount
  mapping(address => uint) internal updatedRewards;
  address internal _rewardToken;

  //region -------------------------------- Set up
  constructor (address originRewardDistributor) {
    rd = IDForceRewardDistributor(originRewardDistributor);
  }

  function setRewards(address token, address user, bool isBorrow, uint value) external{
    earnedRewards[token][user][isBorrow] = value;
  }
  //endregion -------------------------------- Set up

  //region -------------------------------- Implementation
  function updateReward(address _iToken, address _account, bool _isBorrow) external {
    console.log("updateReward.1");
    updatedRewards[_account] += earnedRewards[_iToken][_account][_isBorrow];
    console.log("updateReward.2");
  }

  /// @notice the Reward distributed into each account
  function reward(address holder) external view returns (uint256) {
    console.log("reward.1");
    return updatedRewards[holder];
  }

  function claimAllReward(address[] memory _holders) external {
    console.log("claimAllReward.1");
    IERC20 token = IERC20(_rewardToken);
    for (uint i = 0; i < _holders.length; i++) {
      uint amount = updatedRewards[_holders[i]];
      if (amount != 0 && amount <= token.balanceOf(address(this))) {
        token.transfer(_holders[i], amount);
      }
    }
    console.log("claimAllReward.2");
  }

  /// @notice the Reward token address
  function rewardToken() external view returns (address) {
    console.log("rewardToken.1");
    if (_rewardToken == address(0)) {
      return rd.rewardToken();
    }
    console.log("rewardToken.2", _rewardToken);
    return _rewardToken;
  }
  function _setRewardToken(address newRewardToken) external {
    _rewardToken = newRewardToken;
  }
  function updateDistributionState(address _iToken, bool _isBorrow) external {
    // nothing to do for simplicity
  }
  //endregion -------------------------------- Implementation


  //region -------------------------------- stubs

  function _addRecipient(address _iToken, uint256 _distributionFactor) external {
    rd._addRecipient(_iToken, _distributionFactor);
  }
  function _pause() external {
    rd._pause();
  }
  function _unpause(uint256 _borrowSpeed, uint256 _supplySpeed) external {
    rd._unpause(_borrowSpeed, _supplySpeed);
  }
  function _setGlobalDistributionSpeeds(uint256 borrowSpeed, uint256 supplySpeed) external {
    rd._setGlobalDistributionSpeeds(borrowSpeed, supplySpeed);
  }
  function updateDistributionSpeed() external {
    rd.updateDistributionSpeed();
  }
  function _setDistributionFactors(address[] calldata iToken, uint256[] calldata distributionFactors) external {
    rd._setDistributionFactors(iToken, distributionFactors);
  }
  function updateRewardBatch(address[] memory _holders, address[] memory _iTokens) external {
    rd.updateRewardBatch(_holders, _iTokens);
  }
  function claimReward(address[] memory _holders, address[] memory _iTokens) external {
    rd.claimReward(_holders, _iTokens);
  }

  /// @notice the Reward distribution borrow state of each iToken
  function distributionBorrowState(address a) external view returns (uint256 index, uint256 block_) {
    return rd.distributionBorrowState(a);
  }

  /// @notice the Reward distribution state of each account of each iToken
  function distributionBorrowerIndex(address a, address b) external view returns (uint256) {
    return rd.distributionBorrowerIndex(a, b);
  }

  /// @notice the Reward distribution factor of each iToken, 1.0 by default. stored as a mantissa
  function distributionFactorMantissa(address a) external view returns (uint256) {
    return rd.distributionFactorMantissa(a);
  }

  /// @notice the Reward distribution speed of each iToken
  function distributionSpeed(address a) external view returns (uint256) {
    return rd.distributionSpeed(a);
  }

  /// @notice the Reward distribution state of each account of each iToken
  function distributionSupplierIndex(address a, address b) external view returns (uint256) {
    return rd.distributionSupplierIndex(a, b);
  }

  /// @notice the Reward distribution speed supply side of each iToken
  function distributionSupplySpeed(address a) external view returns (uint256) {
    return rd.distributionSupplySpeed(a);
  }

  /// @notice the Reward distribution supply state of each iToken
  function distributionSupplyState(address a) external view returns (uint256 index, uint256 block_) {
    return rd.distributionSupplyState(a);
  }

  /// @notice the global Reward distribution speed
  function globalDistributionSpeed() external view returns (uint256) {
    return rd.globalDistributionSpeed();
  }

  /// @notice the global Reward distribution speed for supply
  function globalDistributionSupplySpeed() external view returns (uint256) {
    return rd.globalDistributionSupplySpeed();
  }

  /// @notice whether the reward distribution is paused
  function paused() external view returns (bool) {
    return rd.paused();
  }
  //endregion -------------------------------- stubs
}

