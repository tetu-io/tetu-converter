import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {BigNumber} from "ethers";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {DForceTestUtils, IInitialBorrowResults} from "../../baseUT/protocols/dforce/DForceTestUtils";
import {DForceChangePriceUtils} from "../../baseUT/protocols/dforce/DForceChangePriceUtils";
import {ConverterController} from "../../../typechain";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";

describe("DForceCollateralBalanceTest", () => {
//region Constants
  const collateralAsset = MaticAddresses.USDC;
  const collateralHolder = MaticAddresses.HOLDER_USDC;
  const collateralCTokenAddress = MaticAddresses.dForce_iUSDC;
  const borrowAsset = MaticAddresses.WETH;
  const borrowCTokenAddress = MaticAddresses.dForce_iWETH;
  const borrowHolder = MaticAddresses.HOLDER_WETH;

  const collateralAmountNum = 1_000;
//endregion Constants

//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let init: IInitialBorrowResults;
  let controllerInstance: ConverterController;

//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    controllerInstance = await TetuConverterApp.createController(deployer);

    if (!await isPolygonForkInUse()) return;
    init = await makeInitialBorrow();
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

//region TestImpl


  async function makeInitialBorrow() : Promise<IInitialBorrowResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = getBigNumberFrom(collateralAmountNum, collateralToken.decimals);

    const d = await DForceTestUtils.prepareToBorrow(
      deployer,
      controllerInstance,
      collateralToken,
      collateralHolder,
      collateralCTokenAddress,
      collateralAmount,
      borrowToken,
      borrowCTokenAddress,
      {
        targetHealthFactor2: 200
      }
    );
    // make a borrow
    await DForceTestUtils.makeBorrow(deployer, d, undefined);


    return {
      collateralToken,
      borrowToken,
      collateralAmount,
      stateAfterBorrow: await DForceTestUtils.getState(d),
      d
    };
  }


//endregion TestImpl

//region Unit tests
  describe("Check collateralBalanceBase and status.collateralAmountLiquidated", () => {
    describe("Make second borrow", () => {
      it("should return expected collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        await DForceTestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);
        await DForceTestUtils.makeBorrow(deployer, init.d, undefined);
        const stateAfterSecondBorrow = await DForceTestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountCollateralTokenBalance),
          stateAfterSecondBorrow.status.collateralAmountLiquidated.eq(0),
          stateAfterSecondBorrow.collateralBalanceBase.gt(init.stateAfterBorrow.collateralBalanceBase),
          areAlmostEqual(stateAfterSecondBorrow.collateralBalanceBase, stateAfterSecondBorrow.accountCollateralTokenBalance, 5)
        ].join();
        const expected = [true, true, true, true, true].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterSecondBorrow);

        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        await DForceTestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);
        await DForceTestUtils.makeBorrow(deployer, init.d, undefined);
        await DForceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await DForceTestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await DForceTestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.gt(0),
          stateAfterFullRepay.status.collateralAmountLiquidated.eq(0),
          stateAfterFullRepay.collateralBalanceBase.eq(0)
        ].join();
        const expected = [true, true, true, true].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterFullRepay);

        expect(ret).eq(expected);
      });
    });
    describe("Make partial repay", () => {
      it("should return expected collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        await DForceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await DForceTestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );
        const stateAfterRepay = await DForceTestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountCollateralTokenBalance),
          stateAfterRepay.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.gt(stateAfterRepay.collateralBalanceBase),
          areAlmostEqual(stateAfterRepay.collateralBalanceBase, stateAfterRepay.accountCollateralTokenBalance, 5)
        ].join();
        const expected = [true, true, true, true, true].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterRepay);

        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        await DForceTestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);
        await DForceTestUtils.makeBorrow(deployer, init.d, undefined);

        await DForceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await DForceTestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );

        await DForceTestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await DForceTestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountCollateralTokenBalance),
          stateAfterFullRepay.status.collateralAmountLiquidated.eq(0),
          stateAfterFullRepay.collateralBalanceBase.eq(0)
        ].join();
        const expected = [true, true, true, true].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterFullRepay);

        expect(ret).eq(expected);
      });
    });
    describe("Make repay to rebalance using collateral asset", () => {
      it("add collateral, should return updated collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        // increase target health factor from 200 to 300
        await init.d.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.d.collateralAmount.mul(2).div(3);
        await DForceTestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.d.dfPoolAdapterTC.address,
          init.d.collateralToken.address,
          init.d.borrowToken.address,
          {
            useCollateral: true,
            amountBorrowAsset: BigNumber.from(0),
            amountCollateralAsset: amountToRepay
          },
          init.d.userContract.address,
          await init.d.controller.tetuConverter()
        );

        await init.d.dfPoolAdapterTC.repayToRebalance(amountToRepay, true);

        const stateAfterRepayToRebalance = await DForceTestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountCollateralTokenBalance),
          stateAfterRepayToRebalance.status.collateralAmountLiquidated.eq(0),
          stateAfterRepayToRebalance.collateralBalanceBase.gt(init.stateAfterBorrow.collateralBalanceBase),
          stateAfterRepayToRebalance.accountCollateralTokenBalance.gte(stateAfterRepayToRebalance.collateralBalanceBase),
        ].join();
        const expected = [true, true, true, true, true].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterRepayToRebalance);

        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        // increase target health factor from 200 to 300
        await init.d.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.d.collateralAmount.mul(2).div(3);
        await DForceTestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.d.dfPoolAdapterTC.address,
          init.d.collateralToken.address,
          init.d.borrowToken.address,
          {
            useCollateral: true,
            amountBorrowAsset: BigNumber.from(0),
            amountCollateralAsset: amountToRepay
          },
          init.d.userContract.address,
          await init.d.controller.tetuConverter()
        );

        await init.d.dfPoolAdapterTC.repayToRebalance(amountToRepay, true);

        await DForceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await DForceTestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await DForceTestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.gt(0),
          stateAfterFullRepay.status.collateralAmountLiquidated.eq(0),
          stateAfterFullRepay.collateralBalanceBase.eq(0),
        ].join();
        const expected = [true, true, true, true].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterFullRepay);

        expect(ret).eq(expected);
      });
    });
    describe("Make repay to rebalance using borrow asset", () => {
      it("add borrow, should not change internal collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        // increase target health factor from 200 to 300
        await init.d.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.d.amountToBorrow.mul(2).div(3);
        await DForceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.d.dfPoolAdapterTC.address,
          init.d.collateralToken.address,
          init.d.borrowToken.address,
          {
            useCollateral: false,
            amountBorrowAsset: amountToRepay,
            amountCollateralAsset: BigNumber.from(0)
          },
          init.d.userContract.address,
          await init.d.controller.tetuConverter()
        );

        await init.d.dfPoolAdapterTC.repayToRebalance(amountToRepay, false);

        const stateAfterRepayToRebalance = await DForceTestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountCollateralTokenBalance),
          stateAfterRepayToRebalance.status.collateralAmountLiquidated.eq(0),
          stateAfterRepayToRebalance.collateralBalanceBase.eq(init.stateAfterBorrow.collateralBalanceBase),
        ].join();
        const expected = [true, true, true, true].join();
        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;
        // increase target health factor from 200 to 300
        await init.d.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.d.amountToBorrow.mul(2).div(3);
        await DForceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.d.dfPoolAdapterTC.address,
          init.d.collateralToken.address,
          init.d.borrowToken.address,
          {
            useCollateral: false,
            amountBorrowAsset: amountToRepay,
            amountCollateralAsset: BigNumber.from(0)
          },
          init.d.userContract.address,
          await init.d.controller.tetuConverter()
        );

        await init.d.dfPoolAdapterTC.repayToRebalance(amountToRepay, false);

        await DForceTestUtils.makeRepay(init.d,undefined);
        const stateAfterFullRepay = await DForceTestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountCollateralTokenBalance),
          stateAfterFullRepay.status.collateralAmountLiquidated.eq(0),
          stateAfterFullRepay.collateralBalanceBase.eq(0),
        ].join();
        const expected = [true, true, true, true].join();
        expect(ret).eq(expected);
      });
    });
    describe("Make liquidation", () => {
      it("should return not-zero collateralAmountLiquidated", async () => {
        if (!await isPolygonForkInUse()) return;

        const priceOracleMock = await DForceChangePriceUtils.setupPriceOracleMock(deployer);
        console.log("priceOracleMock", priceOracleMock.address);

        console.log("DForceChangePriceUtils.changeCTokenPrice");
        await DForceChangePriceUtils.changeCTokenPrice(
          priceOracleMock,
          deployer,
          collateralCTokenAddress,
          false,
          10
        );

        const statusBeforeLiquidation = await init.d.dfPoolAdapterTC.getStatus();
        console.log("statusBeforeLiquidation", statusBeforeLiquidation);

        await DForceTestUtils.makeLiquidation(deployer, init.d, borrowHolder);
        const stateAfterLiquidation = await DForceTestUtils.getState(init.d);
        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountCollateralTokenBalance),
          stateAfterLiquidation.status.collateralAmountLiquidated.eq(0),
          stateAfterLiquidation.collateralBalanceBase.eq(stateAfterLiquidation.accountCollateralTokenBalance),
        ].join();
        const expected = [
          true,
          true,
          false,
          false
        ].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterLiquidation);

        expect(ret).eq(expected);
      });
      it.skip("try to make full repay, protocol reverts", async () => {
        if (!await isPolygonForkInUse()) return;

        await DForceTestUtils.makeLiquidation(deployer, init.d, borrowHolder);
        const stateAfterLiquidation = await DForceTestUtils.getState(init.d);

        await DForceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await DForceTestUtils.makeRepay(init.d,undefined);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountCollateralTokenBalance),
          stateAfterLiquidation.status.collateralAmountLiquidated.eq(0),
          stateAfterLiquidation.collateralBalanceBase.eq(0),
          stateAfterLiquidation.accountCollateralTokenBalance.eq(0)
        ].join();
        const expected = [
          true,
          true,
          false,
          false,
          true
        ].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterLiquidation);

        expect(ret).eq(expected);
      });
    });
  });
//endregion Unit tests
});