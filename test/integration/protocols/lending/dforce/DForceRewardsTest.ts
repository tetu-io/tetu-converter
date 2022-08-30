import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {expect, use} from "chai";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../../../baseUT/types/TokenDataTypes";
import {SupplyBorrowUsingDForce} from "../../../../baseUT/uses-cases/dforce/SupplyBorrowUsingDForce";
import {DForcePlatformFabric} from "../../../../baseUT/fabrics/DForcePlatformFabric";
import {CoreContractsHelper} from "../../../../baseUT/helpers/CoreContractsHelper";
import {BorrowRepayUsesCase} from "../../../../baseUT/uses-cases/BorrowRepayUsesCase";
import {
  ITetuLiquidator__factory,
  IERC20__factory,
  IERC20Extended__factory,
  IDForceCToken__factory
} from "../../../../../typechain";
import {DForceHelper} from "../../../../../scripts/integration/helpers/DForceHelper";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";

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

            const r = await SupplyBorrowUsingDForce.makeSupplyRewardsTest(
              deployer
              , collateralToken
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

            const r = await SupplyBorrowUsingDForce.makeBorrowRewardsTest(
              deployer
              , collateralToken
              , collateralCToken
              , collateralHolder
              , collateralAmount
              , borrowToken
              , borrowCToken
              , borrowHolder
              , borrowAmount
              , periodInBlocks
            );
            console.log(r);

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

  describe("Cost estimation", () =>{
    describe("Good paths", () => {
      describe("No rewards, DAI => WETH", () => {
        it("should return expected amount of rewards", async () => {
          if (!await isPolygonForkInUse()) return;

          // DAI has rewards, so we WILL HAVE supply-rewards
          const collateralAsset = MaticAddresses.DAI;
          const collateralCToken = MaticAddresses.dForce_iDAI;
          const collateralHolder = MaticAddresses.HOLDER_DAI;

          // WBTS has no rewards, so we WON'T have borrow rewards
          const borrowAsset = MaticAddresses.WETH;
          const borrowCToken = MaticAddresses.dForce_iWETH;
          const borrowHolder = MaticAddresses.HOLDER_WETH;

          const collateralAmount = 200_000;
          const healthFactor = 200;
          const initialLiquidityBorrow = 50;
          const initialLiquidityCollateral = collateralAmount;

          const periodInBlocks = 1_000;

          const {platformAdapter} = await DForcePlatformFabric.createPlatformAdapter(deployer
            , (await CoreContractsHelper.createController(deployer)).address
          );
          const plan = await platformAdapter.getConversionPlan(
            collateralAsset
            , collateralAmount
            , borrowAsset
            , 0
            , periodInBlocks
          );

          const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepayBase(deployer
            , {
              collateral: {
                asset: collateralAsset,
                holder: collateralHolder,
                initialLiquidity: initialLiquidityCollateral,
              }, borrow: {
                asset: borrowAsset,
                holder: borrowHolder,
                initialLiquidity: initialLiquidityBorrow,
              }, collateralAmount: collateralAmount
              , healthFactor2: healthFactor
              , countBlocks: periodInBlocks
            }, new DForcePlatformFabric()
          );

          const borrowToken = IERC20Extended__factory.connect(borrowAsset, deployer);

          // how much borrow-tokens we have paid in repay = what is the real cost of our borrow
          const totalRepaidAmount = await ret.uc.totalRepaidAmount();
          const totalBorrowedAmount = await ret.uc.totalBorrowedAmount();
          const currentUserBorrowBalance = await borrowToken.balanceOf(ret.uc.address);

          console.log("totalRepaidAmount", totalRepaidAmount);
          console.log("totalBorrowedAmount", totalBorrowedAmount);
          console.log("ucBalanceBorrow0", await ret.ucBalanceBorrow0);
          const cost = totalRepaidAmount.sub(totalBorrowedAmount);
          console.log("Real cost", cost, ret.ucBalanceBorrow0.sub(currentUserBorrowBalance));

          // how much money we can return using received rewards
          const comptroller = await DForceHelper.getController(deployer);
          const rd = await DForceHelper.getRewardDistributor(comptroller, deployer);
          const rewardToken = await rd.rewardToken();
          console.log("rewardToken", rewardToken);

          const amountReceivedRewards = await IERC20__factory.connect(rewardToken, deployer).balanceOf(ret.uc.address);
          const priceOracle = (await DForceHelper.getPriceOracle(comptroller, deployer));
          const priceRewardsToken18 = await priceOracle.getUnderlyingPrice(rewardToken);
          const priceBorrowToken18 = await priceOracle.getUnderlyingPrice(borrowCToken);
          console.log("rewardToken", rewardToken);
          console.log("priceRewardsToken18", priceRewardsToken18);
          console.log("borrowAsset", borrowAsset);
          console.log("priceBorrowToken18", priceBorrowToken18);

          const decimalsBorrow = await borrowToken.decimals();
          const decimalsRewardToken = await IERC20Extended__factory.connect(await rd.rewardToken(), deployer).decimals();

          const rewardsAmountInBorrowTokens = amountReceivedRewards
            .mul(getBigNumberFrom(1, decimalsBorrow))
            .mul(priceRewardsToken18)
            .div(priceBorrowToken18)
            .div(getBigNumberFrom(1, decimalsRewardToken))
          ;
          console.log(`Rewards ${amountReceivedRewards} == ${rewardsAmountInBorrowTokens} ${await borrowToken.name()}`);

          const tokenRewards = await IDForceCToken__factory.connect(rewardToken
            , await DeployerUtils.startImpersonate(ret.uc.address)
          );

          const tqAsUC = ITetuLiquidator__factory.connect("0xC737eaB847Ae6A92028862fE38b828db41314772"
            , await DeployerUtils.startImpersonate(ret.uc.address)
          );
          const balanceBeforeLiquidation = await borrowToken.balanceOf(ret.uc.address);
          await IERC20__factory.connect(rewardToken
            , await DeployerUtils.startImpersonate(ret.uc.address)
          ).approve(tqAsUC.address, amountReceivedRewards);
          console.log("liquidate", rewardToken, borrowAsset, amountReceivedRewards);
          await tqAsUC.liquidate(rewardToken, borrowAsset, amountReceivedRewards, 6_000);
          const balanceAfterLiquidation = await borrowToken.balanceOf(ret.uc.address);
          console.log("balanceBeforeLiquidation", balanceBeforeLiquidation);
          console.log("balanceAfterLiquidation", balanceAfterLiquidation);
          console.log("balanceAfterLiquidation-balanceBeforeLiquidation", balanceAfterLiquidation.sub(balanceBeforeLiquidation));

          // how much money we have list (to repay our debts)
          const sret = [
            cost
          ].join("\n");

          const sexpected = [
            plan.apr18
          ].join("\n");

          expect(sret).eq(sexpected);
        });

      });
      describe("Supply rewards only", () => {

      });
    });
  });

//endregion Unit tests

});