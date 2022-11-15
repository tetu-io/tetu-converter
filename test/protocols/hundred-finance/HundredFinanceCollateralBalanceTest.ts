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
import {IHfAccountLiquidity, IHundredFinanceAccountSnapshot} from "../../baseUT/apr/aprHundredFinance";
import {
  HundredFinanceTestUtils,
  IPrepareToBorrowResults
} from "../../baseUT/protocols/hundred-finance/HundredFinanceTestUtils";
import {HundredFinanceChangePriceUtils} from "../../baseUT/protocols/hundred-finance/HundredFinanceChangePriceUtils";

describe("HundredFinanceCollateralBalanceTest", () => {
//region Constants
  const collateralAsset = MaticAddresses.USDC;
  const collateralHolder = MaticAddresses.HOLDER_USDC;
  const collateralCTokenAddress = MaticAddresses.hUSDC;
  const borrowAsset = MaticAddresses.WETH;
  const borrowCTokenAddress = MaticAddresses.hETH;
  const borrowHolder = MaticAddresses.HOLDER_WETH

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
    accountLiquidity: IHfAccountLiquidity;
    accountSnapshotCollateral: IHundredFinanceAccountSnapshot;
    accountSnapshotBorrow: IHundredFinanceAccountSnapshot;
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

    const d = await HundredFinanceTestUtils.prepareToBorrow(deployer,
      collateralToken,
      collateralHolder,
      collateralCTokenAddress,
      collateralAmount,
      borrowToken,
      borrowCTokenAddress,
      200
    );
    // make a borrow
    await HundredFinanceTestUtils.makeBorrow(deployer, d, undefined);


    return {
      collateralToken,
      borrowToken,
      collateralAmount,
      stateAfterBorrow: await getState(d),
      d
    };
  }

  async function getState(d: IPrepareToBorrowResults) : Promise<IState> {
    const status = await d.hfPoolAdapterTC.getStatus();
    const collateralBalanceBase = await d.hfPoolAdapterTC.collateralTokensBalance();
    const accountLiquidity = await d.comptroller.getAccountLiquidity(d.hfPoolAdapterTC.address);
    const accountSnapshotCollateral = await d.collateralCToken.getAccountSnapshot(d.hfPoolAdapterTC.address);
    const accountSnapshotBorrow = await d.borrowCToken.getAccountSnapshot(d.hfPoolAdapterTC.address);
    return {status, collateralBalanceBase, accountLiquidity, accountSnapshotCollateral, accountSnapshotBorrow};
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
        await HundredFinanceTestUtils.makeBorrow(deployer, init.d, undefined);
        const stateAfterSecondBorrow = await getState(init.d);

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
        if (!await isPolygonForkInUse()) return;

        await putCollateralAmountOnUserBalance();
        await HundredFinanceTestUtils.makeBorrow(deployer, init.d, undefined);
        await putDoubleBorrowAmountOnUserBalance();
        await HundredFinanceTestUtils.makeRepay(
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
        if (!await isPolygonForkInUse()) return;

        await putDoubleBorrowAmountOnUserBalance();
        await HundredFinanceTestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );
        const stateAfterRepay = await getState(init.d);

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
        if (!await isPolygonForkInUse()) return;

        await putCollateralAmountOnUserBalance();
        await HundredFinanceTestUtils.makeBorrow(deployer, init.d, undefined);

        await putDoubleBorrowAmountOnUserBalance();
        await HundredFinanceTestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );

        await HundredFinanceTestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await getState(init.d);

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
        if (!await isPolygonForkInUse()) return;
        // increase target health factor from 200 to 300
        await init.d.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.d.collateralAmount.mul(2).div(3);
        await putCollateralAmountOnUserBalance();

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

        const stateAfterRepayToRebalance = await getState(init.d);
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
        if (!await isPolygonForkInUse()) return;
        // increase target health factor from 200 to 300
        await init.d.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.d.collateralAmount.mul(2).div(3);
        await putCollateralAmountOnUserBalance();

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

        await putDoubleBorrowAmountOnUserBalance();
        await HundredFinanceTestUtils.makeRepay(
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

        const stateAfterRepayToRebalance = await getState(init.d);

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
        if (!await isPolygonForkInUse()) return;
        // increase target health factor from 200 to 300
        await init.d.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.d.amountToBorrow.mul(2).div(3);
        await putDoubleBorrowAmountOnUserBalance();

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
        const stateAfterFullRepay = await getState(init.d);

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
        if (!await isPolygonForkInUse()) return;

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
        const stateAfterLiquidation = await getState(init.d);
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
        if (!await isPolygonForkInUse()) return;
        await HundredFinanceTestUtils.makeLiquidation(deployer, init.d, borrowHolder);
        const stateAfterLiquidation = await getState(init.d);

        await putDoubleBorrowAmountOnUserBalance();
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