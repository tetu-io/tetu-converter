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
import {IAaveTwoUserAccountDataResults} from "../../baseUT/apr/aprAaveTwo";
import {AaveTwoTestUtils, IPrepareToBorrowResults} from "../../baseUT/protocols/aaveTwo/AaveTwoTestUtils";
import {IERC20__factory} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {AaveTwoChangePricesUtils} from "../../baseUT/protocols/aaveTwo/AaveTwoChangePricesUtils";

describe("AaveTwoCollateralBalanceTest", () => {
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
    accountState: IAaveTwoUserAccountDataResults;
    balanceATokensForCollateral: BigNumber;
    collateralBalanceATokens: BigNumber;
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

    const d = await AaveTwoTestUtils.prepareToBorrow(deployer,
      collateralToken,
      collateralHolder,
      collateralAmount,
      borrowToken,
      200
    );
    // make a borrow
    await AaveTwoTestUtils.makeBorrow(deployer, d, undefined);


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
    const collateralBalanceATokens = await d.aavePoolAdapterAsTC.collateralBalanceATokens();
    const accountState = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
    const balanceATokensForCollateral = await IERC20__factory.connect(
      d.collateralReserveInfo.aTokenAddress,
      await DeployerUtils.startImpersonate(d.aavePoolAdapterAsTC.address)
    ).balanceOf(d.aavePoolAdapterAsTC.address);
    return {status, collateralBalanceATokens, accountState, balanceATokensForCollateral};
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
  describe("Check collateralBalanceATokens and status.collateralAmountLiquidated", () => {
    describe("Make second borrow", () => {
      it("should return expected collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        await putCollateralAmountOnUserBalance();
        await AaveTwoTestUtils.makeBorrow(deployer, init.d, undefined);
        const stateAfterSecondBorrow = await getState(init.d);

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
        if (!await isPolygonForkInUse()) return;

        await putCollateralAmountOnUserBalance();
        await AaveTwoTestUtils.makeBorrow(deployer, init.d, undefined);
        await putDoubleBorrowAmountOnUserBalance();
        await AaveTwoTestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await getState(init.d);

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
        if (!await isPolygonForkInUse()) return;

        await putDoubleBorrowAmountOnUserBalance();
        await AaveTwoTestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );
        const stateAfterRepay = await getState(init.d);

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
        if (!await isPolygonForkInUse()) return;

        await putCollateralAmountOnUserBalance();
        await AaveTwoTestUtils.makeBorrow(deployer, init.d, undefined);

        await putDoubleBorrowAmountOnUserBalance();
        await AaveTwoTestUtils.makeRepay(
          init.d,
          init.d.amountToBorrow.div(2) // partial repayment
        );

        await AaveTwoTestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await getState(init.d);

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

        await putDoubleBorrowAmountOnUserBalance();
        await AaveTwoTestUtils.makeRepay(
          init.d,
          undefined // full repayment
        );
        const stateAfterFullRepay = await getState(init.d);

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
          init.stateAfterBorrow.collateralBalanceATokens.eq(init.stateAfterBorrow.balanceATokensForCollateral),
          stateAfterRepayToRebalance.status.collateralAmountLiquidated.eq(0),
          stateAfterRepayToRebalance.collateralBalanceATokens.eq(init.stateAfterBorrow.collateralBalanceATokens),
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

        await AaveTwoTestUtils.makeRepay(init.d,undefined);
        const stateAfterFullRepay = await getState(init.d);

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
      it("should return not-zero collateralAmountLiquidated", async () => {
        if (!await isPolygonForkInUse()) return;

        // reduce price of collateral to reduce health factor below 1
        await AaveTwoChangePricesUtils.changeAssetPrice(deployer, init.d.collateralToken.address, false, 10);

        await AaveTwoTestUtils.makeLiquidation(deployer, init.d, borrowHolder);
        const stateAfterLiquidation = await getState(init.d);
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
        if (!await isPolygonForkInUse()) return;

        await AaveTwoTestUtils.makeLiquidation(deployer, init.d, borrowHolder);
        const stateAfterLiquidation = await getState(init.d);

        await putDoubleBorrowAmountOnUserBalance();
        await AaveTwoTestUtils.makeRepay(init.d,undefined);

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