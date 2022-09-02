// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../protocols/lending/dforce/DForceRewardsLib.sol";

/// @notice Facade for DForceRewardsLib to make external functions available for tests
contract DForceRewardsLibFacade {
  function getCore(
    IDForceController comptroller,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) external view returns (DForceRewardsLib.DForceCore memory) {
    return DForceRewardsLib.getCore(comptroller, cTokenCollateral_, cTokenBorrow_);
  }

  function getEstimatedBorrowRate(
    IDForceInterestRateModel interestRateModel_,
    IDForceCToken cTokenBorrow_,
    uint amountToBorrow_
  ) external view returns (uint) {
    return DForceRewardsLib.getEstimatedBorrowRate(interestRateModel_, cTokenBorrow_, amountToBorrow_);
  }

  function getRawAprInfo(
    DForceRewardsLib.DForceCore memory core,
    uint collateralAmount_,
    uint countBlocks_,
    uint amountToBorrow_
  ) external view returns (
    uint apr18,
    uint supplyIncrementBT,
    uint rewardsBT
  ) {
    return DForceRewardsLib.getRawAprInfo(core, collateralAmount_, countBlocks_, amountToBorrow_);
  }

  function getRewardAmountsBT18(
    DForceRewardsLib.DForceCore memory core,
    DForceRewardsLib.RewardsAmountInput memory p_
  ) external view returns (
    uint rewardAmountSupply,
    uint rewardAmountBorrow,
    uint totalRewardsBT
  ) {
    return DForceRewardsLib.getRewardAmountsBT18(core, p_);
  }

  function supplyRewardAmount(
    uint blockSupply_,
    uint stateIndex_,
    uint stateBlock_,
    uint distributionSpeed_,
    uint totalSupply_,
    uint supplyAmount_,
    uint targetBlock_
  ) external pure returns (uint) {
    return DForceRewardsLib.supplyRewardAmount(
      blockSupply_,
      stateIndex_,
      stateBlock_,
      distributionSpeed_,
      totalSupply_,
      supplyAmount_,
      targetBlock_
    );
  }

  function borrowRewardAmount(
    DForceRewardsLib.DBorrowRewardsInput memory p_,
    uint blockToClaimRewards_
  ) external view returns (uint rewardAmountBorrow) {
    return DForceRewardsLib.borrowRewardAmount(p_, blockToClaimRewards_);
  }

  function getRewardAmount(
    uint accountBalance_,
    uint stateIndex_,
    uint distributionSpeed_,
    uint totalToken_,
    uint accountIndex_,
    uint countBlocks_
  ) external pure returns (uint) {
    return DForceRewardsLib.getRewardAmount(accountBalance_, stateIndex_, distributionSpeed_, totalToken_, accountIndex_, countBlocks_);
  }

  function rmul(uint x, uint y) external pure returns (uint) {
    return DForceRewardsLib.rmul(x, y);
  }

  function rdiv(uint x, uint y) external pure returns (uint) {
    return DForceRewardsLib.rdiv(x, y);
  }

}