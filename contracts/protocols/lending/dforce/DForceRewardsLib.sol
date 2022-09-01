// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../../integrations/IERC20Extended.sol";
import "../../../openzeppelin/SafeERC20.sol";
import "../../../openzeppelin/IERC20.sol";
import "../../../integrations/dforce/IDForceController.sol";
import "../../../integrations/dforce/IDForceCToken.sol";
import "../../../integrations/dforce/IDForcePriceOracle.sol";
import "../../../integrations/dforce/IDForceInterestRateModel.sol";
import "../../../integrations/dforce/IDForceRewardDistributor.sol";
import "../../../core/AppErrors.sol";
import "hardhat/console.sol";


/// @notice DForce utils: estimate reward tokens, predict borrow rate in advance
library DForceRewardsLib {

  ///////////////////////////////////////////////////////
  //                  Data type
  ///////////////////////////////////////////////////////
  struct DForceCore {
    IDForceController comptroller;
    IDForceCToken cTokenCollateral;
    IDForceCToken cTokenBorrow;
    IDForceCToken cRewardsToken;
    IDForceRewardDistributor rd;
    IDForceInterestRateModel borrowInterestRateModel;
    IDForceInterestRateModel collateralInterestRateModel;
    IDForcePriceOracle priceOracle;
  }

  /// @notice Set of input params for borrowRewardAmounts function
  struct DBorrowRewardsInput {
    /// @notice Block where the borrow is made
    uint blockNumber;
    uint amountToBorrow;
    uint accrualBlockNumber;

    uint stateIndex;
    uint stateBlock;
    uint borrowIndex;
    uint distributionSpeed;

    uint totalCash;
    uint totalBorrows;
    uint totalReserves;
    uint reserveFactor;

    address interestRateModel;
  }

  struct RewardsAmountInput {
    uint collateralAmount;
    uint borrowAmount;
    uint countBlocks;
    uint delayBlocks;
    uint priceBorrow;
  }

  ///////////////////////////////////////////////////////
  //                  Addresses
  ///////////////////////////////////////////////////////

  /// @notice Get core address of DForce
  function getCore(
    IDForceController comptroller,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) internal view returns (DForceCore memory) {
    IDForceRewardDistributor rd = IDForceRewardDistributor(comptroller.rewardDistributor());
    return DForceCore({
      comptroller: comptroller,
      cTokenCollateral: IDForceCToken(cTokenCollateral_),
      cTokenBorrow: IDForceCToken(cTokenBorrow_),
      cRewardsToken: IDForceCToken(rd.rewardToken()),
      rd: rd,
      borrowInterestRateModel: IDForceInterestRateModel(IDForceCToken(cTokenBorrow_).interestRateModel()),
      collateralInterestRateModel: IDForceInterestRateModel(IDForceCToken(cTokenCollateral_).interestRateModel()),
      priceOracle: IDForcePriceOracle(comptroller.priceOracle())
    });
  }

  ///////////////////////////////////////////////////////
  //                  Estimate APR
  ///////////////////////////////////////////////////////

  /// @notice Calculate APR, take into account all borrow rate, supply rate, borrow and supply tokens.
  function getRawAprInfo(
    DForceCore memory core,
    uint collateralAmount_,
    uint countBlocks_,
    uint amountToBorrow_
  ) internal view returns (
    uint brPeriod18,
    uint supplyIncrementBT18,
    uint rewardsBT18
  ) {
    uint priceCollateral;
    uint priceBorrow;
    {
      bool isPriceValid;

      // getUnderlyingPrice returns price/1e(36-underlineDecimals)
      (priceCollateral, isPriceValid) = core.priceOracle.getUnderlyingPriceAndStatus(address(core.cTokenCollateral));
      require(priceCollateral != 0 && isPriceValid, AppErrors.ZERO_PRICE);

      (priceBorrow, isPriceValid) = core.priceOracle.getUnderlyingPriceAndStatus(address(core.cTokenBorrow));
      require(priceBorrow != 0 && isPriceValid, AppErrors.ZERO_PRICE);
    }

    // estimate amount of supply+borrow rewards in terms of borrow asset
    (,, rewardsBT18) = getRewardAmountsBT18(
      core,
      RewardsAmountInput({
        collateralAmount: collateralAmount_,
        borrowAmount: amountToBorrow_,
        countBlocks: countBlocks_,
        delayBlocks: 1, // we need to estimate rewards inside next (not current) block
        priceBorrow: priceBorrow
      })
    );
    console.log("rewardsBT", rewardsBT18, priceBorrow, core.cTokenCollateral.decimals());

    supplyIncrementBT18 = getEstimatedSupplyRate(
      core.collateralInterestRateModel,
      core.cTokenCollateral,
      collateralAmount_
    )
    * countBlocks_
    * priceCollateral
    * 10**core.cTokenBorrow.decimals()
    / priceBorrow
    / 10**core.cTokenCollateral.decimals();

    console.log("supplyIncrementBT", supplyIncrementBT18);

    // estimate borrow rate value after the borrow and calculate result APR
    brPeriod18 = getEstimatedBorrowRate(
        core.borrowInterestRateModel,
        core.cTokenBorrow,
        amountToBorrow_
      ) * countBlocks_;
  }

  ///////////////////////////////////////////////////////
  //         Estimate borrow and supply rates
  ///////////////////////////////////////////////////////

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  ///         Rewards are not taken into account
  function getEstimatedBorrowRate(
    IDForceInterestRateModel interestRateModel_,
    IDForceCToken cTokenBorrow_,
    uint amountToBorrow_
  ) internal view returns (uint) {
    return interestRateModel_.getBorrowRate(
      cTokenBorrow_.getCash() - amountToBorrow_,
      cTokenBorrow_.totalBorrows() + amountToBorrow_,
      cTokenBorrow_.totalReserves()
    );
  }

  /// @notice Estimate value of variable supply rate after supplying {amountToSupply_}
  ///         Rewards are not taken into account
  function getEstimatedSupplyRate(
    IDForceInterestRateModel interestRateModel_,
    IDForceCToken cTokenCollateral_,
    uint amountToSupply_
  ) internal view returns (uint) {
    console.log("getEstimatedSupplyRate", address(interestRateModel_));
    console.log("cTokenCollateral_.getCash()", cTokenCollateral_.getCash() );
    console.log("cTokenCollateral_.totalBorrows()", cTokenCollateral_.totalBorrows() );
    console.log("cTokenCollateral_.reserveRatio()", cTokenCollateral_.reserveRatio() );
    return interestRateModel_.getSupplyRate(
      cTokenCollateral_.getCash() + amountToSupply_,
      cTokenCollateral_.totalBorrows(),
      cTokenCollateral_.totalReserves(),
      cTokenCollateral_.reserveRatio()
    );
  }

  ///////////////////////////////////////////////////////
  ///       Calculate supply and borrow rewards
  ///////////////////////////////////////////////////////

  function getRewardAmountsBT18(
    DForceCore memory core,
    RewardsAmountInput memory p_
  ) internal view returns (
    uint rewardAmountSupply,
    uint rewardAmountBorrow,
    uint totalRewardsInBorrowAsset
  ) {
    uint distributionSpeed = core.rd.distributionSupplySpeed(address(core.cTokenCollateral));
    if (distributionSpeed != 0) {
      (uint stateIndex, uint stateBlock0) = core.rd.distributionSupplyState(address(core.cTokenCollateral));
      rewardAmountSupply = supplyRewardAmount(
          block.number + p_.delayBlocks,
          stateIndex,
          stateBlock0,
          distributionSpeed,
          core.cTokenCollateral.totalSupply(),
          // actually, after supplying we will have a bit less amount on user's balance
          // because of the supply fee, but we assume that this change can be neglected
          p_.collateralAmount,
          block.number + p_.delayBlocks + p_.countBlocks
      );
    }
    distributionSpeed = core.rd.distributionSpeed(address(core.cTokenBorrow));
    if (distributionSpeed != 0) {
      rewardAmountBorrow = _borrowRewardAmount(core,
        p_.borrowAmount,
        distributionSpeed,
        p_.delayBlocks + p_.countBlocks
      );
    }

    if (rewardAmountSupply + rewardAmountBorrow != 0) {
      (uint priceRewards, bool isPriceValid) = core.priceOracle.getUnderlyingPriceAndStatus(address(core.cRewardsToken));
      require(priceRewards != 0 && isPriceValid, AppErrors.ZERO_PRICE);

      // EA(x) = ( RA_supply(x) + RA_borrow(x) ) * PriceRewardToken / PriceBorrowUnderlying
      totalRewardsInBorrowAsset = (rewardAmountSupply + rewardAmountBorrow)
        * priceRewards
        * core.cTokenBorrow.decimals()
        / p_.priceBorrow
        / 10**core.cRewardsToken.decimals()
      ;
    }

    return (rewardAmountSupply, rewardAmountBorrow, totalRewardsInBorrowAsset);
  }

  /// @notice Take data from DeForce protocol and estimate amount of user's rewards in countBlocks_
  function _borrowRewardAmount(
    DForceCore memory core,
    uint borrowAmount_,
    uint distributionSpeed_,
    uint countBlocks_
  ) internal view returns (uint) {
    (uint stateIndex, uint stateBlock) = core.rd.distributionBorrowState(address(core.cTokenBorrow));
    return borrowRewardAmount(
      DBorrowRewardsInput({
        blockNumber: block.number,
        amountToBorrow: borrowAmount_,

        accrualBlockNumber: core.cTokenBorrow.accrualBlockNumber(),

        stateIndex: stateIndex,
        stateBlock: stateBlock,
        borrowIndex: core.cTokenBorrow.borrowIndex(),
        distributionSpeed: distributionSpeed_,

        totalCash: core.cTokenBorrow.getCash(),
        totalBorrows: core.cTokenBorrow.totalBorrows(),
        totalReserves: core.cTokenBorrow.totalReserves(),
        reserveFactor: core.cTokenBorrow.reserveRatio(),

        interestRateModel: core.cTokenBorrow.interestRateModel()
      }), block.number + countBlocks_
    );
  }

  /// @notice Calculate amount of supply rewards inside the supply-block
  ///         in assumption that after supply no data will be changed on market
  /// @dev Algo repeats original algo implemented in LendingContractsV2.
  ///      github.com:dforce-network/LendingContractsV2.git
  ///      Same algo is implemented in tests, see DForceHelper.predictRewardsStatePointAfterSupply
  function supplyRewardAmount(
    uint blockSupply_,
    uint stateIndex_,
    uint stateBlock_,
    uint distributionSpeed_,
    uint totalSupply_,
    uint supplyAmount_,
    uint targetBlock_
  ) internal pure returns (uint) {

    // nextStateIndex = stateIndex_ +  distributedPerToken
    uint nextStateIndex = stateIndex_ + rdiv(
      distributionSpeed_ * (blockSupply_ - stateBlock_),
      totalSupply_
    );

    return getRewardAmount(
      supplyAmount_,
      nextStateIndex,
      distributionSpeed_,
      totalSupply_ + supplyAmount_,
      nextStateIndex,
      targetBlock_ - blockSupply_
    );
  }

  /// @notice Calculate amount of borrow rewards inside the borrow-block
  ///         in assumption that after borrow no data will be changed on market
  /// @dev Algo repeats original algo implemented in LendingContractsV2.
  ///      github.com:dforce-network/LendingContractsV2.git
  ///      Same algo is implemented in tests, see DForceHelper.predictRewardsAfterBorrow
  function borrowRewardAmount(
    DBorrowRewardsInput memory p_,
    uint blockToClaimRewards_
  ) internal view returns (uint rewardAmountBorrow) {
    // borrow block: before borrow
    uint simpleInterestFactor = (p_.blockNumber - p_.accrualBlockNumber)
      * IDForceInterestRateModel(p_.interestRateModel).getBorrowRate(
          p_.totalCash,
          p_.totalBorrows,
          p_.totalReserves
        );
    uint interestAccumulated = rmul(simpleInterestFactor, p_.totalBorrows);
    p_.totalBorrows += interestAccumulated; // modify p_.totalBorrows - avoid stack too deep
    uint totalReserves = p_.totalReserves + rmul(interestAccumulated, p_.reserveFactor);
    uint borrowIndex = rmul(simpleInterestFactor, p_.borrowIndex) + p_.borrowIndex;
    uint totalTokens = rdiv(p_.totalBorrows, borrowIndex);
    uint userInterest = borrowIndex;

    // borrow block: after borrow
    uint stateIndex = p_.stateIndex + (
      totalTokens == 0
        ? 0
        : rdiv(p_.distributionSpeed * (p_.blockNumber - p_.stateBlock), totalTokens)
    );
    p_.totalBorrows += p_.amountToBorrow;

    // target block (where we are going to claim the rewards)
    simpleInterestFactor = (blockToClaimRewards_ - 1 - p_.blockNumber)
      * IDForceInterestRateModel(p_.interestRateModel).getBorrowRate(
          p_.totalCash + p_.amountToBorrow,
          p_.totalBorrows,
          totalReserves
        );
    interestAccumulated = rmul(simpleInterestFactor, p_.totalBorrows);
    p_.totalBorrows += interestAccumulated;
    borrowIndex += rmul(simpleInterestFactor, borrowIndex);
    totalTokens = rdiv(p_.totalBorrows, borrowIndex);

    return getRewardAmount(
      rdiv(divup(p_.amountToBorrow * borrowIndex, userInterest), borrowIndex),
      stateIndex,
      p_.distributionSpeed,
      totalTokens,
      stateIndex,
      blockToClaimRewards_ - p_.blockNumber
    );
  }

  ///////////////////////////////////////////////////////
  ///  Rewards pre-calculations. The algo repeats the code from
  ///     LendingContractsV2, RewardsDistributorV3.sol, updateDistributionState, updateReward
  ///
  ///  RA(x) = rmul(AB, (SI + rdiv(DS * x, TT)) - AI);
  ///
  /// where:
  ///  RA(x) - reward amount
  ///  x - count of blocks
  ///  AB - account balance (cToken.balance OR rdiv(borrow balance stored, borrow index)
  ///  SI - state index (distribution supply state OR distribution borrow state)
  ///  DS - distribution speed
  ///  TT - total tokens (total supply OR rdiv(total borrow, borrow index)
  ///  TD - total distributed = mul(DS, x)
  ///  DT - distributed per token = rdiv(TD, TT);
  ///  TI - token index, TI = SI + DT = SI + rdiv(DS * x, TT)
  ///  AI - account index (distribution supplier index OR distribution borrower index)
  ///  rmul(x, y): x * y / 1e18
  ///  rdiv(x, y): x * 1e18 / y
  ///
  ///  Total amount of rewards = RA_supply + RA_borrow
  ///
  ///  Earned amount EA per block:
  ///       EA(x) = ( RA_supply(x) + RA_borrow(x) ) * PriceRewardToken / PriceUnderlying
  ///
  ///  borrowIndex is calculated according to Base.sol, _updateInterest() algo
  ///     simpleInterestFactor = borrowRate * blockDelta
  ///     newBorrowIndex = simpleInterestFactor * borrowIndex + borrowIndex
  ///////////////////////////////////////////////////////

  function getRewardAmount(
    uint accountBalance_,
    uint stateIndex_,
    uint distributionSpeed_,
    uint totalToken_,
    uint accountIndex_,
    uint countBlocks_
  ) internal pure returns (uint) {
    uint totalDistributed = distributionSpeed_ * countBlocks_;
    uint dt = rdiv(totalDistributed, totalToken_);
    uint ti = stateIndex_ + dt;
    return rmul(accountBalance_, ti - accountIndex_);
  }

  ///////////////////////////////////////////////////////
  ///                 Math utils
  ///////////////////////////////////////////////////////

  function rmul(uint x, uint y) internal pure returns (uint) {
    return x * y / 10 ** 18;
  }

  function rdiv(uint x, uint y) internal pure returns (uint) {
    require(y != 0, AppErrors.DIVISION_BY_ZERO);
    return x * 10**18 / y;
  }

  function divup(uint x, uint y) internal pure returns (uint) {
    require(y != 0, AppErrors.DIVISION_BY_ZERO);
    return (x + y - 1) / y;
  }
}