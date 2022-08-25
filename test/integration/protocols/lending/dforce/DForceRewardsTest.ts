import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
  IDForceCToken__factory
} from "../../../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../../../baseUT/types/TokenDataTypes";
import {DForceHelper, IDForceMarketRewards} from "../../../../../scripts/integration/helpers/DForceHelper";

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
      const accountDataBefore = await DForceHelper.getMarketAccountRewardsInfo(comptroller, rd, cToken, user1.address);
      console.log("rewardsDataBefore", rewardsDataBefore, accountDataBefore);
      const rewardsBefore = await rd.reward(user1.address);
      const rewardsBeforeUser2 = await rd.reward(user2.address);
      console.log(`rewardsBefore user1=${rewardsBefore} user2=${rewardsBeforeUser2}`);

      const totalSupplyBefore = await cToken.totalSupply();
      console.log("totalSupply", totalSupplyBefore);

      // user 1: first supply token 1
      await DForceHelper.supply(user1, asset1, cToken1, holder1, collateralAmount1);
      await rd.updateDistributionState(cToken1.address, false);
      await rd.updateReward(cToken1.address, user1.address, false);

      // // user 2: borrow token 1
      // await DForceHelper.supply(user2, asset2, cToken2, holder2, collateralAmount2);
      // await DForceHelper.borrow(user2, cToken1, borrowAmount1);

      const rewardsDataMiddle = await DForceHelper.getRewardsForMarket(comptroller, rd, cToken);
      const accountDataMiddle = await DForceHelper.getMarketAccountRewardsInfo(comptroller, rd, cToken, user1.address);
      const currentBlockMiddle = (await hre.ethers.provider.getBlock("latest")).number;
      console.log("rewardsDataMiddle", rewardsDataMiddle, accountDataMiddle);
      console.log("Current block", currentBlockMiddle);
      const totalSupplyMiddle = await cToken.totalSupply();
      console.log("totalSupplyMiddle", totalSupplyMiddle);

      await TimeUtils.advanceNBlocks(periodInBlocks);
      const currentBlockAfterAdvance = (await hre.ethers.provider.getBlock("latest")).number;
      console.log("Current block", currentBlockAfterAdvance);
      const totalSupplyAfterAdvance = await cToken.totalSupply();
      console.log("totalSupplyAfterAdvance", totalSupplyAfterAdvance);

      // // user 2: repay the borrow
      // await DForceHelper.repayAll(user2, asset1, cToken1, holder1);

      // forced update rewards
      await rd.updateDistributionState(cToken1.address, false);
      const rewardsDataAfterUDS = await DForceHelper.getRewardsForMarket(comptroller, rd, cToken);
      const accountDataAfterUDS = await DForceHelper.getMarketAccountRewardsInfo(comptroller, rd, cToken, user1.address);
      const currentBlockAfterUDS = (await hre.ethers.provider.getBlock("latest")).number;
      console.log("rewardsDataAfterUDS", rewardsDataAfterUDS, accountDataAfterUDS);
      console.log("Current block", currentBlockAfterUDS);

      await rd.updateReward(cToken1.address, user1.address, false);
//      await rd.updateReward(cToken1.address, user2.address, false);

      const rewardsDataAfter = await DForceHelper.getRewardsForMarket(comptroller, rd, cToken);
      const accountDataAfter = await DForceHelper.getMarketAccountRewardsInfo(comptroller, rd, cToken, user1.address);
      console.log("rewardsDataAfter", rewardsDataAfter, accountDataAfter);
      console.log("totalSupplyBefore", totalSupplyBefore);
      console.log("Current block", (await hre.ethers.provider.getBlock("latest")).number);
      const totalSupplyAfter = await cToken.totalSupply();
      console.log("totalSupplyAfter", totalSupplyAfter);

      const rewardsAfter = await rd.reward(user1.address);
      const rewardsAfterUser2 = await rd.reward(user2.address);

      console.log(`rewardsAfter user1=${rewardsAfter} user2=${rewardsAfterUser2}`);
      console.log(`+rewards user1=${rewardsAfter.sub(rewardsBefore)} user2=${rewardsAfterUser2.sub(rewardsBeforeUser2)}`);

      // manually calculate rewards for user 1
      const block = BigNumber.from(currentBlockAfterUDS);//rewardsDataAfterUDS.distributionSupplyState_Block;
      const expectedNewSupplyStateIndex = rewardsDataAfter.distributionSupplyState_Index;

      const supplyStateBlock = rewardsDataMiddle.distributionSupplyState_Block;
      const supplyStateIndex = rewardsDataMiddle.distributionSupplyState_Index;
      const supplySpeed = rewardsDataMiddle.distributionSupplySpeed;
      const totalSupply = totalSupplyMiddle;

      const newSupplyStateIndex = DForceHelper.calcDistributionStateSupply(
        block,
        supplyStateBlock,
        supplyStateIndex,
        supplySpeed,
        totalSupply
      );
      const base = getBigNumberFrom(1, 18);
      const deltaB = expectedNewSupplyStateIndex.sub(supplyStateIndex)
        .mul(totalSupply)
        .div(supplySpeed);
      console.log("deltaB*1e18", deltaB);
      console.log("block", deltaB.div(base).add(supplyStateBlock));


      const iTokenIndex = newSupplyStateIndex; // distributionSupplyState[_iToken].index;
      const accountIndex = accountDataMiddle.distributionSupplierIndex;
      const accountBalance = accountDataMiddle.accountBalance;
      const rewardsAmount = DForceHelper.calcUpdateRewards(iTokenIndex, accountIndex, accountBalance);

      console.log(`Manual calculations: newSupplyStateIndex=${newSupplyStateIndex} rewardsAmount=${rewardsAmount} rewardsAmount+init=${accountDataMiddle.rewards.add(rewardsAmount)}` );
      console.log(`Actual values: newSupplyStateIndex=${rewardsDataAfter.distributionSupplyState_Index} rewardsAmount=${rewardsAfter}`);

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
              1
            ].join("\n");

            expect(ret).eq(expected);
          });
        });
      });
    });
  });

//endregion Unit tests

});