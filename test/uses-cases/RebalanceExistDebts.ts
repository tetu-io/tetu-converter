import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {
  HardhatUtils,
  POLYGON_NETWORK_ID
} from "../../scripts/utils/HardhatUtils";
import {IPoolAdapterStatusNum} from "../baseUT/types/BorrowRepayDataTypes";
import {
  BorrowManager, BorrowManager__factory,
  ConverterController, ConverterController__factory,
  IERC20Metadata__factory, IPoolAdapter__factory,
  ITetuConverter
} from "../../typechain";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {BalanceUtils} from "../baseUT/utils/BalanceUtils";
import {Misc} from "../../scripts/utils/Misc";
import {BorrowRepayDataTypeUtils} from "../baseUT/utils/BorrowRepayDataTypeUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {TetuConverterApp} from "../baseUT/app/TetuConverterApp";
import {Aave3PlatformFabric} from "../baseUT/logic/fabrics/Aave3PlatformFabric";

describe("RebalanceExistDebts", () => {
//region Global vars for all tests
  let snapshotRoot: string;
  let signer: SignerWithAddress;
  let controllerAsGov: ConverterController;
  let tetuConverter: ITetuConverter;
  let borrowManagerAsGov: BorrowManager;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);

    this.timeout(1200000);
    snapshotRoot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    // we use signers[1] instead signers[0] here because of weird problem
    // if signers[0] is used then newly created TetuConverter contract has not-zero USDC balance
    // and some tests don't pass
    signer = signers[1];

    const r = await TetuConverterApp.buildApp(
      signer,
      {networkId: POLYGON_NETWORK_ID}, // disable swap
      [new Aave3PlatformFabric()],
    );
    const governance = await Misc.impersonate(await r.controller.governance());
    controllerAsGov = ConverterController__factory.connect(r.controller.address, governance);
    tetuConverter = r.tc;
    borrowManagerAsGov = BorrowManager__factory.connect(await controllerAsGov.borrowManager(), governance);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotRoot);
  });
//endregion before, after

//region Unit tests
  /**
   * Make a borrow using given collateral.
   * Change health factor so that rebalancing is required.
   * Make a second borrow using same collateral amount.
   * Check borrowed amounts and final status of the debt.
   */
  describe("Borrow with rebalance (scb-708)", () => {
    interface IBorrowWithRebalanceParams {
      collateralAsset: string;
      collateralHolder: string;
      borrowAsset: string;
      collateralAmount: string;

      /** Target health factor of the collateral asset before borrow 1 */
      targetHealthFactor1?: string; // default 2
      /** Target health factor of the collateral asset before borrow 2 */
      targetHealthFactor2?: string; // default 2

      countBlocksBetweenBorrows?: number; // default 0

      rebalanceOnBorrowEnabled?: boolean; // default "true"
    }

    interface IBorrowWithRebalanceResults {
      borrowedAmount1: number;
      borrowedAmount2: number;
      statusAfterBorrow1: IPoolAdapterStatusNum;
      statusBeforeBorrow2: IPoolAdapterStatusNum;
      statusAfterBorrow2: IPoolAdapterStatusNum;
      /** Block 49968469 on polygon: AAVE3 has a negative APR in following tests */
      isAprNegative: boolean;
    }

    async function makeBorrowWithRebalance(p: IBorrowWithRebalanceParams): Promise<IBorrowWithRebalanceResults> {
      const collateralAsset = IERC20Metadata__factory.connect(p.collateralAsset, signer);
      const borrowAsset = IERC20Metadata__factory.connect(p.borrowAsset, signer);

      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();

      const collateralAmount = parseUnits(p.collateralAmount, decimalsCollateral);

      // governance set up
      await controllerAsGov.setWhitelistValues([signer.address], true);
      await controllerAsGov.setRebalanceOnBorrowEnabled(p.rebalanceOnBorrowEnabled ?? true);
      await borrowManagerAsGov.setTargetHealthFactors(
        [p.collateralAsset],
        [parseUnits(p.targetHealthFactor1 || "2", 2)]
      );

      // prepare two collateral amounts on user balance
      await BalanceUtils.getAmountFromHolder(collateralAsset.address, p.collateralHolder, signer.address, collateralAmount.mul(2));
      await collateralAsset.approve(tetuConverter.address, Misc.MAX_UINT);

      // make first borrow
      const plan1 = await tetuConverter.findBorrowStrategies(
        "0x",
        p.collateralAsset,
        collateralAmount,
        p.borrowAsset,
        1
      );
      const isAprNegative = plan1.aprs18[0].lt(0);

      await tetuConverter.borrow(
        plan1.converters[0],
        p.collateralAsset,
        plan1.collateralAmountsOut[0],
        p.borrowAsset,
        plan1.amountToBorrowsOut[0],
        signer.address
      );

      const positions = await tetuConverter.getPositions(signer.address, p.collateralAsset, p.borrowAsset);
      const poolAdapter = IPoolAdapter__factory.connect(positions[0], signer);

      const statusAfterBorrow1 = await poolAdapter.getStatus();
      const borrowedAmount1 = await borrowAsset.balanceOf(signer.address);

      // debt changing actions
      if (p.targetHealthFactor2) {
        await borrowManagerAsGov.setTargetHealthFactors(
          [p.collateralAsset],
          [parseUnits(p.targetHealthFactor2, 2)]
        );
      }
      await TimeUtils.advanceNBlocks(p.countBlocksBetweenBorrows || 0);

      // make second borrow
      const plan2 = await tetuConverter.findBorrowStrategies(
        "0x",
        p.collateralAsset,
        collateralAmount,
        p.borrowAsset,
        1
      );
      console.log("plan2", plan2);

      const statusBeforeBorrow2 = await poolAdapter.getStatus();
      await tetuConverter.borrow(
        plan2.converters[0],
        p.collateralAsset,
        plan2.collateralAmountsOut[0],
        p.borrowAsset,
        plan2.amountToBorrowsOut[0],
        signer.address
      );
      const statusAfterBorrow2 = await poolAdapter.getStatus();
      const borrowedAmount2 = await borrowAsset.balanceOf(signer.address);

      return {
        borrowedAmount1: +formatUnits(borrowedAmount1, decimalsBorrow),
        borrowedAmount2: +formatUnits(borrowedAmount2.sub(borrowedAmount1), decimalsBorrow),
        statusAfterBorrow1: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(statusAfterBorrow1, decimalsCollateral, decimalsBorrow),
        statusBeforeBorrow2: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(statusBeforeBorrow2, decimalsCollateral, decimalsBorrow),
        statusAfterBorrow2: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(statusAfterBorrow2, decimalsCollateral, decimalsBorrow),
        isAprNegative
      }
    }

    describe("rebalanceOnBorrowEnabled ON", () => {
      describe("Borrow, move time, borrow again", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeBorrowWithRebalanceTest(): Promise<IBorrowWithRebalanceResults> {
          return makeBorrowWithRebalance({
            collateralAsset: MaticAddresses.USDC,
            collateralHolder: MaticAddresses.HOLDER_USDC,
            borrowAsset: MaticAddresses.USDT,
            collateralAmount: "1000",
            countBlocksBetweenBorrows: 1000,
            targetHealthFactor1: "2.1",
            rebalanceOnBorrowEnabled: true
          });
        }

        it("second borrowed amount should be less than the first one", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          if (ret.isAprNegative) {
            expect(ret.borrowedAmount2).gt(ret.borrowedAmount1);
          } else {
            expect(ret.borrowedAmount2).lt(ret.borrowedAmount1);
          }
          console.log(ret);
        });
        it("should change health factor of the pool adapter before second borrow", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          if (ret.isAprNegative) {
            expect(ret.statusBeforeBorrow2.healthFactor).gt(ret.statusAfterBorrow1.healthFactor);
          } else {
            expect(ret.statusBeforeBorrow2.healthFactor).lt(ret.statusAfterBorrow1.healthFactor);
          }
        });
        it("should restore health factor by second borrow", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          expect(ret.statusAfterBorrow2.healthFactor).approximately(2.1, 1e-7);
        });
      });
      describe("Borrow, increase target health factor a bit, borrow again with full rebalance", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeBorrowWithRebalanceTest(): Promise<IBorrowWithRebalanceResults> {
          return makeBorrowWithRebalance({
            collateralAsset: MaticAddresses.USDC,
            collateralHolder: MaticAddresses.HOLDER_USDC,
            borrowAsset: MaticAddresses.USDT,
            collateralAmount: "1000",
            targetHealthFactor1: "2.1",
            targetHealthFactor2: "2.2",
          });
        }

        it("second borrowed amount should be less than the first one", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          expect(ret.borrowedAmount2).lt(ret.borrowedAmount1);
          console.log(ret);
        });
        it("should restore health factor by second borrow", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          expect(ret.statusAfterBorrow2.healthFactor).approximately(2.2, 1e-8);
        });
      });
      describe("Borrow, reduce target health factor a bit, borrow again with full rebalance", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeBorrowWithRebalanceTest(): Promise<IBorrowWithRebalanceResults> {
          return makeBorrowWithRebalance({
            collateralAsset: MaticAddresses.USDC,
            collateralHolder: MaticAddresses.HOLDER_USDC,
            borrowAsset: MaticAddresses.USDT,
            collateralAmount: "1000",
            targetHealthFactor1: "2.1",
            targetHealthFactor2: "2.0",
          });
        }

        it("second borrowed amount should be greater than the first one", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          expect(ret.borrowedAmount2).gt(ret.borrowedAmount1);
          console.log(ret);
        });
        it("should restore health factor by second borrow", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          expect(ret.statusAfterBorrow2.healthFactor).approximately(2.0, 1e-8);
        });
      });
      describe("Borrow, increase target health factor significantly, borrow again with partial rebalance", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeBorrowWithRebalanceTest(): Promise<IBorrowWithRebalanceResults> {
          return makeBorrowWithRebalance({
            collateralAsset: MaticAddresses.USDC,
            collateralHolder: MaticAddresses.HOLDER_USDC,
            borrowAsset: MaticAddresses.USDT,
            collateralAmount: "1000",
            targetHealthFactor1: "2.1",
            targetHealthFactor2: "4.2",
          });
        }

        it("second borrowed amount should be less than the first one", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          expect(ret.borrowedAmount2).lt(ret.borrowedAmount1);
          console.log(ret);
        });
        it("second borrowed amount should be greater than zero", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          expect(ret.borrowedAmount2).gt(0);
        });
        it("should increase health factor by second borrow", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          expect(ret.statusAfterBorrow2.healthFactor).gt(3.0);
        });
      });
      describe("Borrow, reduce target health factor significantly, borrow again with partial rebalance", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeBorrowWithRebalanceTest(): Promise<IBorrowWithRebalanceResults> {
          return makeBorrowWithRebalance({
            collateralAsset: MaticAddresses.USDC,
            collateralHolder: MaticAddresses.HOLDER_USDC,
            borrowAsset: MaticAddresses.USDT,
            collateralAmount: "1000",
            targetHealthFactor1: "2.1",
            targetHealthFactor2: "1.05",
          });
        }

        it("second borrowed amount should be greater than the first one", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          expect(ret.borrowedAmount2).gt(ret.borrowedAmount1);
          console.log(ret);
        });
        it("second borrowed amount shouldn't exceed first amount more than expected", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          expect(ret.borrowedAmount2).lt(1100);
        });
        it("should restore health factor by second borrow", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          expect(ret.statusAfterBorrow2.healthFactor).lt(2.05);
        });
      });
    });
    describe("rebalanceOnBorrowEnabled OFF", () => {
      describe("Borrow, move time, borrow again", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeBorrowWithRebalanceTest(): Promise<IBorrowWithRebalanceResults> {
          return makeBorrowWithRebalance({
            collateralAsset: MaticAddresses.USDC,
            collateralHolder: MaticAddresses.HOLDER_USDC,
            borrowAsset: MaticAddresses.USDT,
            collateralAmount: "1000",
            countBlocksBetweenBorrows: 1000,
            targetHealthFactor1: "2.1",
            rebalanceOnBorrowEnabled: false
          });
        }

        it("second borrowed amount should be equal to the first one", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          expect(ret.borrowedAmount2).approximately(ret.borrowedAmount1, 0.01);
          console.log(ret);
        });
        it("should change health factor of the pool adapter before second borrow", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          if (ret.isAprNegative) {
            expect(ret.statusBeforeBorrow2.healthFactor).gt(ret.statusAfterBorrow1.healthFactor);
          } else {
            expect(ret.statusBeforeBorrow2.healthFactor).lt(ret.statusAfterBorrow1.healthFactor);
          }
        });
        it("should not restore health factor by second borrow", async () => {
          const ret = await loadFixture(makeBorrowWithRebalanceTest);
          if (ret.isAprNegative) {
            expect(ret.statusAfterBorrow2.healthFactor).gt(2.1);
          } else {
            expect(ret.statusAfterBorrow2.healthFactor).lt(2.1);
          }
        });
      });
    });
  });


//endregion Unit tests
});