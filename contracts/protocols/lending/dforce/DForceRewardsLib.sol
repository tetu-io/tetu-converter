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

  /// @notice Set of input params for borrowRewardAmounts function
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
    distributionSpeed = core.rd.distributionSpeed(address(core.cTokenBorrow));
    if (distributionSpeed != 0) {
      address user = address(0); //TODO
      rewardAmountBorrow = _borrowRewardAmount(core,
        user,
        borrowAmount_,
        distributionSpeed,
        delayBlocks_ + countBlocks_
      );
    }
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

  function _borrowRewardAmount(
    DForceCore memory core,
    address user,
    uint borrowAmount_,
    uint distributionSpeed_,
    uint countBlocks_
  ) internal view returns (uint) {
    (, uint interestIndex) = core.cTokenBorrow.borrowSnapshot(user);
    (uint stateIndex, uint stateBlock) = core.rd.distributionBorrowState(address(core.cTokenBorrow));
    return borrowRewardAmount(
      DBorrowRewardsInput({
        blockNumber: block.number,
        amountToBorrow: borrowAmount_,

        userInterest: interestIndex,
        accrualBlockNumber: core.cTokenBorrow.accrualBlockNumber(),
        borrowBalanceStored: core.cTokenBorrow.borrowBalanceStored(user),

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
    uint totalBorrows = p_.totalBorrows + interestAccumulated;
    uint totalReserves = p_.totalReserves + rmul(interestAccumulated, p_.reserveFactor);
    uint borrowIndex = rmul(simpleInterestFactor, p_.borrowIndex) + p_.borrowIndex;
    uint totalTokens = rdiv(totalBorrows, borrowIndex);

    // borrow block: after borrow
    uint stateIndex = p_.stateIndex + (
      totalTokens == 0
        ? 0
        : rdiv(p_.distributionSpeed * (p_.blockNumber - p_.stateBlock), totalTokens)
    );
    totalBorrows += p_.amountToBorrow;

    // target block (where we are going to claim the rewards)
    simpleInterestFactor = (blockToClaimRewards_ - 1 - p_.blockNumber)
      * IDForceInterestRateModel(p_.interestRateModel).getBorrowRate(
          p_.totalCash + p_.amountToBorrow,
          totalBorrows,
          totalReserves
        );
    interestAccumulated = rmul(simpleInterestFactor, totalBorrows);
    totalBorrows += interestAccumulated;
    borrowIndex += rmul(simpleInterestFactor, borrowIndex);
    totalTokens = rdiv(totalBorrows, borrowIndex);

    return getRewardAmount(
      rdiv(divup(p_.amountToBorrow * borrowIndex, p_.userInterest), borrowIndex),
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