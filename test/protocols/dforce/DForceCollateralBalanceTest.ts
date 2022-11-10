import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {BigNumber} from "ethers";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IDForceCalcAccountEquityResults} from "../../baseUT/apr/aprDForce";
import {DForceTestUtils, IPrepareToBorrowResults} from "../../baseUT/protocols/dforce/DForceTestUtils";
import {DForceChangePriceUtils} from "../../baseUT/protocols/dforce/DForceChangePriceUtils";

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
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];

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
  interface IState {
    status: IPoolAdapterStatus;
    collateralBalanceBase: BigNumber;
    accountLiquidity: IDForceCalcAccountEquityResults;
    accountCollateralTokenBalance: BigNumber;
    accountBorrowTokenBalance: BigNumber;
  }

  interface IInitialBorrowResults {
    d: IPrepareToBorrowResults;
    collateralToken: TokenDataTypes;
    borrowToken: TokenDataTypes;
    collateralAmount: BigNumber;
    stateAfterBorrow: IState;
  }

  async function makeInitialBorrow() : Promise<IInitialBorrowResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = getBigNumberFrom(collateralAmountNum, collateralToken.decimals);

    const d = await DForceTestUtils.prepareToBorrow(deployer,
      collateralToken,
      collateralHolder,
      collateralCTokenAddress,
      collateralAmount,
      borrowToken,
      borrowCTokenAddress,
      200
    );
    // make a borrow
    await DForceTestUtils.makeBorrow(deployer, d, undefined);


    return {
      collateralToken,
      borrowToken,
      collateralAmount,
      stateAfterBorrow: await getState(d),
      d
    };
  }

  async function getState(d: IPrepareToBorrowResults) : Promise<IState> {
    const status = await d.dfPoolAdapterTC.getStatus();
    const collateralBalanceBase = await d.dfPoolAdapterTC.collateralTokensBalance();
    const accountLiquidity = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
    const accountCollateralTokenBalance = await d.collateralCToken.balanceOf(d.dfPoolAdapterTC.address);
    const accountBorrowTokenBalance = await d.borrowCToken.balanceOf(d.dfPoolAdapterTC.address);
    return {
      status,
      collateralBalanceBase,
      accountLiquidity,
      accountCollateralTokenBalance,
      accountBorrowTokenBalance
    };
  }

  async function putCollateralAmountOnUserBalance() {
    await BalanceUtils.getRequiredAmountFromHolders(
      init.collateralAmount,
      init.collateralToken.token,
      [collateralHolder],
      init.d.userContract.address
    );
  }
  async function putDoubleBorrowAmountOnUserBalance() {
    await BalanceUtils.getRequiredAmountFromHolders(
      init.d.amountToBorrow.mul(2),
      init.borrowToken.token,
      [borrowHolder],
      init.d.userContract.address
    );
  }
//endregion TestImpl

//region Unit tests
  describe("Check collateralBalanceBase and status.collateralAmountLiquidated", () => {
    describe("Make second borrow", () => {
      it("should return expected collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        await putCollateralAmountOnUserBalance();
        await DForceTestUtils.makeBorrow(deployer, init.d, undefined);
        const stateAfterSecondBorrow = await getState(init.d);

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
        await putCollateralAmountOnUserBalance();
        await DForceTestUtils.makeBorrow(deployer, init.d, undefined);
        await putDoubleBorrowAmountOnUserBalance();
        await DForceTestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await getState(init.d);

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
        await putDoubleBorrowAmountOnUserBalance();
        await DForceTestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );
        const stateAfterRepay = await getState(init.d);

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
        await putCollateralAmountOnUserBalance();
        await DForceTestUtils.makeBorrow(deployer, init.d, undefined);

        await putDoubleBorrowAmountOnUserBalance();
        await DForceTestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );

        await DForceTestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await getState(init.d);

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
        await putCollateralAmountOnUserBalance();

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

        const stateAfterRepayToRebalance = await getState(init.d);

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
        await putCollateralAmountOnUserBalance();

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

        await putDoubleBorrowAmountOnUserBalance();
        await DForceTestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await getState(init.d);

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
        await putDoubleBorrowAmountOnUserBalance();

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

        const stateAfterRepayToRebalance = await getState(init.d);

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
        await putDoubleBorrowAmountOnUserBalance();

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
        const stateAfterFullRepay = await getState(init.d);

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
        const stateAfterLiquidation = await getState(init.d);
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
        const stateAfterLiquidation = await getState(init.d);

        await putDoubleBorrowAmountOnUserBalance();
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