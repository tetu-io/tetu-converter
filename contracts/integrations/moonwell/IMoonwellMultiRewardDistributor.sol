// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from implementation 0xdC649f4fa047a3C98e8705E85B8b1BafCbCFef0f
/// of 0xe9005b078701e2A0948D2EaC43010D35870Ad9d2
interface IMoonwellMultiRewardDistributor {
  event DisbursedBorrowerRewards(
    address indexed mToken,
    address indexed borrower,
    address indexed emissionToken,
    uint256 totalAccrued
  );
  event DisbursedSupplierRewards(
    address indexed mToken,
    address indexed supplier,
    address indexed emissionToken,
    uint256 totalAccrued
  );
  event FundsRescued(address token, uint256 amount);
  event GlobalBorrowIndexUpdated(
    address mToken,
    address emissionToken,
    uint256 newIndex,
    uint32 newTimestamp
  );
  event GlobalSupplyIndexUpdated(
    address mToken,
    address emissionToken,
    uint256 newSupplyIndex,
    uint32 newSupplyGlobalTimestamp
  );
  event Initialized(uint8 version);
  event InsufficientTokensToEmit(
    address user,
    address rewardToken,
    uint256 amount
  );
  event NewBorrowRewardSpeed(
    address indexed mToken,
    address indexed emissionToken,
    uint256 oldRewardSpeed,
    uint256 newRewardSpeed
  );
  event NewConfigCreated(
    address indexed mToken,
    address indexed owner,
    address indexed emissionToken,
    uint256 supplySpeed,
    uint256 borrowSpeed,
    uint256 endTime
  );
  event NewEmissionCap(uint256 oldEmissionCap, uint256 newEmissionCap);
  event NewEmissionConfigOwner(
    address indexed mToken,
    address indexed emissionToken,
    address currentOwner,
    address newOwner
  );
  event NewPauseGuardian(address oldPauseGuardian, address newPauseGuardian);
  event NewRewardEndTime(
    address indexed mToken,
    address indexed emissionToken,
    uint256 currentEndTime,
    uint256 newEndTime
  );
  event NewSupplyRewardSpeed(
    address indexed mToken,
    address indexed emissionToken,
    uint256 oldRewardSpeed,
    uint256 newRewardSpeed
  );
  event Paused(address account);
  event RewardsPaused();
  event RewardsUnpaused();
  event Unpaused(address account);

  function _addEmissionConfig(
    address _mToken,
    address _owner,
    address _emissionToken,
    uint256 _supplyEmissionPerSec,
    uint256 _borrowEmissionsPerSec,
    uint256 _endTime
  ) external;

  function _pauseRewards() external;

  function _rescueFunds(address _tokenAddress, uint256 _amount) external;

  function _setEmissionCap(uint256 _newEmissionCap) external;

  function _setPauseGuardian(address _newPauseGuardian) external;

  function _unpauseRewards() external;

  function _updateBorrowSpeed(
    address _mToken,
    address _emissionToken,
    uint256 _newBorrowSpeed
  ) external;

  function _updateEndTime(
    address _mToken,
    address _emissionToken,
    uint256 _newEndTime
  ) external;

  function _updateOwner(
    address _mToken,
    address _emissionToken,
    address _newOwner
  ) external;

  function _updateSupplySpeed(
    address _mToken,
    address _emissionToken,
    uint256 _newSupplySpeed
  ) external;

  function comptroller() external view returns (address);

  function disburseBorrowerRewards(
    address _mToken,
    address _borrower,
    bool _sendTokens
  ) external;

  function disburseSupplierRewards(
    address _mToken,
    address _supplier,
    bool _sendTokens
  ) external;

  function emissionCap() external view returns (uint256);

  function getAllMarketConfigs(address _mToken)
  external
  view
  returns (MultiRewardDistributorCommon.MarketConfig[] memory);

  function getConfigForMarket(address _mToken, address _emissionToken)
  external
  view
  returns (MultiRewardDistributorCommon.MarketConfig memory);

  function getCurrentEmissionCap() external view returns (uint256);

  function getCurrentOwner(address _mToken, address _emissionToken)
  external
  view
  returns (address);

  function getGlobalBorrowIndex(address mToken, uint256 index)
  external
  view
  returns (uint256);

  function getGlobalSupplyIndex(address mToken, uint256 index)
  external
  view
  returns (uint256);

  function getOutstandingRewardsForUser(address _mToken, address _user)
  external
  view
  returns (MultiRewardDistributorCommon.RewardInfo[] memory);

  function getOutstandingRewardsForUser(address _user)
  external
  view
  returns (MultiRewardDistributorCommon.RewardWithMToken[] memory);

  function initialIndexConstant() external view returns (uint224);

  function initialize(address _comptroller, address _pauseGuardian) external;

  function marketConfigs(address, uint256)
  external
  view
  returns (MultiRewardDistributorCommon.MarketConfig memory config);

  function pauseGuardian() external view returns (address);

  function paused() external view returns (bool);

  function updateMarketBorrowIndex(address _mToken) external;

  function updateMarketBorrowIndexAndDisburseBorrowerRewards(
    address _mToken,
    address _borrower,
    bool _sendTokens
  ) external;

  function updateMarketSupplyIndex(address _mToken) external;

  function updateMarketSupplyIndexAndDisburseSupplierRewards(
    address _mToken,
    address _supplier,
    bool _sendTokens
  ) external;
}

interface MultiRewardDistributorCommon {
  struct MarketConfig {
    address owner;
    address emissionToken;
    uint256 endTime;
    uint224 supplyGlobalIndex;
    uint32 supplyGlobalTimestamp;
    uint224 borrowGlobalIndex;
    uint32 borrowGlobalTimestamp;
    uint256 supplyEmissionsPerSec;
    uint256 borrowEmissionsPerSec;
  }

  struct RewardInfo {
    address emissionToken;
    uint256 totalAmount;
    uint256 supplySide;
    uint256 borrowSide;
  }

  struct RewardWithMToken {
    address mToken;
    RewardInfo[] rewards;
  }
}