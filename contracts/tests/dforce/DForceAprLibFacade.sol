// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../protocols/lending/dforce/DForceAprLib.sol";

/// @notice Facade for DForceRewardsLib to make external functions available for tests
contract DForceAprLibFacade {
  function getCore(
    IDForceController comptroller,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) external view returns (DForceAprLib.DForceCore memory) {
    return DForceAprLib.getCore(comptroller, cTokenCollateral_, cTokenBorrow_);
  }

  function getEstimatedBorrowRate(
    IDForceInterestRateModel interestRateModel_,
    IDForceCToken cTokenBorrow_,
    uint amountToBorrow_
  ) external view returns (uint) {
    return DForceAprLib.getEstimatedBorrowRate(
      interestRateModel_,
      cTokenBorrow_,
      amountToBorrow_
    );
  }

  function getEstimatedSupplyRatePure(
    uint totalSupply_,
    uint amountToSupply_,
    uint cash_,
    uint totalBorrows_,
    uint totalReserves_,
    IDForceInterestRateModel interestRateModel_,
    uint reserveRatio_,
    uint currentExchangeRate_
  ) external view returns(uint) {
    return DForceAprLib.getEstimatedSupplyRatePure(
      totalSupply_,
      amountToSupply_,
      cash_,
      totalBorrows_,
      totalReserves_,
      interestRateModel_,
      reserveRatio_,
      currentExchangeRate_
    );
  }

  function getEstimatedSupplyRate(
    IDForceCToken cTokenCollateral_,
    uint amountToSupply_
  ) external view returns(uint) {
    return DForceAprLib.getEstimatedSupplyRate(
      cTokenCollateral_,
      amountToSupply_
    );
  }

  function getRawAprInfo36(
    DForceAprLib.DForceCore memory core,
    uint collateralAmount_,
    uint countBlocks_,
    uint amountToBorrow_
  ) external view returns (
    uint borrowApr36,
    uint supplyAprBt36,
    uint rewardsAmountBt36
  ) {
    return DForceAprLib.getRawAprInfo36(
      core,
      collateralAmount_,
      countBlocks_,
      amountToBorrow_
    );
  }

  function getSupplyApr36(
    uint supplyRatePerBlock,
    uint countBlocks,
    uint8 collateralDecimals,
    uint priceCollateral,
    uint priceBorrow,
    uint suppliedAmount
  ) external pure returns (uint) {
    return DForceAprLib.getSupplyApr36(
      supplyRatePerBlock,
      countBlocks,
      collateralDecimals,
      priceCollateral,
      priceBorrow,
      suppliedAmount
    );
  }

  function getBorrowApr36(
    uint borrowRatePerBlock,
    uint borrowedAmount,
    uint countBlocks,
    uint8 borrowDecimals
  ) external pure returns (uint) {
    return DForceAprLib.getBorrowApr36(borrowRatePerBlock, borrowedAmount, countBlocks, borrowDecimals);
  }

  function getRewardAmountsBt(
    DForceAprLib.DForceCore memory core,
    DForceAprLib.RewardsAmountInput memory p_
  ) external view returns (
    uint rewardAmountSupply,
    uint rewardAmountBorrow,
    uint totalRewardsBT
  ) {
    return DForceAprLib.getRewardAmountsBt(core, p_);
  }

  function supplyRewardAmount(
    uint blockSupply_,
    uint stateIndex_,
    uint stateBlock_,
    uint distributionSpeed_,
    uint totalSupply_,
    uint supplyAmount_,
    uint targetBlock_
  ) external view returns (uint) {
    return DForceAprLib.supplyRewardAmount(
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
    DForceAprLib.DForceCore memory core,
    uint borrowAmount_,
    uint distributionSpeed_,
    uint countBlocks_
  ) external view returns (uint rewardAmountBorrow) {
    return DForceAprLib.borrowRewardAmount(
      core,
      borrowAmount_,
      distributionSpeed_,
      countBlocks_
    );
  }

  function borrowRewardAmountInternal(
    DForceAprLib.DBorrowRewardsInput memory p_,
    uint blockToClaimRewards_
  ) external view returns (uint rewardAmountBorrow) {
    return DForceAprLib.borrowRewardAmountInternal(
      p_,
      blockToClaimRewards_
    );
  }

  function getRewardAmount(
    uint accountBalance_,
    uint stateIndex_,
    uint distributionSpeed_,
    uint totalToken_,
    uint accountIndex_,
    uint countBlocks_
  ) external view returns (uint) {
    return DForceAprLib.getRewardAmount(accountBalance_,
      stateIndex_,
      distributionSpeed_,
      totalToken_,
      accountIndex_,
      countBlocks_
    );
  }

  function rmul(uint x, uint y) external pure returns (uint) {
    return DForceAprLib.rmul(x, y);
  }

  function rdiv(uint x, uint y) external pure returns (uint) {
    return DForceAprLib.rdiv(x, y);
  }

}