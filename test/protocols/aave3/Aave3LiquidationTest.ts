import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {
  Aave3TestUtils,
  IPrepareToLiquidationResults
} from "../../baseUT/protocols/aave3/Aave3TestUtils";
import {BigNumber} from "ethers";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {Misc} from "../../../scripts/utils/Misc";

describe("Aave3LiquidationTest", () => {
//region Constants
  const collateralAsset = MaticAddresses.DAI;
  const collateralHolder = MaticAddresses.HOLDER_DAI;
  const borrowAsset = MaticAddresses.WMATIC;
  const borrowHolder = MaticAddresses.HOLDER_WMATIC;

  const CHANGE_PRICE_FACTOR_FULL_LIQUIDATION = 10;
  const CHANGE_PRICE_FACTOR_PARTIAL_LIQUIDATION = 3;
  const collateralAmountNum = 1_000;
//endregion Constants

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
//endregion before, after

//region Unit tests
  describe("Full liquidation: make borrow, change prices, make health factor < 1", () => {
    let init: IPrepareToLiquidationResults;
    before(async function () {
      if (!await isPolygonForkInUse()) return;
      init = await Aave3TestUtils.prepareToLiquidation(
        deployer,
        collateralAsset,
        collateralHolder,
        collateralAmountNum,
        borrowAsset,
        CHANGE_PRICE_FACTOR_FULL_LIQUIDATION
      );
    });
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });
    it("health factor is less 1 before liquidation", async () => {
      if (!await isPolygonForkInUse()) return;

      const healthFactorNum = Number(ethers.utils.formatUnits(init.statusBeforeLiquidation.healthFactor18));
      expect(healthFactorNum).below(1);
    });

    it("liquidator receives all collateral", async () => {
      if (!await isPolygonForkInUse()) return;

      const r = await Aave3TestUtils.makeLiquidation(deployer, init.d, borrowHolder);
      const collateralAmountReceivedByLiquidator = ethers.utils.formatUnits(
        r.collateralAmountReceivedByLiquidator,
        init.collateralToken.decimals
      );
      const collateralAmountStr = ethers.utils.formatUnits(
        init.collateralAmount,
        init.collateralToken.decimals
      );
      console.log("Amount received by liquidator", collateralAmountReceivedByLiquidator);
      console.log("Original collateral amount", collateralAmountStr);

      console.log("Before liquidation", init.statusBeforeLiquidation);
      const statusAfterLiquidation = await init.d.aavePoolAdapterAsTC.getStatus();
      console.log("After liquidation", statusAfterLiquidation);

      const userAccountAfterLiquidation = await init.d.aavePool.getUserAccountData(init.d.aavePoolAdapterAsTC.address);
      console.log("userAccountAfterLiquidation", userAccountAfterLiquidation);

      const ret = [
        r.collateralAmountReceivedByLiquidator.gt(0),
        init.statusBeforeLiquidation.collateralAmountLiquidated.eq(0),
        statusAfterLiquidation.collateralAmountLiquidated.gt(0),

        // the liquidation was complete, no collateral and health factor becomes ZERO
        userAccountAfterLiquidation.totalCollateralBase.eq(0),
        userAccountAfterLiquidation.healthFactor.eq(0)
      ].join();
      const expected = [true, true, true, true, true].join();
      expect(ret).eq(expected);
    });

    it("Try to make new borrow after liquidation", async () => {
      if (!await isPolygonForkInUse()) return;

      const r = await Aave3TestUtils.makeLiquidation(deployer, init.d, borrowHolder)

      // put collateral amount on user's balance
      await BalanceUtils.getRequiredAmountFromHolders(
        init.collateralAmount,
        init.collateralToken.token,
        [collateralHolder],
        init.d.userContract.address
      );

      await expect(
        Aave3TestUtils.makeBorrow(deployer, init.d, undefined)
      ).revertedWith("35");
    });

    it("Try to repay before liquidation", async () => {
      if (!await isPolygonForkInUse()) return;

      // make repayment to rebalance
      const amountsToRepay = {
        useCollateral: true,
        amountCollateralAsset: init.d.collateralAmount.mul(20),
        amountBorrowAsset: BigNumber.from(0)
      }

      // put collateral amount on user's balance
      await BalanceUtils.getRequiredAmountFromHolders(
        amountsToRepay.amountCollateralAsset,
        init.collateralToken.token,
        [collateralHolder],
        init.d.userContract.address
      );
      console.log("Balance collateral of user contract", await init.collateralToken.token.balanceOf(init.d.userContract.address));

      await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
        init.d.aavePoolAdapterAsTC.address,
        collateralAsset,
        borrowAsset,
        amountsToRepay,
        init.d.userContract.address,
        await init.d.controller.tetuConverter()
      );

      const statusBeforeRepay = await init.d.aavePoolAdapterAsTC.getStatus();
      console.log("Status before repay", statusBeforeRepay);

      await init.d.aavePoolAdapterAsTC.repayToRebalance(
        amountsToRepay.useCollateral
          ? amountsToRepay.amountCollateralAsset
          : amountsToRepay.amountBorrowAsset,
        amountsToRepay.useCollateral
      );

      const statusAfterRepay = await init.d.aavePoolAdapterAsTC.getStatus();
      console.log("Status after repay", statusAfterRepay);

      expect(statusAfterRepay.healthFactor18.gt(Misc.WEI)).eq(true);
    });
  });

  describe("Partial liquidation: make borrow, change prices, make health factor < 1", () => {
    let init: IPrepareToLiquidationResults;
    before(async function () {
      if (!await isPolygonForkInUse()) return;
      init = await Aave3TestUtils.prepareToLiquidation(
        deployer,
        collateralAsset,
        collateralHolder,
        collateralAmountNum,
        borrowAsset,
        CHANGE_PRICE_FACTOR_PARTIAL_LIQUIDATION
      );
    });
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });
    it("health factor is less 1 before liquidation", async () => {
      if (!await isPolygonForkInUse()) return;

      const healthFactorNum = Number(ethers.utils.formatUnits(init.statusBeforeLiquidation.healthFactor18));
      expect(healthFactorNum).below(1);
    });

    it("liquidator receives all collateral", async () => {
      if (!await isPolygonForkInUse()) return;

      const r = await Aave3TestUtils.makeLiquidation(deployer, init.d, borrowHolder);
      const collateralAmountReceivedByLiquidator = ethers.utils.formatUnits(
        r.collateralAmountReceivedByLiquidator,
        init.collateralToken.decimals
      );
      const collateralAmountStr = ethers.utils.formatUnits(
        init.collateralAmount,
        init.collateralToken.decimals
      );
      console.log("Amount received by liquidator", collateralAmountReceivedByLiquidator);
      console.log("Original collateral amount", collateralAmountStr);

      console.log("Before liquidation", init.statusBeforeLiquidation);
      const statusAfterLiquidation = await init.d.aavePoolAdapterAsTC.getStatus();
      console.log("After liquidation", statusAfterLiquidation);

      const userAccountAfterLiquidation = await init.d.aavePool.getUserAccountData(init.d.aavePoolAdapterAsTC.address);
      console.log("userAccountAfterLiquidation", userAccountAfterLiquidation);

      const ret = [
        r.collateralAmountReceivedByLiquidator.gt(0),
        init.statusBeforeLiquidation.collateralAmountLiquidated.eq(0),
        statusAfterLiquidation.collateralAmountLiquidated.gt(0),

        // the liquidation was partial
        userAccountAfterLiquidation.totalCollateralBase.gt(0)
      ].join();
      const expected = [true, true, true, true].join();
      expect(ret).eq(expected);
    });

    it.skip("Try to make new borrow after liquidation", async () => {
      if (!await isPolygonForkInUse()) return;

      const r = await Aave3TestUtils.makeLiquidation(deployer, init.d, borrowHolder)

      // put collateral amount on user's balance
      await BalanceUtils.getRequiredAmountFromHolders(
        init.collateralAmount,
        init.collateralToken.token,
        [collateralHolder],
        init.d.userContract.address
      );

      await expect(
        Aave3TestUtils.makeBorrow(deployer, init.d, undefined)
      ).revertedWith("35"); // or 36...
    });

    it("Try to repay before liquidation", async () => {
      if (!await isPolygonForkInUse()) return;

      // make repayment to rebalance
      const amountsToRepay = {
        useCollateral: true,
        amountCollateralAsset: init.d.collateralAmount.mul(20),
        amountBorrowAsset: BigNumber.from(0)
      }

      // put collateral amount on user's balance
      await BalanceUtils.getRequiredAmountFromHolders(
        amountsToRepay.amountCollateralAsset,
        init.collateralToken.token,
        [collateralHolder],
        init.d.userContract.address
      );
      console.log("Balance collateral of user contract", await init.collateralToken.token.balanceOf(init.d.userContract.address));

      await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
        init.d.aavePoolAdapterAsTC.address,
        collateralAsset,
        borrowAsset,
        amountsToRepay,
        init.d.userContract.address,
        await init.d.controller.tetuConverter()
      );

      const statusBeforeRepay = await init.d.aavePoolAdapterAsTC.getStatus();
      console.log("Status before repay", statusBeforeRepay);

      await init.d.aavePoolAdapterAsTC.repayToRebalance(
        amountsToRepay.useCollateral
          ? amountsToRepay.amountCollateralAsset
          : amountsToRepay.amountBorrowAsset,
        amountsToRepay.useCollateral
      );

      const statusAfterRepay = await init.d.aavePoolAdapterAsTC.getStatus();
      console.log("Status after repay", statusAfterRepay);

      expect(statusAfterRepay.healthFactor18.gt(Misc.WEI)).eq(true);
    });
  });
//endregion Unit tests
});