import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
  IDForceController, IDForceCToken,
  IDForceCToken__factory, IDForceRewardDistributor, IERC20__factory
} from "../../../../../typechain";
import {expect, use} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../../../baseUT/types/TokenDataTypes";
import {
  DForceHelper,
  IDForceMarketAccount,
  IDForceMarketRewards
} from "../../../../../scripts/integration/helpers/DForceHelper";

/**
 * Supply amount => claim rewards in specified period
 * Borrow amount => claim rewards in specified period
 */
describe("DForce rewards tests", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

  beforeEach(async function () {
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
  });
//endregion before, after

//region Utils
  interface ISnapshot {
    market: IDForceMarketRewards;
    account: IDForceMarketAccount;
    totalSupply: BigNumber;
    rewards: BigNumber;
    block: BigNumber;
  }
  interface ISnapshotBorrowToken {
    market: IDForceMarketRewards;
    account: IDForceMarketAccount;
    totalBorrows: BigNumber;
    borrowIndex: BigNumber;
    borrowBalanceStored: BigNumber;
    rewards: BigNumber;
    block: BigNumber;
  }

  interface IRewardsStateC {
    supplyRewardsAmount: BigNumber;
    newSupplyStateIndex: BigNumber;
  }
  interface IRewardsStateB {
    borrowRewardsAmount: BigNumber;
    newBorrowStateIndex: BigNumber;
  }

  async function getState(
    comptroller: IDForceController
    , rd: IDForceRewardDistributor
    , cToken: IDForceCToken
    , user: string
  ) : Promise<ISnapshot> {
    const market = await DForceHelper.getRewardsForMarket(comptroller, rd, cToken);
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

  async function getStateBorrowToken(
    comptroller: IDForceController
    , rd: IDForceRewardDistributor
    , cToken: IDForceCToken
    , user: string
  ) : Promise<ISnapshotBorrowToken> {
    const market = await DForceHelper.getRewardsForMarket(comptroller, rd, cToken);
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

  async function getRewardsStateC(
    st: ISnapshot,
    block: BigNumber
  ) : Promise<IRewardsStateC> {
    const r0 = DForceHelper.getSupplyRewardsAmount(
      st.market
      , st.account
      , st.totalSupply
      , block
    );
    return {
      supplyRewardsAmount: r0.rewardsAmount,
      newSupplyStateIndex: r0.newSupplyStateIndex,
    }
  }

  async function getRewardsStateB(
    stb: ISnapshotBorrowToken,
    block: BigNumber,
    borrowIndex: BigNumber,
    borrowBalanceStored: BigNumber,
    totalBorrows: BigNumber
  ) : Promise<IRewardsStateB> {
    const r1 = DForceHelper.getBorrowRewardsAmount(
      stb.market
      , stb.account
      , totalBorrows
      , borrowIndex
      , borrowBalanceStored
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
   * Supply amount. Wait some blocks. Claim rewards.
   * Ensure, that amount of received rewards is same as pre-calculated
   */
  async function makeSupplyRewardsTest(
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

    const before = await getState(comptroller, rd, cToken, user.address);
    console.log("before", before);

    // supply
    await DForceHelper.supply(user, asset1, cToken1, holder1, collateralAmount1);

    const afterSupply = await getState(comptroller, rd, cToken, user.address);
    console.log("afterSupply", afterSupply);

    // forced update rewards
    await rd.updateDistributionState(cToken1.address, false);
    await rd.updateReward(cToken1.address, user.address, false);

    const middle = await getState(comptroller, rd, cToken, user.address);
    console.log("middle", middle);

    // move time
    await TimeUtils.advanceNBlocks(periodInBlocks);

    const afterAdvance = await getState(comptroller, rd, cToken, user.address);
    console.log("afterAdvance", afterAdvance);

    // forced update rewards
    await rd.updateDistributionState(cToken1.address, false);
    const afterUDC = await getState(comptroller, rd, cToken, user.address);
    console.log("afterUDC", afterUDC);

    await rd.updateReward(cToken1.address, user.address, false);

    // get results
    const after = await getState(comptroller, rd, cToken, user.address);
    console.log("after", after);

    // manually calculate rewards
    const r0 = DForceHelper.getSupplyRewardsAmount(
      afterSupply.market
      , afterSupply.account
      , afterSupply.totalSupply
      , BigNumber.from(middle.block.sub(1))
    );

    const r1 = DForceHelper.getSupplyRewardsAmount(
      middle.market
      , middle.account
      , middle.totalSupply
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
//endregion Supply-test-impl

//region Borrow-test-impl
  /**
   * Supply amount 1 and borrow amount 2.
   * Wait some blocks.
   * Repay the borrow completely.
   * Claim rewards.
   * Ensure, that amount of received rewards is same as pre-calculated
   */
  async function makeBorrowRewardsTest(
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
    rewardsReceived: BigNumber
  }>{
    const user = await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address);
    const comptroller = await DForceHelper.getController(deployer);
    const rd = await DForceHelper.getRewardDistributor(comptroller, deployer);
    const cToken = IDForceCToken__factory.connect(cTokenCollateral.address, deployer);
    const bToken = IDForceCToken__factory.connect(cTokenBorrow.address, deployer);

    const before = await getState(comptroller, rd, cToken, user.address);
    const beforeB = await getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("before", before, beforeB);

    // supply collateral
    await DForceHelper.supply(user, collateralAsset, cTokenCollateral, holderCollateral, collateralAmount);

    const afterSupply = await getState(comptroller, rd, cToken, user.address);
    const afterSupplyB = await getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterSupply", afterSupply, afterSupplyB);

    // borrow
    await DForceHelper.borrow(user, cTokenBorrow, borrowAmount);

    const afterBorrow = await getState(comptroller, rd, cToken, user.address);
    const afterBorrowB = await getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterBorrow", afterBorrow, afterBorrowB);

    // move time ahead
    await TimeUtils.advanceNBlocks(periodInBlocks);
    await bToken.updateInterest(); //see comment below to rAfterRepay

    const afterAdvance = await getState(comptroller, rd, cToken, user.address);
    const afterAdvanceB = await getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterAdvance", afterAdvance, afterAdvanceB);

    // repay completely
    await DForceHelper.repayAll(user, borrowAsset, cTokenBorrow, holderBorrow);

    const afterRepay = await getState(comptroller, rd, cToken, user.address);
    const afterRepayB = await getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterRepay", afterRepay, afterRepayB);

    // forced update rewards
    await rd.updateDistributionState(cTokenCollateral.address, false);
    const afterUDCSupply = await getState(comptroller, rd, cToken, user.address);
    const afterUDCSupplyB = await getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterUDCSupply", afterUDCSupply, afterUDCSupplyB);

    await rd.updateDistributionState(cTokenBorrow.address, true);
    const afterUDCBorrow = await getState(comptroller, rd, cToken, user.address);
    const afterUDCBorrowB = await getStateBorrowToken(comptroller, rd, bToken, user.address);
    console.log("afterUDCBorrow", afterUDCBorrow, afterUDCBorrowB);

    await rd.updateReward(cTokenCollateral.address, user.address, false);
    await rd.updateReward(cTokenBorrow.address, user.address, true);

    const after = await getState(comptroller, rd, cToken, user.address);
    const afterB = await getState(comptroller, rd, bToken, user.address);
    console.log("after", after, afterB);

    // manually calculate supply rewards for user
    const rAfterRepay = await getRewardsStateB(afterAdvanceB
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
    const rAfterUDCSupply = await getRewardsStateC(afterRepay, afterUDCSupply.block);
    console.log("rAfterUDCSupply", rAfterUDCSupply);
    const rAfterUDCBorrow = await getRewardsStateB(afterUDCSupplyB
      , afterUDCBorrowB.block
      , afterUDCSupplyB.borrowIndex
      , afterUDCSupplyB.borrowBalanceStored
      , afterUDCSupplyB.totalBorrows
    );
    console.log("rAfterUDCBorrow", rAfterUDCBorrow);

    const rewardsBalance0 = await IERC20__factory.connect(before.market.rewardToken, user).balanceOf(user.address);
    await rd.claimReward([user.address], [cToken.address]);
    const rewardsBalance1 = await IERC20__factory.connect(before.market.rewardToken, user).balanceOf(user.address);

    return {
      rewardsEarnedManual: [
        rAfterRepay.borrowRewardsAmount,
        rAfterUDCSupply.supplyRewardsAmount,
        rAfterUDCBorrow.borrowRewardsAmount,
      ].reduce((cur, prev) => cur.add(prev), BigNumber.from(0)),
      rewardsEarnedActual: after.rewards,
      rewardsReceived: rewardsBalance1.sub(rewardsBalance0)
    };
  }
//endregion Borrow-test-impl

//region Unit tests
  describe("Rewards manual calculations", () => {
    describe("Good paths", () => {
      describe("Supply amount and claim supply-rewards", () => {
        describe("DAI-18 : usdc-6", () => {
          it("should return expected amount of rewards", async () => {
            if (!await isPolygonForkInUse()) return;

            const collateralAsset = MaticAddresses.DAI;
            const collateralHolder = MaticAddresses.HOLDER_DAI;
            const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);

            const collateralAmount1 = getBigNumberFrom(20_000, collateralToken.decimals);

            const periodInBlocks = 1_000;

            const r = await makeSupplyRewardsTest(
              collateralToken
              , collateralCToken
              , collateralHolder
              , collateralAmount1
              , periodInBlocks
            );

            const ret = [
              r.rewardsEarnedManual.toString()
              , r.rewardsReceived.gt(r.rewardsEarnedManual)
            ].join("\n");
            const expected = [
              r.rewardsEarnedActual.toString()
              , true
            ].join("\n");

            expect(ret).eq(expected);
          });
        });
      });
      describe("Supply, borrow, repay, claim supply- and borrow-rewards", () => {
        describe("DAI-18 : usdc-6", () => {
          it("should return expected amount of rewards", async () => {
            if (!await isPolygonForkInUse()) return;

            const collateralAsset = MaticAddresses.DAI;
            const collateralHolder = MaticAddresses.HOLDER_DAI;
            const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

            const borrowAsset = MaticAddresses.USDC;
            const borrowCTokenAddress = MaticAddresses.dForce_iUSDC;
            const borrowHolder = MaticAddresses.HOLDER_USDC;

            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
            const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
            const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

            const collateralAmount = getBigNumberFrom(20_000, collateralToken.decimals);
            const borrowAmount = getBigNumberFrom(5_000, borrowToken.decimals);

            const periodInBlocks = 1_000;

            const r = await makeBorrowRewardsTest(
              collateralToken
              , collateralCToken
              , collateralHolder
              , collateralAmount
              , borrowToken
              , borrowCToken
              , borrowHolder
              , borrowAmount
              , periodInBlocks
            );

            const ret = [
              r.rewardsEarnedManual.toString()
              , r.rewardsReceived.gt(r.rewardsEarnedManual)
            ].join("\n");
            const expected = [
              r.rewardsEarnedActual.toString()
              , true
            ].join("\n");

            expect(ret).eq(expected);
          });
        });
      });
    });
  });

//endregion Unit tests

});