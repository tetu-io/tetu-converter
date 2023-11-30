// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from zkevm.0xf29d0ae1A29C453df338C5eEE4f010CFe08bb3FF, events were removed
interface IZerovixComptroller {
  function _become(address unitroller) external;

  function _borrowGuardianPaused() external view returns (bool);

  function _grantReward(address recipient, uint256 amount) external;

  function _mintGuardianPaused() external view returns (bool);

  function _setBorrowCapGuardian(address newBorrowCapGuardian) external;

  function _setBorrowPaused(address oToken, bool state) external returns (bool);

  function _setCloseFactor(uint256 newCloseFactorMantissa) external returns (uint256);

  function _setCollateralFactor(address oToken, uint256 newCollateralFactorMantissa) external returns (uint256);

  function _setContributorRewardSpeed(address contributor, uint256 rewardSpeed) external;

  function _setLiquidationIncentive(uint256 newLiquidationIncentiveMantissa)  external returns (uint256);

  function _setMarketBorrowCaps(address[] memory oTokens, uint256[] memory newBorrowCaps) external;

  function _setMintPaused(address oToken, bool state) external returns (bool);

  function _setPauseGuardian(address newPauseGuardian) external returns (uint256);

  function _setPriceOracle(address newOracle) external returns (uint256);

  function _setRewardSpeeds(address[] memory oTokens,uint256[] memory supplySpeeds, uint256[] memory borrowSpeeds) external;

  function _setSeizePaused(bool state) external returns (bool);

  function _setTransferPaused(bool state) external returns (bool);

  function _supportMarket(address oToken, bool _autoCollaterize) external returns (uint256);

  function accountAssets(address, uint256) external view returns (address);

  function accountMembership(address, address) external view returns (bool);

  function admin() external view returns (address);

  function allMarkets(uint256) external view returns (address);

  function boostManager() external view returns (address);

  function borrowAllowed(address oToken, address borrower, uint256 borrowAmount) external returns (uint256);

  function borrowCapGuardian() external view returns (address);

  function borrowCaps(address) external view returns (uint256);

  function borrowState(address) external view returns (uint224 index, uint32 timestamp);

  function borrowVerify(address oToken, address borrower, uint256 borrowAmount) external;

  function checkMembership(address account, address oToken) external view returns (bool);

  function claimReward(address holder) external returns (uint256);

  function claimRewards(address holder, address[] memory oTokens) external;

  function claimRewards(address[] memory holders, address[] memory oTokens, bool borrowers, bool suppliers) external;

  function closeFactorMantissa() external view returns (uint256);

  function compRate() external view returns (uint256);

  function comptrollerImplementation() external view returns (address);

  function enterMarkets(address[] memory oTokens) external returns (uint256[] memory);

  function exitMarket(address oTokenAddress) external returns (uint256);

  function getAccountLiquidity(address account) external view returns (uint256, uint256, uint256);

  function getAllMarkets() external view returns (address[] memory);

  function getAssetsIn(address account) external view returns (address[] memory);

  function getBoostManager() external view returns (address);

  function getHypotheticalAccountLiquidity(address account, address oTokenModify, uint256 redeemTokens, uint256 borrowAmount)
  external view returns (uint256, uint256, uint256);

  function getTimestamp() external view returns (uint256);

  function getVixAddress() external view returns (address);

  function guardianPaused(address) external view returns (bool mint, bool borrow);

  function isComptroller() external view returns (bool);

  function isDeprecated(address oToken) external view returns (bool);

  function isMarket(address oToken) external view returns (bool);

  function lastContributorTimestamp(address) external view returns (uint256);

  function liquidateBorrowAllowed(address oTokenBorrowed, address oTokenCollateral, address liquidator, address borrower, uint256 repayAmount) external view returns (uint256);

  function liquidateBorrowVerify(address oTokenBorrowed, address oTokenCollateral, address liquidator, address borrower, uint256 actualRepayAmount, uint256 seizeTokens) external;

  function liquidateCalculateSeizeTokens(address oTokenBorrowed, address oTokenCollateral, uint256 actualRepayAmount)
  external view returns (uint256, uint256);

  function liquidationIncentiveMantissa() external view returns (uint256);

  function marketInitialIndex() external view returns (uint224);

  function markets(address) external view returns (bool isListed,bool autoCollaterize,uint256 collateralFactorMantissa);

  function maxAssets() external view returns (uint256);

  function mintAllowed(address oToken, address minter, uint256 mintAmount) external returns (uint256);

  function mintVerify(address oToken, address minter, uint256 actualMintAmount, uint256 mintTokens) external;

  function oracle() external view returns (address);

  function pauseGuardian() external view returns (address);

  function pendingAdmin() external view returns (address);

  function pendingComptrollerImplementation() external view returns (address);

  function redeemAllowed(address oToken, address redeemer, uint256 redeemTokens) external returns (uint256);

  function redeemVerify(address oToken, address redeemer, uint256 redeemAmount, uint256 redeemTokens) external pure;

  function repayBorrowAllowed(address oToken, address payer, address borrower, uint256 repayAmount) external returns (uint256);

  function repayBorrowVerify(address oToken, address payer, address borrower, uint256 actualRepayAmount, uint256 borrowerIndex) external;

  function rewardAccrued(address) external view returns (uint256);

  function rewardBorrowSpeeds(address) external view returns (uint256);

  function rewardBorrowerIndex(address, address) external view returns (uint256);

  function rewardContributorSpeeds(address) external view returns (uint256);

  function rewardReceivable(address) external view returns (uint256);

  function rewardSpeeds(address) external view returns (uint256);

  function rewardSupplierIndex(address, address) external view returns (uint256);

  function rewardSupplySpeeds(address) external view returns (uint256);

  function rewardUpdater() external view returns (address);

  function seizeAllowed(address oTokenCollateral, address oTokenBorrowed, address liquidator, address borrower, uint256 seizeTokens) external returns (uint256);

  function seizeGuardianPaused() external view returns (bool);

  function seizeVerify(address oTokenCollateral, address oTokenBorrowed, address liquidator, address borrower, uint256 seizeTokens) external;

  function setAutoCollaterize(address market, bool flag) external;

  function setBoostManager(address newBoostManager) external;

  function setRewardUpdater(address _rewardUpdater) external;

  function setVixAddress(address newVixAddress) external;

  function supplyState(address) external view returns (uint224 index, uint32 timestamp);

  function transferAllowed(address oToken, address src, address dst, uint256 transferTokens) external returns (uint256);

  function transferGuardianPaused() external view returns (bool);

  function transferVerify(address oToken, address src, address dst, uint256 transferTokens) external;

  function updateAndDistributeBorrowerRewardsForToken(address oToken, address borrower) external;

  function updateAndDistributeSupplierRewardsForToken(address oToken, address account) external;

  function updateContributorRewards(address contributor) external;

  receive() external payable;
}

