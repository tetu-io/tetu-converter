// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IDForceRewardDistributor {

  //-----------------------------------------------------/////////
  // Following functions were taken from LendingContractsV2, IRewardDistributor.sol
  //-----------------------------------------------------/////////
  function _setRewardToken(address newRewardToken) external;
  function _addRecipient(address _iToken, uint256 _distributionFactor) external;
  function _pause() external;
  function _unpause(uint256 _borrowSpeed, uint256 _supplySpeed) external;
  function _setGlobalDistributionSpeeds(uint256 borrowSpeed, uint256 supplySpeed) external;
  function updateDistributionSpeed() external;
  function _setDistributionFactors(address[] calldata iToken, uint256[] calldata distributionFactors) external;
  function updateDistributionState(address _iToken, bool _isBorrow) external;
  function updateReward(address _iToken, address _account, bool _isBorrow) external;
  function updateRewardBatch(address[] memory _holders, address[] memory _iTokens) external;
  function claimReward(address[] memory _holders, address[] memory _iTokens) external;
  function claimAllReward(address[] memory _holders) external;

  //-----------------------------------------------------/////////
  // Following functions were restored from 0x7d25d250fbd63b0dac4a38c661075930c9a87 (optimism)
  // https://optimistic.etherscan.io/address/0x870ac6a76A30742800609F205c741E86Db9b71a2#readProxyContract
  // There are no sources for last implementation, so previous implementation were used
  //-----------------------------------------------------/////////

  /// @notice the Reward distribution borrow state of each iToken
  function distributionBorrowState(address) external view returns (uint256 index, uint256 block_);

  /// @notice the Reward distribution state of each account of each iToken
  function distributionBorrowerIndex(address, address) external view returns (uint256);

  /// @notice the Reward distribution factor of each iToken, 1.0 by default. stored as a mantissa
  function distributionFactorMantissa(address) external view returns (uint256);

  /// @notice the Reward distribution speed of each iToken
  function distributionSpeed(address) external view returns (uint256);

  /// @notice the Reward distribution state of each account of each iToken
  function distributionSupplierIndex(address, address) external view returns (uint256);

  /// @notice the Reward distribution speed supply side of each iToken
  function distributionSupplySpeed(address) external view returns (uint256);

  /// @notice the Reward distribution supply state of each iToken
  function distributionSupplyState(address) external view returns (uint256 index, uint256 block_);

  /// @notice the global Reward distribution speed
  function globalDistributionSpeed() external view returns (uint256);

  /// @notice the global Reward distribution speed for supply
  function globalDistributionSupplySpeed() external view returns (uint256);

  /// @notice the Reward distributed into each account
  function reward(address) external view returns (uint256);

  /// @notice the Reward token address
  function rewardToken() external view returns (address);

  /// @notice whether the reward distribution is paused
  function paused() external view returns (bool);
}

