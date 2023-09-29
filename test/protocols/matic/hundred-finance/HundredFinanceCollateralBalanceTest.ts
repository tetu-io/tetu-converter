import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {TokenDataTypes} from "../../../baseUT/types/TokenDataTypes";
import {BigNumber} from "ethers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {SharedRepayToRebalanceUtils} from "../../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {areAlmostEqual} from "../../../baseUT/utils/CommonUtils";
import {
  HundredFinanceTestUtils, IInitialBorrowResults
} from "../../../baseUT/protocols/hundred-finance/HundredFinanceTestUtils";
import {HundredFinanceChangePriceUtils} from "../../../baseUT/protocols/hundred-finance/HundredFinanceChangePriceUtils";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../../scripts/utils/HardhatUtils";

describe.skip("HundredFinanceCollateralBalanceTest", () => {
//region Constants
  const collateralAsset = MaticAddresses.USDC;
  const collateralHolder = MaticAddresses.HOLDER_USDC;
  const collateralCTokenAddress = MaticAddresses.hUSDC;
  const borrowAsset = MaticAddresses.WETH;
  const borrowCTokenAddress = MaticAddresses.hETH;
  const borrowHolder = MaticAddresses.HOLDER_WETH

  const collateralAmountNum = 10;
//endregion Constants

//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let init: IInitialBorrowResults;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];

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

    const d = await HundredFinanceTestUtils.prepareToBorrow(deployer,
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
    await HundredFinanceTestUtils.makeBorrow(deployer, d, undefined);


    return {
      collateralToken,
      borrowToken,
      collateralAmount,
      stateAfterBorrow: await HundredFinanceTestUtils.getState(d),
      d
    };
  }
//endregion TestImpl

//region Unit tests
  describe("Check collateralBalanceBase and status.collateralAmountLiquidated", () => {
    describe("Make second borrow", () => {
      it("should return expected collateral balance", async () => {
        await HundredFinanceTestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);
        await HundredFinanceTestUtils.makeBorrow(deployer, init.d, undefined);
        const stateAfterSecondBorrow = await HundredFinanceTestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountSnapshotCollateral.tokenBalance),
          stateAfterSecondBorrow.status.collateralAmountLiquidated.eq(0),
          stateAfterSecondBorrow.collateralBalanceBase.gt(init.stateAfterBorrow.collateralBalanceBase),
          areAlmostEqual(stateAfterSecondBorrow.collateralBalanceBase, stateAfterSecondBorrow.accountSnapshotCollateral.tokenBalance, 5)
        ].join();
        const expected = [true, true, true, true, true].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterSecondBorrow);

        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        await HundredFinanceTestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);
        await HundredFinanceTestUtils.makeBorrow(deployer, init.d, undefined);
        await HundredFinanceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await HundredFinanceTestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await HundredFinanceTestUtils.getState(init.d);

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
        await HundredFinanceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await HundredFinanceTestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );
        const stateAfterRepay = await HundredFinanceTestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountSnapshotCollateral.tokenBalance),
          stateAfterRepay.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.gt(stateAfterRepay.collateralBalanceBase),
          areAlmostEqual(stateAfterRepay.collateralBalanceBase, stateAfterRepay.accountSnapshotCollateral.tokenBalance, 5)
        ].join();
        const expected = [true, true, true, true, true].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterRepay);

        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        await HundredFinanceTestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);
        await HundredFinanceTestUtils.makeBorrow(deployer, init.d, undefined);

        await HundredFinanceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await HundredFinanceTestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );

        await HundredFinanceTestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await HundredFinanceTestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountSnapshotCollateral.tokenBalance),
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
        // increase target health factor from 200 to 300
        await init.d.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.d.collateralAmount.mul(2).div(3);
        await HundredFinanceTestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.d.hfPoolAdapterTC.address,
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

        await init.d.hfPoolAdapterTC.repayToRebalance(amountToRepay, true);

        const stateAfterRepayToRebalance = await HundredFinanceTestUtils.getState(init.d);
        console.log("init.stateAfterBorrow", init.stateAfterBorrow);
        console.log("stateAfterRepayToRebalance", stateAfterRepayToRebalance);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountSnapshotCollateral.tokenBalance),
          stateAfterRepayToRebalance.status.collateralAmountLiquidated.eq(0),
          stateAfterRepayToRebalance.collateralBalanceBase.gt(init.stateAfterBorrow.collateralBalanceBase),
          stateAfterRepayToRebalance.accountSnapshotCollateral.tokenBalance.gte(stateAfterRepayToRebalance.collateralBalanceBase),
        ].join();
        const expected = [true, true, true, true, true].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterRepayToRebalance);

        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        // increase target health factor from 200 to 300
        await init.d.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.d.collateralAmount.mul(2).div(3);
        await HundredFinanceTestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.d.hfPoolAdapterTC.address,
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

        await init.d.hfPoolAdapterTC.repayToRebalance(amountToRepay, true);

        await HundredFinanceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await HundredFinanceTestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await HundredFinanceTestUtils.getState(init.d);

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
        // increase target health factor from 200 to 300
        await init.d.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.d.amountToBorrow.mul(2).div(3);
        await HundredFinanceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.d.hfPoolAdapterTC.address,
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

        await init.d.hfPoolAdapterTC.repayToRebalance(amountToRepay, false);

        const stateAfterRepayToRebalance = await HundredFinanceTestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountSnapshotCollateral.tokenBalance),
          stateAfterRepayToRebalance.status.collateralAmountLiquidated.eq(0),
          stateAfterRepayToRebalance.collateralBalanceBase.eq(init.stateAfterBorrow.collateralBalanceBase),
        ].join();
        const expected = [true, true, true, true].join();
        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        // increase target health factor from 200 to 300
        await init.d.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.d.amountToBorrow.mul(2).div(3);
        await HundredFinanceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.d.hfPoolAdapterTC.address,
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

        await init.d.hfPoolAdapterTC.repayToRebalance(amountToRepay, false);

        await HundredFinanceTestUtils.makeRepay(init.d,undefined);
        const stateAfterFullRepay = await HundredFinanceTestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountSnapshotCollateral.tokenBalance),
          stateAfterFullRepay.status.collateralAmountLiquidated.eq(0),
          stateAfterFullRepay.collateralBalanceBase.eq(0),
        ].join();
        const expected = [true, true, true, true].join();
        expect(ret).eq(expected);
      });
    });
    describe("Make liquidation", () => {
      it("should return not-zero collateralAmountLiquidated", async () => {
        const priceOracleMock = await HundredFinanceChangePriceUtils.setupPriceOracleMock(deployer);
        console.log("HundredFinanceChangePriceUtils.changeCTokenPrice");
        await HundredFinanceChangePriceUtils.changeCTokenPrice(
          priceOracleMock,
          deployer,
          collateralCTokenAddress,
          false,
          10
        );

        const statusBeforeLiquidation = await init.d.hfPoolAdapterTC.getStatus();
        console.log("statusBeforeLiquidation", statusBeforeLiquidation);

        await HundredFinanceTestUtils.makeLiquidation(deployer, init.d, borrowHolder);
        const stateAfterLiquidation = await HundredFinanceTestUtils.getState(init.d);
        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountSnapshotCollateral.tokenBalance),
          stateAfterLiquidation.status.collateralAmountLiquidated.eq(0),
          stateAfterLiquidation.collateralBalanceBase.eq(stateAfterLiquidation.accountSnapshotCollateral.tokenBalance),
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
        await HundredFinanceTestUtils.makeLiquidation(deployer, init.d, borrowHolder);
        const stateAfterLiquidation = await HundredFinanceTestUtils.getState(init.d);

        await HundredFinanceTestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await HundredFinanceTestUtils.makeRepay(init.d,undefined);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountSnapshotCollateral.tokenBalance),
          stateAfterLiquidation.status.collateralAmountLiquidated.eq(0),
          stateAfterLiquidation.collateralBalanceBase.eq(0),
          stateAfterLiquidation.accountSnapshotCollateral.tokenBalance.eq(0)
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