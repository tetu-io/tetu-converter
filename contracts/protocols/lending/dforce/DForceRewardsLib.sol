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
  // Estimate borrow rate
  ///////////////////////////////////////////////////////
  struct DForceCore {
    IDForceCToken cTokenCollateral;
    IDForceCToken cTokenBorrow;
    IDForceCToken cRewardsToken;
    IDForceRewardDistributor rd;
    IDForceInterestRateModel interestRateModel;
    IDForcePriceOracle priceOracle;
  }

  /// @notice the data before borrow
  struct DBorrowRewardsInput {
    /// @notice Block where the borrow is made
    uint blockNumber;
    uint amountToBorrow;

    uint userInterest;
    uint accrualBlockNumber;
    uint borrowBalanceStored;

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

  /// @notice Get core address of DForce
  function getCore(
    IDForceController comptroller,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) internal view returns (DForceCore memory) {
    IDForceRewardDistributor rd = IDForceRewardDistributor(comptroller.rewardDistributor());
    return DForceCore({
      cTokenCollateral: IDForceCToken(cTokenCollateral_),
      cTokenBorrow: IDForceCToken(cTokenBorrow_),
      cRewardsToken: IDForceCToken(rd.rewardToken()),
      rd: rd,
      interestRateModel: IDForceInterestRateModel(IDForceCToken(cTokenBorrow_).interestRateModel()),
      priceOracle: IDForcePriceOracle(comptroller.priceOracle())
    });
  }

  ///////////////////////////////////////////////////////
  // Estimate borrow rate
  ///////////////////////////////////////////////////////

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  function getEstimatedBorrowRate(
    IDForceInterestRateModel interestRateModel_,
    IDForceCToken cTokenBorrow_,
    uint amountToBorrow_
  ) internal view returns (uint) {
    console.log("getEstimatedBorrowRate");
    console.log("getEstimatedBorrowRate cash", cTokenBorrow_.getCash());
    console.log("getEstimatedBorrowRate totalBorrows", cTokenBorrow_.totalBorrows());
    console.log("getEstimatedBorrowRate totalReserves", cTokenBorrow_.totalReserves());
    return interestRateModel_.getBorrowRate(
      cTokenBorrow_.getCash() - amountToBorrow_,
      cTokenBorrow_.totalBorrows() + amountToBorrow_,
      cTokenBorrow_.totalReserves()
    );
  }

  /// @notice
  function getApr18(
    DForceCore memory core,
    uint collateralAmount_,
    uint countBlocks_,
    uint amountToBorrow_
  ) internal view returns (uint outApr18) {
    // estimate by what amount should BR be reduced due to supply+borrow rewards
    (,,uint borrowAmountToReturn) = getRewardAmounts(core,
      collateralAmount_,
      amountToBorrow_,
      countBlocks_,
      1 // we need to estimate rewards inside next (not current) block
    );
    console.log("borrowAmountToReturn", borrowAmountToReturn);

    outApr18 = getEstimatedBorrowRate(
      core.interestRateModel,
      core.cTokenBorrow,
      amountToBorrow_ //TODO: we need a proof that such estimation is valid
    ) * countBlocks_;
    console.log("outApr18-2", outApr18);
  }

  ///////////////////////////////////////////////////////
  ///       Calculate supply and borrow rewards
  ///////////////////////////////////////////////////////

  function getRewardAmounts(
    DForceCore memory core,
    uint collateralAmount_,
    uint borrowAmount_,
    uint countBlocks_,
    uint delayBlocks_
  ) internal view returns (
    uint rewardAmountSupply,
    uint rewardAmountBorrow,
    uint totalRewardsInBorrowAsset
  ) {
    uint distributionSpeed = core.rd.distributionSupplySpeed(address(core.cTokenCollateral));
    if (distributionSpeed != 0) {
      (uint stateIndex, uint stateBlock0) = core.rd.distributionSupplyState(address(core.cTokenCollateral));
      rewardAmountSupply = supplyRewardAmount(
          block.number + delayBlocks_,
          stateIndex,
          stateBlock0,
          distributionSpeed,
          core.cTokenCollateral.totalSupply(),
          // actually, after supplying we will have a bit less amount on user's balance
          // because of the supply fee, but we assume that this change can be neglected
          collateralAmount_,
          block.number + delayBlocks_ + countBlocks_
      );
    }
    rewardAmountBorrow = borrowRewardAmounts(core, borrowAmount_, countBlocks_);
    totalRewardsInBorrowAsset = rewardAmountSupply + rewardAmountBorrow;

    if (totalRewardsInBorrowAsset != 0) {
      // EA(x) = ( RA_supply(x) + RA_borrow(x) ) * PriceRewardToken / PriceBorrowUnderlying
      totalRewardsInBorrowAsset = totalRewardsInBorrowAsset
        * core.priceOracle.getUnderlyingPrice(address(core.cRewardsToken))
        * 10**core.cTokenBorrow.decimals()
        / core.priceOracle.getUnderlyingPrice(address(core.cTokenBorrow))
        / 10**core.cRewardsToken.decimals()
      ;
    }

    return (rewardAmountSupply, rewardAmountBorrow, totalRewardsInBorrowAsset);
  }

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

  function borrowRewardAmounts(
    DBorrowRewardsInput memory p_,
    uint blockToClaimRewards_
  ) internal view returns (uint rewardAmountBorrow) {
    uint borrowRate = IDForceInterestRateModel(p_.interestRateModel).getBorrowRate(
      p_.totalCash,
      p_.totalBorrows,
      p_.totalReserves
    );

    uint simpleInterestFactor = (p_.blockNumber - p_.accrualBlockNumber) * borrowRate;
    uint interestAccumulated = rmul(simpleInterestFactor, p_.totalBorrows);
    uint totalBorrows = p_.totalBorrows + interestAccumulated;
    uint totalReserves = p_.totalReserves + rmul(interestAccumulated, p_.reserveFactor);
    uint borrowIndex = rmul(simpleInterestFactor, p_.borrowIndex) + p_.borrowIndex;
    uint stateIndex = TODO


    // current borrow index => new borrow index
    borrowIndex += rmul(
      core.interestRateModel.getBorrowRate(
        core.cTokenBorrow.getCash(), //TODO
        core.cTokenBorrow.totalBorrows() + amountToBorrow_,
        core.cTokenBorrow.totalReserves()
      ) * countBlocks_,
      borrowIndex
    );

    (uint stateIndex,) = core.rd.distributionBorrowState(address(core.cTokenBorrow));
    rewardAmountBorrow = getRewardAmount(
      rdiv(core.cTokenBorrow.borrowBalanceStored(address(this)) + amountToBorrow_, borrowIndex),
      stateIndex,
      distributionSpeed,
      rdiv(core.cTokenBorrow.totalBorrows(), borrowIndex),
      core.rd.distributionBorrowerIndex(address(core.cTokenBorrow), address(this)),
      countBlocks_
    );

    return rewardAmountBorrow;
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

}