// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/IERC20Metadata.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../integrations/dforce/IDForceController.sol";
import "../../integrations/dforce/IDForceCToken.sol";
import "../../integrations/dforce/IDForcePriceOracle.sol";
import "../../integrations/dforce/IDForceInterestRateModel.sol";
import "../../integrations/dforce/IDForceRewardDistributor.sol";
import "../../core/AppErrors.sol";
import "../../core/AppUtils.sol";
import "../../openzeppelin/IERC20Metadata.sol";

/// @notice DForce utils: estimate reward tokens, predict borrow rate in advance
library DForceAprLib {
  address internal constant WMATIC = address(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);
  address internal constant iMATIC = address(0x6A3fE5342a4Bd09efcd44AC5B9387475A0678c74);

  ///////////////////////////////////////////////////////
  //                  Data type
  ///////////////////////////////////////////////////////
  struct DForceCore {
    IDForceCToken cTokenCollateral;
    IDForceCToken cTokenBorrow;
    IDForceRewardDistributor rd;
  }

  struct PricesAndDecimals {
    IDForcePriceOracle priceOracle;
    uint collateral10PowDecimals;
    uint borrow10PowDecimals;
    uint priceCollateral36;
    uint priceBorrow36;
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
    uint priceBorrow36;
    IDForcePriceOracle priceOracle;
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
    return DForceCore({
      cTokenCollateral: IDForceCToken(cTokenCollateral_),
      cTokenBorrow: IDForceCToken(cTokenBorrow_),
      rd: IDForceRewardDistributor(comptroller.rewardDistributor())
    });
  }

  ///////////////////////////////////////////////////////
  //                  Estimate APR
  ///////////////////////////////////////////////////////

  /// @notice Calculate costs and incomes, take into account all borrow rate, supply rate, borrow and supply tokens.
  /// @return borrowCost36 Estimated borrow APR for the period, borrow tokens, decimals 36
  /// @return supplyIncomeInBorrowAsset36 Current supply APR for the period (in terms of borrow tokens), decimals 36
  /// @return rewardsAmountInBorrowAsset36 Estimated total amount of rewards at the end of the period
  ///         (in terms of borrow tokens), decimals 36
  function getRawCostAndIncomes(
    DForceCore memory core,
    uint collateralAmount_,
    uint countBlocks_,
    uint amountToBorrow_,
    PricesAndDecimals memory pad_
  ) internal view returns (
    uint borrowCost36,
    uint supplyIncomeInBorrowAsset36,
    uint rewardsAmountInBorrowAsset36
  ) {
    // estimate amount of supply+borrow rewards in terms of borrow asset
    (,, rewardsAmountInBorrowAsset36) = getRewardAmountInBorrowAsset(core,
      RewardsAmountInput({
        collateralAmount: collateralAmount_,
        borrowAmount: amountToBorrow_,
        countBlocks: countBlocks_,
        delayBlocks: 1, // we need to estimate rewards inside next (not current) block
        priceBorrow36: pad_.priceBorrow36,
        priceOracle: pad_.priceOracle
      })
    );

    {
      supplyIncomeInBorrowAsset36 = getSupplyIncomeInBorrowAsset36(
        getEstimatedSupplyRate(core.cTokenCollateral, collateralAmount_),
        countBlocks_,
        pad_.collateral10PowDecimals,
        pad_.priceCollateral36,
        pad_.priceBorrow36,
        collateralAmount_
      );
    }

    // estimate borrow rate value after the borrow and calculate result APR
    borrowCost36 = getBorrowCost36(
      getEstimatedBorrowRate(
        IDForceInterestRateModel(IDForceCToken(core.cTokenBorrow).interestRateModel()),
        core.cTokenBorrow,
        amountToBorrow_
      ),
      amountToBorrow_,
      countBlocks_,
      pad_.borrow10PowDecimals
    );
  }

  /// @notice Calculate supply income in terms of borrow tokens with decimals 36
  function getSupplyIncomeInBorrowAsset36(
    uint supplyRatePerBlock,
    uint countBlocks,
    uint collateral10PowDecimals,
    uint priceCollateral36,
    uint priceBorrow36,
    uint suppliedAmount
  ) internal pure returns (uint) {
    // original code:
    //    rmul(supplyRatePerBlock * countBlocks, suppliedAmount) * priceCollateral / priceBorrow,
    // but we need result decimals 36
    // so, we replace rmul by ordinal mul and take into account /1e18
    return
      supplyRatePerBlock * countBlocks * suppliedAmount * priceCollateral36 / priceBorrow36
      * 1e18 // not 36 because we replaced rmul by mul
      / collateral10PowDecimals;
  }

  /// @notice Calculate borrow APR in terms of borrow tokens with decimals 36
  /// @dev see LendingContractsV2, Base.sol, _updateInterest
  function getBorrowCost36(
    uint borrowRatePerBlock,
    uint borrowedAmount,
    uint countBlocks,
    uint borrow10PowDecimals
  ) internal pure returns (uint) {
    // simpleInterestFactor = borrowRate * blockDelta
    // interestAccumulated = simpleInterestFactor * totalBorrows
    // newTotalBorrows = interestAccumulated + totalBorrows
    uint simpleInterestFactor = borrowRatePerBlock * countBlocks;

    // Replace rmul(simpleInterestFactor, borrowedAmount) by ordinal mul and take into account /1e18
    return
      simpleInterestFactor * borrowedAmount
      * 1e18 // not 36 because we replaced rmul by mul
      / borrow10PowDecimals;
  }

  ///////////////////////////////////////////////////////
  //         Estimate borrow rate
  ///////////////////////////////////////////////////////

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  ///         Rewards are not taken into account
  function getEstimatedBorrowRate(
    IDForceInterestRateModel interestRateModel_,
    IDForceCToken cTokenBorrow_,
    uint amountToBorrow_
  ) internal view returns (uint) {
    uint cash = cTokenBorrow_.getCash();
    require(cash >= amountToBorrow_, AppErrors.WEIRD_OVERFLOW);

    return interestRateModel_.getBorrowRate(
      cash - amountToBorrow_,
      cTokenBorrow_.totalBorrows() + amountToBorrow_,
      cTokenBorrow_.totalReserves()
    );
  }

  ///////////////////////////////////////////////////////
  //         Estimate supply rate
  ///////////////////////////////////////////////////////

  function getEstimatedSupplyRate(
    IDForceCToken cTokenCollateral_,
    uint amountToSupply_
  ) internal view returns(uint) {
    return getEstimatedSupplyRatePure(
      cTokenCollateral_.totalSupply(),
      amountToSupply_,
      cTokenCollateral_.getCash(),
      cTokenCollateral_.totalBorrows(),
      cTokenCollateral_.totalReserves(),
      IDForceInterestRateModel(cTokenCollateral_.interestRateModel()),
      cTokenCollateral_.reserveRatio(),
      cTokenCollateral_.exchangeRateStored()
    );
  }

  /// @dev repeats LendingContractsV2, iToken.sol, supplyRatePerBlock() impl
  function getEstimatedSupplyRatePure(
    uint totalSupply_,
    uint amountToSupply_,
    uint cash_,
    uint totalBorrows_,
    uint totalReserves_,
    IDForceInterestRateModel interestRateModel_,
    uint reserveRatio_,
    uint currentExchangeRate_
  ) internal view returns(uint) {
    require(reserveRatio_ <= 1e18, AppErrors.AMOUNT_TOO_BIG);

    uint totalSupply = totalSupply_ + amountToSupply_ * 1e18 / currentExchangeRate_;

    uint exchangeRateInternal = getEstimatedExchangeRate(
      totalSupply,
      cash_ + amountToSupply_, // cash is increased exactly on amountToSupply_, no approximation here
      totalBorrows_,
      totalReserves_
    );

    uint underlyingScaled = totalSupply * exchangeRateInternal;
    if (underlyingScaled == 0) {
      return 0;
    }

    uint borrowRatePerBlock = interestRateModel_.getBorrowRate(
      cash_ + amountToSupply_,
      totalBorrows_,
      totalReserves_
    );

    return tmul(
      borrowRatePerBlock,
      1e18 - reserveRatio_,
      rdiv(totalBorrows_ * 1e18, underlyingScaled)
    );
  }

  function getEstimatedExchangeRate(
    uint totalSupply_,
    uint cash_,
    uint totalBorrows_,
    uint totalReserves_
  ) internal pure returns (uint) {
    require(cash_ + totalBorrows_ >= totalReserves_, AppErrors.WEIRD_OVERFLOW);
    return totalSupply_ == 0
      ? 0
      : rdiv(cash_ + totalBorrows_ - totalReserves_, totalSupply_);
  }

  ///////////////////////////////////////////////////////
  ///       Calculate supply and borrow rewards
  ///////////////////////////////////////////////////////

  /// @notice Calculate total amount of rewards (supply rewards + borrow rewards) in terms of borrow asset
  function getRewardAmountInBorrowAsset(
    DForceCore memory core,
    RewardsAmountInput memory p_
  ) internal view returns (
    uint rewardAmountSupply,
    uint rewardAmountBorrow,
    uint totalRewardsInBorrowAsset36
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
      rewardAmountBorrow = borrowRewardAmount(core,
        p_.borrowAmount,
        distributionSpeed,
        p_.delayBlocks + p_.countBlocks
      );
    }

    if (rewardAmountSupply + rewardAmountBorrow != 0) {
      // EA(x) = ( RA_supply(x) + RA_borrow(x) ) * PriceRewardToken / PriceBorrowUnderlying
      // recalculate the amount from [rewards tokens] to [borrow tokens]
      totalRewardsInBorrowAsset36 = (rewardAmountSupply + rewardAmountBorrow)
        * getPrice(p_.priceOracle, address(core.rd.rewardToken())) // * 10**core.cRewardsToken.decimals()
        * 10**18
        / p_.priceBorrow36
        * 10**18
        // / 10**core.cRewardsToken.decimals()
      ;
    }

    return (rewardAmountSupply, rewardAmountBorrow, totalRewardsInBorrowAsset36);
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
      distributionSpeed_ * (
        blockSupply_ > stateBlock_
          ? blockSupply_ - stateBlock_
          : 0
      ),
      totalSupply_
    );

    return getRewardAmount(
      supplyAmount_,
      nextStateIndex,
      distributionSpeed_,
      totalSupply_ + supplyAmount_,
      nextStateIndex,
      targetBlock_ > blockSupply_
        ? targetBlock_ - blockSupply_
        : 0
    );
  }

  /// @notice Take data from DeForce protocol and estimate amount of user's rewards in countBlocks_
  function borrowRewardAmount(
    DForceCore memory core,
    uint borrowAmount_,
    uint distributionSpeed_,
    uint countBlocks_
  ) internal view returns (uint) {
    (uint stateIndex, uint stateBlock) = core.rd.distributionBorrowState(address(core.cTokenBorrow));

    return borrowRewardAmountInternal(
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

  /// @notice Calculate amount of borrow rewards inside the borrow-block
  ///         in assumption that after borrow no data will be changed on market
  /// @dev Algo repeats original algo implemented in LendingContractsV2.
  ///      github.com:dforce-network/LendingContractsV2.git
  ///      Same algo is implemented in tests, see DForceHelper.predictRewardsAfterBorrow
  function borrowRewardAmountInternal(
    DBorrowRewardsInput memory p_,
    uint blockToClaimRewards_
  ) internal view returns (uint rewardAmountBorrow) {
    // borrow block: before borrow
    require(p_.blockNumber >= p_.accrualBlockNumber, AppErrors.WEIRD_OVERFLOW);
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
        : rdiv(p_.distributionSpeed * (
            p_.blockNumber > p_.stateBlock
              ? p_.blockNumber - p_.stateBlock
              : 0
        ), totalTokens)
    );
    p_.totalBorrows += p_.amountToBorrow;

    // target block (where we are going to claim the rewards)
    require(blockToClaimRewards_ >= 1 + p_.blockNumber, AppErrors.WEIRD_OVERFLOW);
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
      blockToClaimRewards_ - p_.blockNumber // no overflow, see require above
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

    require(ti >= accountIndex_, AppErrors.WEIRD_OVERFLOW);
    return rmul(accountBalance_, ti - accountIndex_);
  }

  ///////////////////////////////////////////////////////
  ///                 Utils to inline
  ///////////////////////////////////////////////////////
  function getPrice(IDForcePriceOracle priceOracle, address token) internal view returns (uint) {
    (uint price, bool isPriceValid) = priceOracle.getUnderlyingPriceAndStatus(token);
    require(price != 0 && isPriceValid, AppErrors.ZERO_PRICE);
    return price;
  }

  function getUnderlying(address token) internal view returns (address) {
    return token == iMATIC
      ? WMATIC
      : IDForceCToken(token).underlying();
  }

///////////////////////////////////////////////////////
  ///  Math utils, see LendingContractsV2, SafeRatioMath.sol
  ///////////////////////////////////////////////////////

  function rmul(uint x, uint y) internal pure returns (uint) {
    return x * y / 10**18;
  }

  function rdiv(uint x, uint y) internal pure returns (uint) {
    require(y != 0, AppErrors.DIVISION_BY_ZERO);
    return x * 10**18 / y;
  }

  function divup(uint x, uint y) internal pure returns (uint) {
    require(y != 0, AppErrors.DIVISION_BY_ZERO);
    return (x + y - 1) / y;
  }

  function tmul(uint256 x, uint256 y, uint256 z) internal pure returns (uint256 result) {
    result = x * y * z / 10**36;
  }
}
