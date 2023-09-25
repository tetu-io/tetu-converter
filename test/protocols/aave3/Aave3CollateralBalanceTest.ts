import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {
  Aave3TestUtils, IInitialBorrowResults
} from "../../baseUT/protocols/aave3/Aave3TestUtils";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {BigNumber} from "ethers";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {Aave3ChangePricesUtils} from "../../baseUT/protocols/aave3/Aave3ChangePricesUtils";
import {ConverterController} from "../../../typechain";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {ICoreAave3} from "../../baseUT/protocols/aave3/Aave3DataTypes";
import {MaticCore} from "../../baseUT/cores/maticCore";

describe("Aave3CollateralBalanceTest", () => {
//region Constants
  const collateralAsset = MaticAddresses.DAI;
  const collateralHolder = MaticAddresses.HOLDER_DAI;
  const borrowAsset = MaticAddresses.WMATIC;
  const borrowHolder = MaticAddresses.HOLDER_WMATIC;

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
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);

    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    controllerInstance = await TetuConverterApp.createController(deployer);

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

    const d = await Aave3TestUtils.prepareToBorrow(
      deployer,
      controllerInstance,
      collateralToken,
      [collateralHolder],
      collateralAmount,
      borrowToken,
      false
    );
    // make a borrow
    await Aave3TestUtils.makeBorrow(deployer, d, undefined);

    return {
      collateralToken,
      borrowToken,
      collateralAmount,
      stateAfterBorrow: await Aave3TestUtils.getState(d),
      d
    };
  }
//endregion TestImpl

//region Unit tests
  describe("Check collateralBalanceBase and status.collateralAmountLiquidated", () => {
    describe("Make second borrow", () => {
      it("should return expected collateral balance", async () => {

        await Aave3TestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);
        await Aave3TestUtils.makeBorrow(deployer, init.d, undefined);
        const stateAfterSecondBorrow = await Aave3TestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceATokens.eq(init.stateAfterBorrow.balanceATokensForCollateral),
          stateAfterSecondBorrow.status.collateralAmountLiquidated.eq(0),
          stateAfterSecondBorrow.collateralBalanceATokens.gt(init.stateAfterBorrow.collateralBalanceATokens),
          areAlmostEqual(stateAfterSecondBorrow.collateralBalanceATokens, stateAfterSecondBorrow.balanceATokensForCollateral, 5)
        ].join();
        const expected = [true, true, true, true, true].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterSecondBorrow);

        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        await Aave3TestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);
        await Aave3TestUtils.makeBorrow(deployer, init.d, undefined);
        await Aave3TestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await Aave3TestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await Aave3TestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceATokens.gt(0),
          stateAfterFullRepay.status.collateralAmountLiquidated.eq(0),
          stateAfterFullRepay.collateralBalanceATokens.eq(0)
        ].join();
        const expected = [true, true, true, true].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterFullRepay);

        expect(ret).eq(expected);
      });
    });
    describe("Make partial repay", () => {
      it("should return expected collateral balance", async () => {
        await Aave3TestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await Aave3TestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );
        const stateAfterRepay = await Aave3TestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceATokens.eq(init.stateAfterBorrow.balanceATokensForCollateral),
          stateAfterRepay.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceATokens.gt(stateAfterRepay.collateralBalanceATokens),
          areAlmostEqual(stateAfterRepay.collateralBalanceATokens, stateAfterRepay.balanceATokensForCollateral, 5)
        ].join();
        const expected = [true, true, true, true, true].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterRepay);

        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        console.log("Start borrowing");
        await Aave3TestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);
        await Aave3TestUtils.makeBorrow(deployer, init.d, undefined);

        console.log("Start repaying");
        await Aave3TestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await Aave3TestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );

        await Aave3TestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await Aave3TestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceATokens.eq(init.stateAfterBorrow.balanceATokensForCollateral),
          stateAfterFullRepay.status.collateralAmountLiquidated.eq(0),
          stateAfterFullRepay.collateralBalanceATokens.eq(0)
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
        await Aave3TestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.d.aavePoolAdapterAsTC.address,
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

        await init.d.aavePoolAdapterAsTC.repayToRebalance(amountToRepay, true);

        const stateAfterRepayToRebalance = await Aave3TestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceATokens.eq(init.stateAfterBorrow.balanceATokensForCollateral),
          stateAfterRepayToRebalance.status.collateralAmountLiquidated.eq(0),
          stateAfterRepayToRebalance.collateralBalanceATokens.gt(init.stateAfterBorrow.collateralBalanceATokens),
          stateAfterRepayToRebalance.balanceATokensForCollateral.gte(stateAfterRepayToRebalance.collateralBalanceATokens),
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
        await Aave3TestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.d.aavePoolAdapterAsTC.address,
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

        await init.d.aavePoolAdapterAsTC.repayToRebalance(amountToRepay, true);

        await Aave3TestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await Aave3TestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await Aave3TestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceATokens.gt(0),
          stateAfterFullRepay.status.collateralAmountLiquidated.eq(0),
          stateAfterFullRepay.collateralBalanceATokens.eq(0),
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
        await Aave3TestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.d.aavePoolAdapterAsTC.address,
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

        await init.d.aavePoolAdapterAsTC.repayToRebalance(amountToRepay, false);

        const stateAfterRepayToRebalance = await Aave3TestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceATokens.eq(init.stateAfterBorrow.balanceATokensForCollateral),
          stateAfterRepayToRebalance.status.collateralAmountLiquidated.eq(0),
          stateAfterRepayToRebalance.collateralBalanceATokens.eq(init.stateAfterBorrow.collateralBalanceATokens),
        ].join();
        const expected = [true, true, true, true].join();
        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        // increase target health factor from 200 to 300
        await init.d.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.d.amountToBorrow.mul(2).div(3);
        await Aave3TestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.d.aavePoolAdapterAsTC.address,
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

        await init.d.aavePoolAdapterAsTC.repayToRebalance(amountToRepay, false);

        await Aave3TestUtils.makeRepay(init.d,undefined);
        const stateAfterFullRepay = await Aave3TestUtils.getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceATokens.eq(init.stateAfterBorrow.balanceATokensForCollateral),
          stateAfterFullRepay.status.collateralAmountLiquidated.eq(0),
          stateAfterFullRepay.collateralBalanceATokens.eq(0),
        ].join();
        const expected = [true, true, true, true].join();
        expect(ret).eq(expected);
      });
    });
    describe("Make liquidation", () => {
      /**
       * todo Test is temorary disables, it's necessary to find out how to make liquidation correctly
       */
      it.skip("should return not-zero collateralAmountLiquidated", async () => {
        // reduce price of collateral to reduce health factor below 1
        const core = MaticCore.getCoreAave3();
        await Aave3ChangePricesUtils.changeAssetPrice(deployer, core, init.d.collateralToken.address, false, 10);

        await Aave3TestUtils.makeLiquidation(deployer, core, init.d, borrowHolder);
        const stateAfterLiquidation = await Aave3TestUtils.getState(init.d);
        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceATokens.eq(init.stateAfterBorrow.balanceATokensForCollateral),
          stateAfterLiquidation.status.collateralAmountLiquidated.eq(0),
          stateAfterLiquidation.collateralBalanceATokens.eq(stateAfterLiquidation.balanceATokensForCollateral),
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
      it.skip("try to make full repay, aave reverts", async () => {
        const core = MaticCore.getCoreAave3();

        await Aave3TestUtils.makeLiquidation(deployer, core, init.d, borrowHolder);
        const stateAfterLiquidation = await Aave3TestUtils.getState(init.d);

        await Aave3TestUtils.putDoubleBorrowAmountOnUserBalance(init.d, borrowHolder);
        await Aave3TestUtils.makeRepay(init.d,undefined);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceATokens.eq(init.stateAfterBorrow.balanceATokensForCollateral),
          stateAfterLiquidation.status.collateralAmountLiquidated.eq(0),
          stateAfterLiquidation.collateralBalanceATokens.eq(0),
          stateAfterLiquidation.balanceATokensForCollateral.eq(0)
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