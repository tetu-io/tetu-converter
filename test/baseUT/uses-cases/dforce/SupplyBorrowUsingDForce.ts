import {TokenDataTypes} from "../../types/TokenDataTypes";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import hre, {ethers} from "hardhat";
import {
  DForceHelper, IBorrowRewardsPredictionInput, IBorrowRewardsStatePoint,
  IDForceMarketAccount,
  IDForceMarketRewards, IRewardsStatePoint, ISupplyRewardsStatePoint
} from "../../../../scripts/integration/helpers/DForceHelper";
import {
  IDForceController, IDForceCToken,
  IDForceCToken__factory, IDForceInterestRateModel, IDForceInterestRateModel__factory,
  IDForceRewardDistributor,
  IERC20__factory
} from "../../../../typechain";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

//region Data types
export interface ISnapshot {
  market: IDForceMarketRewards;
  account: IDForceMarketAccount;
  totalSupply: BigNumber;
  rewards: BigNumber;
  block: BigNumber;
}

export interface ISnapshotBorrowToken {
  market: IDForceMarketRewards;
  account: IDForceMarketAccount;
  totalBorrows: BigNumber;
  borrowIndex: BigNumber;
  borrowBalanceStored: BigNumber;
  rewards: BigNumber;
  block: BigNumber;
}

export interface IRewardsStateC {
  supplyRewardsAmount: BigNumber;
  newSupplyStateIndex: BigNumber;
}

export interface IRewardsStateB {
  borrowRewardsAmount: BigNumber;
  newBorrowStateIndex: BigNumber;
}
//endregion Data types

export class SupplyBorrowUsingDForce {

//region Utils
  static async getState(
    comptroller: IDForceController
    , rd: IDForceRewardDistributor
    , cToken: IDForceCToken
    , user: string
  ) : Promise<ISnapshot> {
    const priceOracle = await DForceHelper.getPriceOracle(comptroller
      , await DeployerUtils.startImpersonate(user)
    );
    const market = await DForceHelper.getRewardsForMarket(comptroller, rd, cToken, priceOracle);
    const account = await DForceHelper.getMarketAccountRewardsInfo(comptroller, rd, cToken, user);
    const rewards = await rd.reward(user);
    const totalSupply = await cToken.totalSupply();
    const block = BigNumber.from( (await hre.ethers.provider.getBlock("latest")).number );
    return {
      market,
      account,
      totalSupply,
      rewards,
      block
    };
  }

  static async getStateBorrowToken(
    comptroller: IDForceController
    , rd: IDForceRewardDistributor
    , cToken: IDForceCToken
    , user: string
  ) : Promise<ISnapshotBorrowToken> {
    const priceOracle = await DForceHelper.getPriceOracle(comptroller
      , await DeployerUtils.startImpersonate(user)
    );
    const market = await DForceHelper.getRewardsForMarket(comptroller, rd, cToken, priceOracle);
    const account = await DForceHelper.getMarketAccountRewardsInfo(comptroller, rd, cToken, user);
    const rewards = await rd.reward(user);
    const block = BigNumber.from( (await hre.ethers.provider.getBlock("latest")).number );
    const totalBorrows = await cToken.totalBorrows();
    const borrowIndex = await cToken.borrowIndex();
    const borrowBalanceStored = await cToken.borrowBalanceStored(user);
    return {
      market,
      account,
      totalBorrows,
      borrowIndex,
      borrowBalanceStored,
      rewards,
      block
    };
  }

  static async getRewardsStateC(
    st: ISnapshot,
    block: BigNumber
  ) : Promise<IRewardsStateC> {
    const r0 = DForceHelper.getSupplyRewardsAmount(
      DForceHelper.getRewardsStatePointForSupply(
        st.market
        , st.account
        , st.totalSupply
      )
      , block
    );
    return {
      supplyRewardsAmount: r0.rewardsAmount,
      newSupplyStateIndex: r0.newSupplyStateIndex,
    }
  }

  static async getRewardsStateB(
    stb: ISnapshotBorrowToken,
    block: BigNumber,
    borrowIndex: BigNumber,
    borrowBalanceStored: BigNumber,
    totalBorrows: BigNumber
  ) : Promise<IRewardsStateB> {
    const r1 = DForceHelper.getBorrowRewardsAmount(
      DForceHelper.getRewardsStatePointForBorrow(
        stb.market
        , stb.account
        , totalBorrows
        , borrowIndex
        , borrowBalanceStored
      )
      , block
    );

    return {
      borrowRewardsAmount: r1.rewardsAmount,
      newBorrowStateIndex: r1.newBorrowStateIndex
    }
  }
//endregion Utils

//region Supply-test-impl
  /**
   * Supply amount. Update distribution and rewards.
   * Wait some blocks. Update distribution and rewards.
   * Claim rewards.
   *
   * Ensure, that amount of received rewards is same as pre-calculated
   */
  static async makeSupplyRewardsTest(
    deployer: SignerWithAddress,
    asset1: TokenDataTypes,
    cToken1: TokenDataTypes,
    holder1: string,
    collateralAmount1: BigNumber,
    periodInBlocks: number
  ) : Promise<{
    rewardsEarnedManual: BigNumber,
    rewardsEarnedActual: BigNumber,
    rewardsReceived: BigNumber
  }>{
    const user = await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address);

    const comptroller = await DForceHelper.getController(deployer);
    const rd = await DForceHelper.getRewardDistributor(comptroller, deployer);
    const cToken = IDForceCToken__factory.connect(cToken1.address, deployer);

    const before = await this.getState(comptroller, rd, cToken, user.address);
    console.log("before", before);

    // supply
    await DForceHelper.supply(user, asset1, cToken1, holder1, collateralAmount1);

    const afterSupply = await this.getState(comptroller, rd, cToken, user.address);
    console.log("afterSupply", afterSupply);

    // forced update rewards
    await rd.updateDistributionState(cToken1.address, false);
    await rd.updateReward(cToken1.address, user.address, false);

    const middle = await this.getState(comptroller, rd, cToken, user.address);
    console.log("middle", middle);

    // move time
    await TimeUtils.advanceNBlocks(periodInBlocks);

    const afterAdvance = await this.getState(comptroller, rd, cToken, user.address);
    console.log("afterAdvance", afterAdvance);

    // forced update rewards
    await rd.updateDistributionState(cToken1.address, false);
    const afterUDC = await this.getState(comptroller, rd, cToken, user.address);
    console.log("afterUDC", afterUDC);

    await rd.updateReward(cToken1.address, user.address, false);

    // get results
    const after = await this.getState(comptroller, rd, cToken, user.address);
    console.log("after", after);

    // manually calculate rewards
    // one part of the rewards we get in the period
    // [supply, update-rewards1)
    const r0 = DForceHelper.getSupplyRewardsAmount(
      DForceHelper.getRewardsStatePointForSupply(
        afterSupply.market
        , afterSupply.account
        , afterSupply.totalSupply
      )
      , BigNumber.from(middle.block.sub(1))
    );

    // another part of the rewards we get in next block where calcDistributionStateSupply is called
    // [update-rewards1, calcDistributionStateSupply2)
    const r1 = DForceHelper.getSupplyRewardsAmount(
      DForceHelper.getRewardsStatePointForSupply(
        middle.market
        , middle.account
        , middle.totalSupply
      )
      , BigNumber.from(afterUDC.block)
    );

    console.log(`Manual0: newSupplyStateIndex=${r0.newSupplyStateIndex} rewardsAmount=${r0.rewardsAmount}` );
    console.log(`Manual1: newSupplyStateIndex=${r1.newSupplyStateIndex} rewardsAmount=${r1.rewardsAmount}` );
    const totalRewards = r0.rewardsAmount.add(r1.rewardsAmount);
    console.log(`Total manual: rewardsAmount=${totalRewards}` );
    console.log(`Actual: newSupplyStateIndex=${after.market.distributionSupplyState_Index} rewardsAmount=${after.rewards}`);

    const rewardsBalance0 = await IERC20__factory.connect(before.market.rewardToken, user).balanceOf(user.address);
    await rd.claimReward([user.address], [cToken.address]);
    const rewardsBalance1 = await IERC20__factory.connect(before.market.rewardToken, user).balanceOf(user.address);

    return {
      rewardsEarnedManual: totalRewards,
      rewardsEarnedActual: after.rewards,
      rewardsReceived: rewardsBalance1.sub(rewardsBalance0)
    };
  }

  /**
   * Supply amount. Wait some blocks. Update distribution and rewards. Claim rewards.
   * Ensure, that amount of received rewards is same as pre-calculated
   */
  static async makeSupplyRewardsTestMinimumTransactions(
    deployer: SignerWithAddress,
    user: SignerWithAddress,
    collateralAsset: TokenDataTypes,
    cToken1: TokenDataTypes,
    collateralHolder: string,
    collateralAmount: BigNumber,
    periodInBlocks: number
  ) : Promise<{
    rewardsEarnedActual: BigNumber,
    rewardsReceived: BigNumber,
    supplyPoint: ISupplyRewardsStatePoint,
    blockUpdateDistributionState: BigNumber
  }>{
    const comptroller = await DForceHelper.getController(deployer);
    const rd = await DForceHelper.getRewardDistributor(comptroller, deployer);
    const cToken = IDForceCToken__factory.connect(cToken1.address, deployer);

    const before = await this.getState(comptroller, rd, cToken, user.address);
    console.log("before", before);

    // supply
    await DForceHelper.supply(user, collateralAsset, cToken1, collateralHolder, collateralAmount);

    const afterSupply = await this.getState(comptroller, rd, cToken, user.address);
    console.log("afterSupply", afterSupply);

    // move time
    await TimeUtils.advanceNBlocks(periodInBlocks);

    // forced update rewards
    await rd.updateDistributionState(cToken1.address, false);
    const afterUDC = await this.getState(comptroller, rd, cToken, user.address);
    console.log("afterUDC", afterUDC);

    await rd.updateReward(cToken1.address, user.address, false);

    // get results
    const after = await this.getState(comptroller, rd, cToken, user.address);
    console.log("after", after);

    const rewardsBalance0 = await IERC20__factory.connect(before.market.rewardToken, user).balanceOf(user.address);
    await rd.claimReward([user.address], [cToken.address]);
    const rewardsBalance1 = await IERC20__factory.connect(before.market.rewardToken, user).balanceOf(user.address);

    return {
      rewardsEarnedActual: after.rewards,
      rewardsReceived: rewardsBalance1.sub(rewardsBalance0),
      supplyPoint: DForceHelper.getSupplyRewardsStatePoint(
        afterSupply.block,
        before.market,
        before.totalSupply,
        // DForce has a supply fee, so this amount is a bit less than initial collateral
        afterSupply.account.accountBalance
      ),
      blockUpdateDistributionState: afterUDC.block
    };
  }
//endregion Supply-test-impl

//region Borrow-test-impl
  /**
   * ONLY borrow rewards.
   *
   * Supply amount 1 and borrow amount 2.
   * Wait some blocks.
   * Claim rewards.
   * Ensure, that amount of received borrow rewards is same as pre-calculated
   */
  static async makeBorrowRewardsOnlyTest(
    deployer: SignerWithAddress,
    collateralAsset: TokenDataTypes,
    cTokenCollateral: TokenDataTypes,
    holderCollateral: string,
    collateralAmount: BigNumber,
    borrowAsset: TokenDataTypes,
    cTokenBorrow: TokenDataTypes,
    holderBorrow: string,
    borrowAmount: BigNumber,
    periodInBlocks: number
  ) : Promise<{
    rewardsEarnedActual: BigNumber,
    rewardsReceived: BigNumber,
    predictData: IBorrowRewardsPredictionInput,
    blockUpdateDistributionState: BigNumber,
    interestRateModel: IDForceInterestRateModel
  }>{
    const user = await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address);
    const comptroller = await DForceHelper.getController(deployer);
    const rd = await DForceHelper.getRewardDistributor(comptroller, deployer);
    const cToken = IDForceCToken__factory.connect(cTokenCollateral.address, deployer);
    const bToken = IDForceCToken__factory.connect(cTokenBorrow.address, deployer);

    const before = await this.getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("before", before);

    // supply collateral
    await DForceHelper.supply(user, collateralAsset, cTokenCollateral, holderCollateral, collateralAmount);

    const afterSupply = await this.getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterSupply", afterSupply);

    const accrualBlockNumberBeforeBorrow = await bToken.accrualBlockNumber();
    const borrowRateBeforeBorrow = await IDForceInterestRateModel__factory.connect(
      await bToken.interestRateModel()
      , deployer
    ).getBorrowRate(
      await bToken.getCash(),
      await bToken.totalBorrows(),
      await bToken.totalReserves()
    );
    console.log(`BeforeBorrow: accrualBlockNumber=${accrualBlockNumberBeforeBorrow} borrowRate=${borrowRateBeforeBorrow}`);
    console.log("Borrower.borrowIndex", await bToken.borrowSnapshot(user.address));
    console.log("getCash", await bToken.getCash());
    const totalReserves = await bToken.totalReserves();
    const reserveRatio = await bToken.reserveRatio();
    const cash = await bToken.getCash();
    console.log("totalReserves", await bToken.totalReserves());
    console.log("reserveRatio", await bToken.reserveRatio());

    // borrow
    await DForceHelper.borrow(user, cTokenBorrow, borrowAmount);

    const afterBorrow = await this.getStateBorrowToken(comptroller, rd, bToken, user.address);
    const borrowSnapshot =  await bToken.borrowSnapshot(user.address);
    console.log("afterBorrow", afterBorrow);
    console.log("Borrower.borrowIndex", borrowSnapshot);

    // estimate amount of rewards using DForceHelper utils
    const predictData: IBorrowRewardsPredictionInput = {
      amountToBorrow: borrowAmount,
      distributionSpeed: afterSupply.market.distributionSpeed,
      userInterest: borrowSnapshot.interestIndex,
      totalReserves: totalReserves,
      totalBorrows: afterSupply.totalBorrows,
      totalCash: cash,
      accrualBlockNumber: accrualBlockNumberBeforeBorrow,
      blockNumber: afterBorrow.block,
      reserveFactor: reserveRatio,
      borrowIndex: afterSupply.borrowIndex,
      borrowBalanceStored: afterSupply.borrowBalanceStored,
      stateBlock: afterSupply.market.distributionBorrowState_Block,
      stateIndex: afterSupply.market.distributionBorrowState_Index
    };

    // move time ahead and update interest
    await TimeUtils.advanceNBlocks(periodInBlocks);
    const accrualBlockNumberAfterBorrow = await bToken.accrualBlockNumber();
    const borrowRateAfterBorrow = await IDForceInterestRateModel__factory.connect(
      await bToken.interestRateModel()
      , deployer
    ).getBorrowRate(
      await bToken.getCash(),
      await bToken.totalBorrows(),
      await bToken.totalReserves()
    );
    console.log(`AfterBorrow: accrualBlockNumber=${accrualBlockNumberAfterBorrow} borrowRate=${borrowRateAfterBorrow}`);
    console.log("Before updateInterest Borrower.borrowIndex", await bToken.borrowSnapshot(user.address));
    console.log("getCash", await bToken.getCash());
    console.log("totalBorrows", await bToken.totalBorrows());
    console.log("totalReserves", await bToken.totalReserves());

    await bToken.updateInterest(); //see comments below

    const afterAdvance = await this.getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterAdvance", afterAdvance);
    console.log("After updateInterest Borrower.borrowIndex", await bToken.borrowSnapshot(user.address));

    // forced update rewards
    await rd.updateDistributionState(cTokenBorrow.address, true);
    const afterUDC = await this.getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterUDCSupply", afterUDC);
    console.log("Borrower.borrowIndex", await bToken.borrowSnapshot(user.address));

    await rd.updateReward(cTokenBorrow.address, user.address, true);

    const after = await this.getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("after", after);

    const rewardsBalance0 = await IERC20__factory.connect(before.market.rewardToken, user).balanceOf(user.address);
    await rd.claimReward([user.address], [cToken.address]);
    const rewardsBalance1 = await IERC20__factory.connect(before.market.rewardToken, user).balanceOf(user.address);

    return {
      rewardsEarnedActual: after.rewards,
      rewardsReceived: rewardsBalance1.sub(rewardsBalance0),
      blockUpdateDistributionState: afterUDC.block,
      predictData,
      interestRateModel: IDForceInterestRateModel__factory.connect(
        await bToken.interestRateModel()
        , deployer
      )
    };
  }
//endregion Borrow-test-impl

//region Supply-borrow-test-impl
  /**
   * Supply amount 1 and borrow amount 2.
   * Wait some blocks.
   * Repay the borrow completely.
   * Claim rewards.
   * Ensure, that amount of received rewards is same as pre-calculated
   */
  static async makeBorrowRewardsTest(
    deployer: SignerWithAddress,
    collateralAsset: TokenDataTypes,
    cTokenCollateral: TokenDataTypes,
    holderCollateral: string,
    collateralAmount: BigNumber,
    borrowAsset: TokenDataTypes,
    cTokenBorrow: TokenDataTypes,
    holderBorrow: string,
    borrowAmount: BigNumber,
    periodInBlocks: number
  ) : Promise<{
    rewardsEarnedManual: BigNumber,
    rewardsEarnedActual: BigNumber,
    rewardsReceived: BigNumber,
    /// paid-amount - borrow-amount
    cost: BigNumber
  }>{
    const user = await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address);
    const comptroller = await DForceHelper.getController(deployer);
    const rd = await DForceHelper.getRewardDistributor(comptroller, deployer);
    const cToken = IDForceCToken__factory.connect(cTokenCollateral.address, deployer);
    const bToken = IDForceCToken__factory.connect(cTokenBorrow.address, deployer);

    const before = await this.getState(comptroller, rd, cToken, user.address);
    const beforeB = await this.getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("before", before, beforeB);

    // supply collateral
    await DForceHelper.supply(user, collateralAsset, cTokenCollateral, holderCollateral, collateralAmount);

    const afterSupply = await this.getState(comptroller, rd, cToken, user.address);
    const afterSupplyB = await this.getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterSupply", afterSupply, afterSupplyB);

    // borrow
    await DForceHelper.borrow(user, cTokenBorrow, borrowAmount);

    const afterBorrow = await this.getState(comptroller, rd, cToken, user.address);
    const afterBorrowB = await this.getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterBorrow", afterBorrow, afterBorrowB);

    // move time ahead
    await TimeUtils.advanceNBlocks(periodInBlocks);
    await bToken.updateInterest(); //see comment below to rAfterRepay

    const afterAdvance = await this.getState(comptroller, rd, cToken, user.address);
    const afterAdvanceB = await this.getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterAdvance", afterAdvance, afterAdvanceB);

    // repay completely
    const paidAmount = await DForceHelper.repayAll(user, borrowAsset, cTokenBorrow, holderBorrow);

    const afterRepay = await this.getState(comptroller, rd, cToken, user.address);
    const afterRepayB = await this.getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterRepay", afterRepay, afterRepayB);

    // forced update rewards
    await rd.updateDistributionState(cTokenCollateral.address, false);
    const afterUDCSupply = await this.getState(comptroller, rd, cToken, user.address);
    const afterUDCSupplyB = await this.getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterUDCSupply", afterUDCSupply, afterUDCSupplyB);

    await rd.updateDistributionState(cTokenBorrow.address, true);
    const afterUDCBorrow = await this.getState(comptroller, rd, cToken, user.address);
    const afterUDCBorrowB = await this.getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterUDCBorrow", afterUDCBorrow, afterUDCBorrowB);

    await rd.updateReward(cTokenCollateral.address, user.address, false);
    await rd.updateReward(cTokenBorrow.address, user.address, true);

    const after = await this.getState(comptroller, rd, cToken, user.address);
    const afterB = await this.getState(comptroller, rd, bToken, user.address);
    console.log("after", after, afterB);

    // manually calculate supply rewards for user
    const rAfterRepay = await this.getRewardsStateB(afterAdvanceB
      , afterRepayB.block
      // We have a problem here.
      // Repay is called in several blocks after afterAdvanceB
      // so, borrowIndex can be a bit different.
      // We explicitly call updateInterest after advanceNBlocks, so it can be not enough.
      // It's necessary to get borrowIndex from the transaction where Repay is called
      // to exclude any errors. Anyway, difference is small, so test is passed anyway
      , afterAdvanceB.borrowIndex
      , afterAdvanceB.borrowBalanceStored
      , afterAdvanceB.totalBorrows
    );
    console.log("rAfterRepay", rAfterRepay);
    const rAfterUDCSupply = await this.getRewardsStateC(afterRepay, afterUDCSupply.block);
    console.log("rAfterUDCSupply", rAfterUDCSupply);
    const rAfterUDCBorrow = await this.getRewardsStateB(afterUDCSupplyB
      , afterUDCBorrowB.block
      , afterUDCSupplyB.borrowIndex
      , afterUDCSupplyB.borrowBalanceStored
      , afterUDCSupplyB.totalBorrows
    );
    console.log("rAfterUDCBorrow", rAfterUDCBorrow);

    const rewardsBalance0 = await IERC20__factory.connect(before.market.rewardToken, user).balanceOf(user.address);
    await rd.claimReward([user.address], [cToken.address]);
    const rewardsBalance1 = await IERC20__factory.connect(before.market.rewardToken, user).balanceOf(user.address);

    const cost = paidAmount.sub(borrowAmount);
    return {
      rewardsEarnedManual: [
        rAfterRepay.borrowRewardsAmount,
        rAfterUDCSupply.supplyRewardsAmount,
        rAfterUDCBorrow.borrowRewardsAmount,
      ].reduce((cur, prev) => cur.add(prev), BigNumber.from(0)),
      rewardsEarnedActual: after.rewards,
      rewardsReceived: rewardsBalance1.sub(rewardsBalance0),
      cost: cost
    };
  }
//endregion supply-borrow-test-impl

}