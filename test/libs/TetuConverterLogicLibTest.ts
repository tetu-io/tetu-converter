import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MockERC20, TetuConverterLogicLibFacade} from "../../typechain";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../../scripts/utils/HardhatUtils";
import {MocksHelper} from "../baseUT/app/MocksHelper";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {ethers} from "hardhat";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {PromiseOrValue} from "../../typechain/common";
import {BigNumber, BigNumberish} from "ethers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {Misc} from "../../scripts/utils/Misc";

describe("TetuConverterLogicLibTest", function() {
//region Global vars for all tests
  let snapshotRoot: string;
  let signer: SignerWithAddress;
  let facade: TetuConverterLogicLibFacade;
  let usdc: MockERC20;
  let usdt: MockERC20;
  let dai: MockERC20;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

    snapshotRoot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];
    facade = await DeployUtils.deployContract(signer, "TetuConverterLogicLibFacade") as TetuConverterLogicLibFacade;

    usdc = await MocksHelper.createMockedToken(signer, "usdc", 6);
    usdt = await MocksHelper.createMockedToken(signer, "usdt", 6);
    dai = await MocksHelper.createMockedToken(signer, "dai", 18);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotRoot);
  });
//endregion before, after

//region Unit tests
  describe("repay", function () {
    interface IParams {
      collateralAsset: MockERC20;
      borrowAsset: MockERC20;
      totalAmountToRepay: string;
      totalDebtForPoolAdapter: string;
      lastPoolAdapter: boolean;
      initialBalanceCollateralAssetPoolAdapter: string;
      initialBalanceBorrowAssetFacade: string;
      debtGapValue?: string; // [0..100_000], 1000 by default

      repay: {
        amountToRepay: string;
        closePosition: boolean;
        collateralAmountSendToReceiver: string;
        borrowAmountSendToReceiver: string;
      }
    }

    interface IResults {
      remainTotalDebt: number;
      collateralAmountOut: number;

      balanceBorrowAssetReceiver: number;
      balanceBorrowAssetFacade: number;
      balanceBorrowAssetPoolAdapter: number;
      balanceCollateralAssetReceiver: number;
      balanceCollateralAssetPoolAdapter: number;
    }

    async function repay(p: IParams): Promise<IResults> {
      const receiver = ethers.Wallet.createRandom().address;

      const decimalsCollateral = await p.collateralAsset.decimals();
      const decimalsBorrow = await p.borrowAsset.decimals();

      const poolAdapter = await MocksHelper.createPoolAdapterMock2(signer);
      await p.collateralAsset.mint(poolAdapter.address, parseUnits(p.initialBalanceCollateralAssetPoolAdapter, decimalsCollateral));

      await p.borrowAsset.mint(facade.address, parseUnits(p.initialBalanceBorrowAssetFacade, decimalsBorrow));
      await p.borrowAsset.connect(await Misc.impersonate(facade.address)).approve(poolAdapter.address, parseUnits(p.repay.amountToRepay, decimalsBorrow));

      await poolAdapter.setRepay(
        p.collateralAsset.address,
        p.borrowAsset.address,
        parseUnits(p.repay.amountToRepay, decimalsBorrow),
        p.repay.closePosition,
        parseUnits(p.repay.collateralAmountSendToReceiver, decimalsCollateral),
        parseUnits(p.repay.borrowAmountSendToReceiver, decimalsBorrow)
      );

      const ret = await facade.callStatic.repay(
        parseUnits(p.totalAmountToRepay, decimalsBorrow),
        poolAdapter.address,
        parseUnits(p.totalDebtForPoolAdapter, decimalsBorrow),
        receiver,
        p.lastPoolAdapter,
        p.borrowAsset.address,
        p.collateralAsset.address,
        parseUnits(p.debtGapValue ?? "1000", 5)
      );

      await facade.repay(
        parseUnits(p.totalAmountToRepay, decimalsBorrow),
        poolAdapter.address,
        parseUnits(p.totalDebtForPoolAdapter, decimalsBorrow),
        receiver,
        p.lastPoolAdapter,
        p.borrowAsset.address,
        p.collateralAsset.address,
        BigNumber.from(p.debtGapValue ?? "1000")
      );

      return {
        remainTotalDebt: +formatUnits(ret.remainTotalDebt, decimalsBorrow),
        collateralAmountOut: +formatUnits(ret.collateralAmountOut, decimalsCollateral),

        balanceBorrowAssetReceiver: +formatUnits(await p.borrowAsset.balanceOf(receiver), decimalsBorrow),
        balanceCollateralAssetReceiver: +formatUnits(await p.collateralAsset.balanceOf(receiver), decimalsCollateral),

        balanceBorrowAssetFacade: +formatUnits(await p.borrowAsset.balanceOf(facade.address), decimalsBorrow),

        balanceBorrowAssetPoolAdapter: +formatUnits(await p.borrowAsset.balanceOf(poolAdapter.address), decimalsBorrow),
        balanceCollateralAssetPoolAdapter: +formatUnits(await p.collateralAsset.balanceOf(poolAdapter.address), decimalsCollateral),
      }
    }

    describe("Last pool adapter, direct pay is allowed", () => {
      describe("Partial repay", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function repayTest(): Promise<IResults> {
          return repay({
            collateralAsset: usdc,
            borrowAsset: dai,
            lastPoolAdapter: true,
            totalDebtForPoolAdapter: "1000",
            initialBalanceCollateralAssetPoolAdapter: "2000",
            initialBalanceBorrowAssetFacade: "999",
            totalAmountToRepay: "600",
            repay: {
              amountToRepay: "600",
              collateralAmountSendToReceiver: "1200",
              borrowAmountSendToReceiver: "0",
              closePosition: false
            }
          });
        }

        it("should return expected amounts", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.remainTotalDebt).eq(0);
          expect(ret.collateralAmountOut).eq(1200);
        });
        it("should set expected balance of receiver", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceCollateralAssetReceiver).eq(1200);
          expect(ret.balanceBorrowAssetReceiver).eq(0);
        });
        it("should set expected balance of pool adapter", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceBorrowAssetPoolAdapter).eq(600);
          expect(ret.balanceCollateralAssetPoolAdapter).eq(2000 - 1200);
        });
        it("should set expected balance of facade", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceBorrowAssetFacade).eq(999 - 600);
        });
      });
      describe("Full repay", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function repayTest(): Promise<IResults> {
          return repay({
            collateralAsset: usdc,
            borrowAsset: dai,
            lastPoolAdapter: true,
            totalDebtForPoolAdapter: "1000",
            initialBalanceCollateralAssetPoolAdapter: "2000",
            initialBalanceBorrowAssetFacade: "1009",
            totalAmountToRepay: "1000",
            repay: {
              amountToRepay: "1000",
              collateralAmountSendToReceiver: "2000",
              borrowAmountSendToReceiver: "80",
              closePosition: true
            }
          });
        }

        it("should return expected amounts", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.remainTotalDebt).eq(0);
          expect(ret.collateralAmountOut).eq(2000);
        });
        it("should set expected balance of receiver", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceCollateralAssetReceiver).eq(2000);
          expect(ret.balanceBorrowAssetReceiver).eq(80);
        });
        it("should set expected balance of pool adapter", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceBorrowAssetPoolAdapter).eq(1000 - 80);
          expect(ret.balanceCollateralAssetPoolAdapter).eq(0);
        });
        it("should set expected balance of facade", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceBorrowAssetFacade).eq(1009 - 1000);
        });
      });
    });
    describe("Not last pool adapter", () => {
      describe("Partial repay, direct pay is allowed", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function repayTest(): Promise<IResults> {
          return repay({
            collateralAsset: usdc,
            borrowAsset: dai,
            lastPoolAdapter: false,
            totalDebtForPoolAdapter: "1000",
            initialBalanceCollateralAssetPoolAdapter: "2000",
            initialBalanceBorrowAssetFacade: "999",
            totalAmountToRepay: "970",
            repay: {
              amountToRepay: "970",
              collateralAmountSendToReceiver: "1200",
              borrowAmountSendToReceiver: "1",
              closePosition: false
            }
          });
        }

        it("should return expected amounts", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.remainTotalDebt).eq(0);
          expect(ret.collateralAmountOut).eq(1200);
        });
        it("should set expected balance of receiver", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceCollateralAssetReceiver).eq(1200);
          expect(ret.balanceBorrowAssetReceiver).eq(1);
        });
        it("should set expected balance of pool adapter", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceBorrowAssetPoolAdapter).eq(970 - 1);
          expect(ret.balanceCollateralAssetPoolAdapter).eq(2000 - 1200);
        });
        it("should set expected balance of facade", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceBorrowAssetFacade).eq(999 - 970);
        });
      });
      describe("Partial repay, direct pay is not allowed", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function repayTest(): Promise<IResults> {
          return repay({
            collateralAsset: usdc,
            borrowAsset: dai,
            lastPoolAdapter: false,
            totalDebtForPoolAdapter: "1000",
            initialBalanceCollateralAssetPoolAdapter: "2000",
            initialBalanceBorrowAssetFacade: "999",
            totalAmountToRepay: "991",
            repay: {
              amountToRepay: "991",
              collateralAmountSendToReceiver: "1200",
              borrowAmountSendToReceiver: "7",
              closePosition: false
            }
          });
        }

        it("should return expected amounts", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.remainTotalDebt).eq(0);
          expect(ret.collateralAmountOut).eq(1200);
        });
        it("should set expected balance of receiver", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceCollateralAssetReceiver).eq(1200);
          expect(ret.balanceBorrowAssetReceiver).eq(0);
        });
        it("should set expected balance of pool adapter", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceBorrowAssetPoolAdapter).eq(991 - 7);
          expect(ret.balanceCollateralAssetPoolAdapter).eq(2000 - 1200);
        });
        it("should set expected balance of facade", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceBorrowAssetFacade).eq(999 - 991 + 7);
        });
      });
      describe("Full repay", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function repayTest(): Promise<IResults> {
          return repay({
            collateralAsset: usdc,
            borrowAsset: dai,
            lastPoolAdapter: false,
            totalDebtForPoolAdapter: "1000",
            initialBalanceCollateralAssetPoolAdapter: "2000",
            initialBalanceBorrowAssetFacade: "1009",
            totalAmountToRepay: "1000",
            repay: {
              amountToRepay: "1000",
              collateralAmountSendToReceiver: "2000",
              borrowAmountSendToReceiver: "80",
              closePosition: true
            }
          });
        }

        it("should return expected amounts", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.remainTotalDebt).eq(80);
          expect(ret.collateralAmountOut).eq(2000);
        });
        it("should set expected balance of receiver", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceCollateralAssetReceiver).eq(2000);
          expect(ret.balanceBorrowAssetReceiver).eq(0);
        });
        it("should set expected balance of pool adapter", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceBorrowAssetPoolAdapter).eq(1000 - 80);
          expect(ret.balanceCollateralAssetPoolAdapter).eq(0);
        });
        it("should set expected balance of facade", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.balanceBorrowAssetFacade).eq(1009 - 1000 + 80);
        });
      });
    });
  });
//endregion Unit tests
});