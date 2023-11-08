import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {Accountant, MockERC20, PoolAdapterMock2} from "../../typechain";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {expect} from "chai";
import {Misc} from "../../scripts/utils/Misc";
import {MocksHelper} from "../baseUT/app/MocksHelper";
import {CoreContracts} from "../baseUT/types/CoreContracts";
import {TetuConverterApp} from "../baseUT/app/TetuConverterApp";

describe("AccountantTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;
  let accountant: Accountant;
  let user: SignerWithAddress;
  let usdc: MockERC20;
  let usdt: MockERC20;
  let dai: MockERC20;
  let matic: MockERC20;
  let poolAdapter: PoolAdapterMock2;
  let core: CoreContracts;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];

    accountant = (await DeployUtils.deployContract(signer, "Accountant")) as Accountant;
    usdc = await DeployUtils.deployContract(signer, 'MockERC20', 'USDC', 'USDC', 6) as MockERC20;
    usdt = await DeployUtils.deployContract(signer, 'MockERC20', 'USDT', 'USDT', 6) as MockERC20;
    dai = await DeployUtils.deployContract(signer, 'MockERC20', 'Dai', 'DAI', 18) as MockERC20;
    matic = await DeployUtils.deployContract(signer, 'MockERC20', 'Matic', 'MATIC', 18) as MockERC20;

    user = await Misc.impersonate(ethers.Wallet.createRandom().address);
    poolAdapter = await MocksHelper.createPoolAdapterMock2(signer);

    core = await CoreContracts.build(await TetuConverterApp.createController(signer, {networkId: HARDHAT_NETWORK_ID,}));
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Unit tests
  describe("sequence of borrow/repay", () => {
    interface IParams {
      isBorrow: boolean;

      amountC: string;
      amountB: string;

      totalCollateral: string;
      totalDebt: string;

      collateralAsset?: MockERC20; // usdc by default
      borrowAsset?: MockERC20; // usdt by default
      underlying?: MockERC20; // collateralAsset by default
      prices?: string[]; // "1" by default
    }

    interface IResults {
      suppliedAmount: number;
      borrowedAmount: number;
      lastTotalCollateral: number;
      lastTotalDebt: number;
      totalGain: number;
      totalLosses: number;
    }

    async function makeTest(p: IParams): Promise<IResults> {
      const collateralAsset = p.collateralAsset ?? usdc;
      const borrowAsset = p.borrowAsset ?? usdt;
      const underlying = p.underlying ?? collateralAsset;

      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();
      const decimalsUnderlying = await underlying.decimals();


      if (p.isBorrow) {
        await accountant.connect(user).onBorrow(
          parseUnits(p.amountC, decimalsCollateral),
          parseUnits(p.amountB, decimalsBorrow),
        );
      } else {
        await accountant.connect(user).onRepay(
          parseUnits(p.amountC, decimalsCollateral),
          parseUnits(p.amountB, decimalsBorrow),
        );
      }

      const state = await accountant.getPoolAdapterState(user.address);
      return {
        borrowedAmount: +formatUnits(state.borrowedAmount, decimalsBorrow),
        suppliedAmount: +formatUnits(state.suppliedAmount, decimalsCollateral),
        lastTotalCollateral: +formatUnits(state.lastTotalCollateral, decimalsCollateral),
        lastTotalDebt: +formatUnits(state.lastTotalDebt, decimalsBorrow),
        totalGain:  +formatUnits(state.totalGain, decimalsUnderlying),
        totalLosses:  +formatUnits(state.totalLosses, decimalsUnderlying),
      }
    }

    describe("borrow", () => {
      let snapshotLocal0: string;
      let retBorrow1: IResults;
      before(async function () {
        snapshotLocal0 = await TimeUtils.snapshot();
        retBorrow1 = await makeTest({
          amountC: "10",
          amountB: "20",
          totalCollateral: "10",
          totalDebt: "20",
          isBorrow: true,
        });
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal0);
      });

      it("should return expected state", async () => {
        expect(
          [retBorrow1.suppliedAmount, retBorrow1.borrowedAmount, retBorrow1.lastTotalCollateral, retBorrow1.lastTotalDebt].join()
        ).eq(
          [10, 20, 10, 20].join()
        )
      });

      describe("second borrow", () => {
        let snapshotLocal1: string;
        let retBorrow2: IResults;
        before(async function () {
          snapshotLocal1 = await TimeUtils.snapshot();
          // let's assume, that long time is passed since first borrow. Gain = 36 - 5 - 10 = 21, Losses = 55 - 20 - 10 = 25
          retBorrow2 = await makeTest({
              amountC: "5",
              amountB: "10",
              totalCollateral: "36",
              totalDebt: "55",
              isBorrow: true
          });
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal1);
        });
        it("should return expected state", async () => {
          expect(
            [retBorrow2.suppliedAmount, retBorrow2.borrowedAmount, retBorrow2.lastTotalCollateral, retBorrow2.lastTotalDebt].join()
          ).eq(
            [15, 30, 36, 55].join()
          )
        });

        describe("partial repay", () => {
          let snapshotLocal2: string;
          let retRepay1: IResults;
          before(async function () {
            snapshotLocal2 = await TimeUtils.snapshot();
            // let's assume, that we have totalDebt: "37", totalCollateral: "60" before repay, so total gain is 21 + 1 = 22, total losses = 25 + 5 = 30
            retRepay1 = await makeTest({
              amountC: "12",
              amountB: "16",
              totalCollateral: "25",
              totalDebt: "44",
              isBorrow: false
            });
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal2);
          });

          it("should return expected suppliedAmount", async () => {
            expect(retRepay1.suppliedAmount).eq(10 + 5 - 12 / 37 * 15);
          });
          it("should return expected borrowedAmount", async () => {
            expect(retRepay1.borrowedAmount).approximately(20 + 10 - 16 / 60 * 30, 1e-5);
          });

          it("should return expected total amounts", async () => {
            expect([retRepay1.lastTotalCollateral, retRepay1.lastTotalDebt].join()).eq([25, 44].join());
          });
          it("should return expected gain", async () => {
            expect(retRepay1.totalGain).approximately(12 - 12 / 37 * 15, 1e-5);
          });
          it("should return expected losses", async () => {
            expect(retRepay1.totalLosses).approximately(16 - 16 / 60 * 30, 1e-5);
          });
        });
        describe("full repay", () => {
          let snapshotLocal2: string;
          let retRepay1: IResults;
          before(async function () {
            snapshotLocal2 = await TimeUtils.snapshot();
            // let's assume, that we have totalDebt: "37", totalCollateral: "60" before repay, so total gain is 21 + 1 = 22, total losses = 25 + 5 = 30
            retRepay1 = await makeTest({
              amountC: "37",
              amountB: "60",
              totalCollateral: "0",
              totalDebt: "0",
              isBorrow: false
            });
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal2);
          });
          it("should return expected suppliedAmount", async () => {
            expect(retRepay1.suppliedAmount).eq(0);
          });
          it("should return expected borrowedAmount", async () => {
            expect(retRepay1.borrowedAmount).eq(0);
          });

          it("should return expected total amounts", async () => {
            expect([retRepay1.lastTotalCollateral, retRepay1.lastTotalDebt].join()).eq([0, 0].join());
          });
          it("should return expected gain", async () => {
            expect(retRepay1.totalGain).eq(22);
          });
          it("should return expected losses", async () => {
            expect(retRepay1.totalLosses).eq(30);
          });
        });

        describe("borrow with zero collateral (borrowToRebalance)", () => {
          // todo
        });
        describe("repay with zero collateral (repayToRebalance)", () => {
          // todo
        });
      });
    });
  });
//endregion Unit tests
});