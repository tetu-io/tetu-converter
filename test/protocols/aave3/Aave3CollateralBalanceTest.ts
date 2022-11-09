import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {Aave3TestUtils, IPrepareToBorrowResults} from "../../baseUT/protocols/aave3/Aave3TestUtils";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {BigNumber} from "ethers";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {IAave3UserAccountDataResults} from "../../baseUT/apr/aprAave3";
import {Aave3ChangePricesUtils} from "../../baseUT/protocols/aave3/Aave3ChangePricesUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {IAavePool__factory, IERC20__factory} from "../../../typechain";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";

describe("Aave3CollateralBalanceTest", () => {
//region Constants
  const MAX_UINT_AMOUNT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
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
    accountState: IAave3UserAccountDataResults;
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

    const d = await Aave3TestUtils.prepareToBorrow(deployer,
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
      stateAfterBorrow: await getState(d),
      d
    };
  }

  async function getState(d: IPrepareToBorrowResults) : Promise<IState> {
    const status = await d.aavePoolAdapterAsTC.getStatus();
    const collateralBalanceBase = await d.aavePoolAdapterAsTC.collateralBalanceBase();
    const accountState = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
    return {status, collateralBalanceBase, accountState};
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
        await Aave3TestUtils.makeBorrow(deployer, init.d, undefined);
        const stateAfterSecondBorrow = await getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountState.totalCollateralBase),
          stateAfterSecondBorrow.status.collateralAmountLiquidated.eq(0),
          stateAfterSecondBorrow.collateralBalanceBase.gt(init.stateAfterBorrow.collateralBalanceBase),
          areAlmostEqual(stateAfterSecondBorrow.collateralBalanceBase, stateAfterSecondBorrow.accountState.totalCollateralBase, 5)
        ].join();
        const expected = [true, true, true, true, true].join();

        console.log(init.stateAfterBorrow);
        console.log(stateAfterSecondBorrow);

        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        await putCollateralAmountOnUserBalance();
        await Aave3TestUtils.makeBorrow(deployer, init.d, undefined);
        await putDoubleBorrowAmountOnUserBalance();
        await Aave3TestUtils.makeRepay(
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
        expect(ret).eq(expected);
      });
    });
    describe("Make partial repay", () => {
      it("should return expected collateral balance", async () => {
        await putDoubleBorrowAmountOnUserBalance();
        await Aave3TestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );
        const stateAfterFullRepay = await getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountState.totalCollateralBase),
          stateAfterFullRepay.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.gt(stateAfterFullRepay.collateralBalanceBase),
          stateAfterFullRepay.collateralBalanceBase.gt(stateAfterFullRepay.accountState.totalCollateralBase)
        ].join();
        const expected = [true, true, true, true, true].join();
        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        await putCollateralAmountOnUserBalance();
        await Aave3TestUtils.makeBorrow(deployer, init.d, undefined);

        await putDoubleBorrowAmountOnUserBalance();
        await Aave3TestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );

        await Aave3TestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountState.totalCollateralBase),
          stateAfterFullRepay.status.collateralAmountLiquidated.eq(0),
          stateAfterFullRepay.collateralBalanceBase.eq(0)
        ].join();
        const expected = [true, true, true, true].join();
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

        const stateAfterRepayToRebalance = await getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountState.totalCollateralBase),
          stateAfterRepayToRebalance.status.collateralAmountLiquidated.eq(0),
          stateAfterRepayToRebalance.collateralBalanceBase.gt(init.stateAfterBorrow.collateralBalanceBase),
          stateAfterRepayToRebalance.collateralBalanceBase.eq(stateAfterRepayToRebalance.accountState.totalCollateralBase),
        ].join();
        const expected = [true, true, true, true, true].join();
        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;
        // increase target health factor from 200 to 300
        await init.d.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.d.collateralAmount.mul(2).div(3);
        await putCollateralAmountOnUserBalance();

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

        await Aave3TestUtils.makeRepay(
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

        const stateAfterRepayToRebalance = await getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountState.totalCollateralBase),
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
        const stateAfterFullRepay = await getState(init.d);

        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountState.totalCollateralBase),
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
        await Aave3TestUtils.makeLiquidation(deployer, init.d, borrowHolder);
        const stateAfterLiquidation = await getState(init.d);
        const ret = [
          init.stateAfterBorrow.status.collateralAmountLiquidated.eq(0),
          init.stateAfterBorrow.collateralBalanceBase.eq(init.stateAfterBorrow.accountState.totalCollateralBase),
          stateAfterLiquidation.status.collateralAmountLiquidated.eq(0),
          stateAfterLiquidation.collateralBalanceBase.eq(stateAfterLiquidation.accountState.totalCollateralBase),
        ].join();
        const expected = [
          true,
          true,
          false,
          false
        ].join();
        expect(ret).eq(expected);
      });
      it("make full repay, should return zero collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
  });
//endregion Unit tests
});