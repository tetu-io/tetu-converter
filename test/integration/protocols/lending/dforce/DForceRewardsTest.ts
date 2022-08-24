import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
  IDForceCToken__factory, IERC20__factory, PoolAdapterMock,
  DForceRewardAmountDetector
} from "../../../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../../../baseUT/types/TokenDataTypes";
import {DForceHelper, IDForceMarketRewards} from "../../../../../scripts/integration/helpers/DForceHelper";
import {DeployUtils} from "../../../../../scripts/utils/DeployUtils";

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

//region Unit tests
  describe("borrow", () => {
    /**
     * Supply amount. Wait some blocks. Claim rewards.
     */
    async function makeSuppyRewardsTest(
      asset1: TokenDataTypes,
      cToken1: TokenDataTypes,
      holder1: string,
      asset2: TokenDataTypes,
      cToken2: TokenDataTypes,
      holder2: string,
      collateralAmount1: BigNumber,
      collateralAmount2: BigNumber,
      borrowAmount1: BigNumber,
      periodInBlocks: number
    ) : Promise<{
      rewardsAfterSupply: BigNumber,
      rewardsAfterPeriod: BigNumber,
      rewardsData: IDForceMarketRewards
    }>{
      // user1: supply only
      const user1 = await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address);

      // user2: supply and borrow
      const user2 = await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address);

      const comptroller = await DForceHelper.getController(deployer);
      const rd = await DForceHelper.getRewardDistributor(comptroller, deployer);
      const cToken = IDForceCToken__factory.connect(cToken1.address, deployer);

      const rewardsDataBefore = await DForceHelper.getRewardsForMarket(comptroller, rd, cToken);
      console.log("rewardsDataBefore", rewardsDataBefore);
      const rewardsBefore = await rd.reward(user1.address);
      const rewardsBeforeUser2 = await rd.reward(user2.address);
      console.log(`rewardsBefore user1=${rewardsBefore} user2=${rewardsBeforeUser2}`);

      const totalSupply = await cToken.totalSupply();

      // user 1: first supply token 1
      await DForceHelper.supply(user1, asset1, cToken1, holder1, collateralAmount1);
      // // user 2: borrow token 1
      // await DForceHelper.supply(user2, asset2, cToken2, holder2, collateralAmount2);
      // await DForceHelper.borrow(user2, cToken1, borrowAmount1);

      const rewardsDataAfterSupply = await DForceHelper.getRewardsForMarket(comptroller, rd, cToken);
      console.log("rewardsDataAfterSupply", rewardsDataAfterSupply);

      await TimeUtils.advanceNBlocks(periodInBlocks);

      // // user 2: repay the borrow
      // await DForceHelper.repayAll(user2, asset1, cToken1, holder1);

      // forced update rewards
      await rd.updateDistributionState(cToken1.address, false);
      await rd.updateReward(cToken1.address, user1.address, false);
      await rd.updateReward(cToken1.address, user2.address, false);

      const rewardsDataAfter = await DForceHelper.getRewardsForMarket(comptroller, rd, cToken);
      console.log("rewardsDataAfter", rewardsDataAfter);

      const rewardsAfter = await rd.reward(user1.address);
      const rewardsAfterUser2 = await rd.reward(user2.address);
      
      console.log(`rewardsAfter user1=${rewardsAfter} user2=${rewardsAfterUser2}`);
      console.log(`+rewards user1=${rewardsAfter.sub(rewardsBefore)} user2=${rewardsAfterUser2.sub(rewardsBeforeUser2)}`);

      // manually calculate rewards for user 1
      const newSupplyStateIndex = DForceHelper.calcDistributionState(
        rewardsDataAfter.distributionSupplyState_Block,
        rewardsDataAfterSupply.distributionSupplyState_Block,
        rewardsDataAfterSupply.distributionSupplyState_Index,
        rewardsDataAfterSupply.distributionSupplySpeed,
        totalSupply
      );

      const rewardsAmount = DForceHelper.calcUpdateRewards(
        newSupplyStateIndex,
        await rd.distributionSupplierIndex(cToken1.address, user1.address),
        await cToken.balanceOf(user1.address)
      );
      console.log(`Manual calculations: newSupplyStateIndex=${newSupplyStateIndex} rewardsAmount=${rewardsAmount}`);

      return {
        rewardsAfterSupply: rewardsBefore,
        rewardsAfterPeriod: rewardsAfter,
        rewardsData: rewardsDataAfter
      };
    }

    describe("Good paths", () => {
      describe("Supply amount and claim rewards", () => {
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

            const collateralAmount1 = getBigNumberFrom(20_000, collateralToken.decimals);
            const collateralAmount2 = getBigNumberFrom(20_000, borrowToken.decimals);
            const borrowAmount = getBigNumberFrom(5_000, borrowToken.decimals);

            const periodInBlocks = 1_000;

            const r = await makeSuppyRewardsTest(
              collateralToken
              , collateralCToken
              , collateralHolder
              , borrowToken
              , borrowCToken
              , borrowHolder
              , collateralAmount1
              , collateralAmount2
              , borrowAmount
              , periodInBlocks
            );

            const ret = [
              r.rewardsAfterSupply.toString(),
              r.rewardsAfterPeriod.toString()
            ].join("\n");

            console.log(ret);

            const expected = [
              0,
              111
            ].join("\n");

            expect(ret).eq(expected);
          });
        });
      });
    });
  });

//endregion Unit tests

});