import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {
  HundredFinanceTestUtils,
  IPrepareToLiquidationResults
} from "../../baseUT/protocols/hundred-finance/HundredFinanceTestUtils";

/**
 * These tests allow to play with liquidation and see how the app works if a liquidation happens
 */
describe.skip("HfLiquidationTest - simulate liquidation", () => {
//region Constants
  const collateralAsset = MaticAddresses.USDC;
  const collateralHolder = MaticAddresses.HOLDER_USDC;
  const collateralCTokenAddress = MaticAddresses.hUSDC;
  const borrowAsset = MaticAddresses.WETH;
  const borrowCTokenAddress = MaticAddresses.hETH;
  const borrowHolder = MaticAddresses.HOLDER_WETH;

  const CHANGE_PRICE_FACTOR_FULL_LIQUIDATION = 20;
  const CHANGE_PRICE_FACTOR_PARTIAL_LIQUIDATION = 18;
  const collateralAmountNum = 1_000;
//endregion Constants

//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    console.log("before1");
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
  });

  after(async function () {
    console.log("after1");
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
  describe("Full liquidation: make borrow, change prices, make health factor < 1", () => {
    let init: IPrepareToLiquidationResults;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      if (!await isPolygonForkInUse()) return;
      init = await HundredFinanceTestUtils.prepareToLiquidation(
        deployer,
        collateralAsset,
        collateralHolder,
        collateralCTokenAddress,
        collateralAmountNum,
        borrowAsset,
        borrowCTokenAddress,
        CHANGE_PRICE_FACTOR_FULL_LIQUIDATION
      );
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    describe("Good paths", () => {
      it("health factor is less 1 before liquidation", async () => {
        if (!await isPolygonForkInUse()) return;

        console.log("Before liquidation", init.statusBeforeLiquidation);
        const healthFactorNum = Number(ethers.utils.formatUnits(init.statusBeforeLiquidation.healthFactor18));
        expect(healthFactorNum).below(1);
      });

      it("liquidator receives all collateral", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await HundredFinanceTestUtils.makeLiquidation(deployer, init.d, borrowHolder);
        const collateralAmountReceivedByLiquidator = ethers.utils.formatUnits(
          r.collateralAmountReceivedByLiquidator,
          init.collateralToken.decimals
        );
        const collateralAmountStr = ethers.utils.formatUnits(
          init.collateralAmount,
          init.collateralToken.decimals
        );
        const accountLiquidator = await init.d.comptroller.getAccountLiquidity(r.liquidatorAddress);
        console.log("accountLiquidator", accountLiquidator);

        console.log("Amount received by liquidator", collateralAmountReceivedByLiquidator);
        console.log("Original collateral amount", collateralAmountStr);

        console.log("Status before liquidation", init.statusBeforeLiquidation);
        const statusAfterLiquidation = await init.d.hfPoolAdapterTC.getStatus();
        console.log("Status after liquidation", statusAfterLiquidation);

        const accountLiquidityAfterLiquidation = await init.d.comptroller.getAccountLiquidity(init.d.hfPoolAdapterTC.address);
        console.log("accountLiquidityAfterLiquidation", accountLiquidityAfterLiquidation);

        const ret = [
          r.collateralAmountReceivedByLiquidator.gt(0),
          init.statusBeforeLiquidation.collateralAmountLiquidated.eq(0),
          statusAfterLiquidation.collateralAmountLiquidated.gt(0)
        ].join();
        const expected = [true, true, true].join();
        expect(ret).eq(expected);
      });

      it("Try to make new borrow after liquidation", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await HundredFinanceTestUtils.makeLiquidation(deployer, init.d, borrowHolder);

        // put collateral amount on user's balance
        await BalanceUtils.getRequiredAmountFromHolders(
          init.collateralAmount,
          init.collateralToken.token,
          [collateralHolder],
          init.d.userContract.address
        );

        await expect(
          HundredFinanceTestUtils.makeBorrow(deployer, init.d, undefined)
        ).revertedWith("TC-20 borrow failed"); // borrow failed
      });
    });
  });

  describe("Partial liquidation: make borrow, change prices, make health factor < 1", () => {
    let init: IPrepareToLiquidationResults;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      if (!await isPolygonForkInUse()) return;

      init = await HundredFinanceTestUtils.prepareToLiquidation(
        deployer,
        collateralAsset,
        collateralHolder,
        collateralCTokenAddress,
        collateralAmountNum,
        borrowAsset,
        borrowCTokenAddress,
        CHANGE_PRICE_FACTOR_PARTIAL_LIQUIDATION
      );
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    describe("Good paths", () => {
      it("health factor is less 1 before liquidation", async () => {
        if (!await isPolygonForkInUse()) return;

        console.log("Before liquidation", init.statusBeforeLiquidation);
        const healthFactorNum = Number(ethers.utils.formatUnits(init.statusBeforeLiquidation.healthFactor18));
        expect(healthFactorNum).below(1);
      });

      it("liquidator receives all collateral", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await HundredFinanceTestUtils.makeLiquidation(deployer, init.d, borrowHolder);
        const collateralAmountReceivedByLiquidator = ethers.utils.formatUnits(
          r.collateralAmountReceivedByLiquidator,
          init.collateralToken.decimals
        );
        const collateralAmountStr = ethers.utils.formatUnits(
          init.collateralAmount,
          init.collateralToken.decimals
        );
        const accountLiquidator = await init.d.comptroller.getAccountLiquidity(r.liquidatorAddress);
        console.log("accountLiquidator", accountLiquidator);

        console.log("Amount received by liquidator", collateralAmountReceivedByLiquidator);
        console.log("Original collateral amount", collateralAmountStr);

        console.log("Before liquidation", init.statusBeforeLiquidation);
        const statusAfterLiquidation = await init.d.hfPoolAdapterTC.getStatus();
        console.log("After liquidation", statusAfterLiquidation);

        const accountLiquidityAfterLiquidation = await init.d.comptroller.getAccountLiquidity(init.d.hfPoolAdapterTC.address);
        console.log("accountLiquidityAfterLiquidation", accountLiquidityAfterLiquidation);

        const ret = [
          r.collateralAmountReceivedByLiquidator.gt(0),
          init.statusBeforeLiquidation.collateralAmountLiquidated.eq(0),
          statusAfterLiquidation.collateralAmountLiquidated.gt(0)
        ].join();
        const expected = [true, true, true].join();
        expect(ret).eq(expected);
      });

      it("Try to make new borrow after liquidation", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await HundredFinanceTestUtils.makeLiquidation(deployer, init.d, borrowHolder);

        // put collateral amount on user's balance
        await BalanceUtils.getRequiredAmountFromHolders(
          init.collateralAmount,
          init.collateralToken.token,
          [collateralHolder],
          init.d.userContract.address
        );

        await expect(
          HundredFinanceTestUtils.makeBorrow(deployer, init.d, undefined)
        ).revertedWith("TC-20 borrow failed"); // borrow failed
      });
    });
  });
//endregion Unit tests
});