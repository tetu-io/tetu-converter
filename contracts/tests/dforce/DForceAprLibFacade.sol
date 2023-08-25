// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../protocols/dforce/DForceAprLib.sol";

/// @notice Facade for DForceAprLib to make external functions available for tests
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

  function getEstimatedExchangeRate(
    uint totalSupply_,
    uint cash_,
    uint totalBorrows_,
    uint totalReserves_
  ) external pure returns (uint) {
    return DForceAprLib.getEstimatedExchangeRate(totalSupply_, cash_, totalBorrows_, totalReserves_);
  }

  function getRawCostAndIncomes(
    DForceAprLib.DForceCore memory core,
    uint collateralAmount_,
    uint countBlocks_,
    uint amountToBorrow_,
    AppDataTypes.PricesAndDecimals memory pad_,
    IDForcePriceOracle priceOracle_
  ) external view returns (
    uint borrowCost36,
    uint supplyIncomeInBorrowAsset36,
    uint rewardsAmountInBorrowAsset36
  ) {
    return DForceAprLib.getRawCostAndIncomes(
      core,
      collateralAmount_,
      countBlocks_,
      amountToBorrow_,
      pad_,
      priceOracle_
    );
  }

  function getSupplyIncomeInBorrowAsset36(
    uint supplyRatePerBlock,
    uint countBlocks,
    uint collateral10PowDecimals,
    uint priceCollateral,
    uint priceBorrow,
    uint suppliedAmount
  ) external pure returns (uint) {
    return DForceAprLib.getSupplyIncomeInBorrowAsset36(
      supplyRatePerBlock,
      countBlocks,
        collateral10PowDecimals,
      priceCollateral,
      priceBorrow,
      suppliedAmount
    );
  }

  function getBorrowCost36(
    uint borrowRatePerBlock,
    uint borrowedAmount,
    uint countBlocks,
    uint borrow10PowDecimals
  ) external pure returns (uint) {
    return DForceAprLib.getBorrowCost36(borrowRatePerBlock, borrowedAmount, countBlocks, borrow10PowDecimals);
  }

  function getRewardAmountsBt(
    DForceAprLib.DForceCore memory core,
    DForceAprLib.RewardsAmountInput memory p_
  ) external view returns (
    uint rewardAmountSupply,
    uint rewardAmountBorrow,
    uint totalRewardsBT
  ) {
    return DForceAprLib.getRewardAmountInBorrowAsset(core, p_);
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
  ) external pure returns (uint) {
    return DForceAprLib.getRewardAmount(accountBalance_,
      stateIndex_,
      distributionSpeed_,
      totalToken_,
      accountIndex_,
      countBlocks_
    );
  }

  function getBorrowRateAfterBorrow(address borrowCToken_, uint amountToBorrow_) external view returns (uint) {
    return DForceAprLib.getBorrowRateAfterBorrow(borrowCToken_, amountToBorrow_);
  }

  function rmul(uint x, uint y) external pure returns (uint) {
    return DForceAprLib.rmul(x, y);
  }

  function rdiv(uint x, uint y) external pure returns (uint) {
    return DForceAprLib.rdiv(x, y);
  }

  function divup(uint x, uint y) external pure returns (uint) {
    return DForceAprLib.divup(x, y);
  }

  function getPrice(IDForcePriceOracle priceOracle, address token) external view returns (uint) {
    return DForceAprLib.getPrice(priceOracle, token);
  }

  function getUnderlying(address token) public view returns (address) {
    return DForceAprLib.getUnderlying(token);
  }
}
