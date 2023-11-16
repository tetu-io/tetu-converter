import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {
  Bookkeeper,
  IPriceOracle__factory,
  MockERC20,
  PoolAdapterMock2,
  PriceOracleMock__factory
} from "../../typechain";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {expect} from "chai";
import {Misc} from "../../scripts/utils/Misc";
import {MocksHelper} from "../baseUT/app/MocksHelper";
import {CoreContracts} from "../baseUT/types/CoreContracts";
import {TetuConverterApp} from "../baseUT/app/TetuConverterApp";

describe("BookkeeperTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;
  let bookkeeper: Bookkeeper;
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

    usdc = await DeployUtils.deployContract(signer, 'MockERC20', 'USDC', 'USDC', 6) as MockERC20;
    usdt = await DeployUtils.deployContract(signer, 'MockERC20', 'USDT', 'USDT', 6) as MockERC20;
    dai = await DeployUtils.deployContract(signer, 'MockERC20', 'Dai', 'DAI', 18) as MockERC20;
    matic = await DeployUtils.deployContract(signer, 'MockERC20', 'Matic', 'MATIC', 18) as MockERC20;

    user = await Misc.impersonate(ethers.Wallet.createRandom().address);
    poolAdapter = await MocksHelper.createPoolAdapterMock2(signer);

    const assetsAll = [usdt, dai, matic, usdc];
    core = await CoreContracts.build(await TetuConverterApp.createController(
      signer, {
        networkId: HARDHAT_NETWORK_ID,
        borrowManagerFabric: {deploy: async () => (
          await MocksHelper.createBorrowManagerStub(signer, true)).address
        },
        priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(
            signer,
            assetsAll.map(x => x.address),
            assetsAll.map(x => parseUnits("1", 18))
          )
        ).address
      }
    ));

    bookkeeper = core.bookkeeper;
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
      countActions: number;
      // last registered action data
      suppliedAmount: number;
      borrowedAmount: number;
      totalCollateral: number;
      totalDebt: number;
      gain: number;
      losses: number;
      prices: number[];
    }

    async function makeTest(p: IParams): Promise<IResults> {
      const collateralAsset = p.collateralAsset ?? usdc;
      const borrowAsset = p.borrowAsset ?? usdt;
      const underlying = p.underlying ?? collateralAsset;

      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();
      const decimalsUnderlying = await underlying.decimals();

      await PriceOracleMock__factory.connect(await core.controller.priceOracle(), signer).changePrices(
        [collateralAsset.address, borrowAsset.address],
        (p.prices ?? ["1", "1"]).map(x => parseUnits(x, 18))
      );

      await poolAdapter.setStatus(
        parseUnits(p.totalCollateral, decimalsCollateral),
        parseUnits(p.totalDebt, decimalsBorrow),
        2,
        true,
        0,
        false
      );
      await poolAdapter.setConfig(
        ethers.Wallet.createRandom().address,
        user.address,
        collateralAsset.address,
        borrowAsset.address
      );

      if (p.isBorrow) {
        await bookkeeper.connect(await Misc.impersonate(poolAdapter.address)).onBorrow(
          parseUnits(p.amountC, decimalsCollateral),
          parseUnits(p.amountB, decimalsBorrow),
        );
      } else {
        await bookkeeper.connect(await Misc.impersonate(poolAdapter.address)).onRepay(
          parseUnits(p.amountC, decimalsCollateral),
          parseUnits(p.amountB, decimalsBorrow),
        );
      }

      const countActions = (await bookkeeper.actionsLength(poolAdapter.address)).toNumber();
      const lastAction = await bookkeeper.actionsAt(poolAdapter.address, countActions - 1);
      const repayInfo = await bookkeeper.repayInfoAt(poolAdapter.address, countActions - 1);

      return {
        countActions,

        borrowedAmount: +formatUnits(lastAction.borrowedAmount, decimalsBorrow),
        suppliedAmount: +formatUnits(lastAction.suppliedAmount, decimalsCollateral),
        totalCollateral: +formatUnits(lastAction.totalCollateral, decimalsCollateral),
        totalDebt: +formatUnits(lastAction.totalDebt, decimalsBorrow),

        gain: +formatUnits(repayInfo.gain, decimalsUnderlying),
        losses:  +formatUnits(repayInfo.loss, decimalsUnderlying),
        prices: repayInfo.prices.map(x => +formatUnits(x, 18))
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
          [retBorrow1.suppliedAmount, retBorrow1.borrowedAmount, retBorrow1.totalCollateral, retBorrow1.totalDebt].join()
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
              totalCollateral: "17",
              totalDebt: "55",
              isBorrow: true
          });
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal1);
        });
        it("should return expected state", async () => {
          expect(
            [retBorrow2.suppliedAmount, retBorrow2.borrowedAmount, retBorrow2.totalCollateral, retBorrow2.totalDebt].join()
          ).eq(
            [15, 30, 17, 55].join()
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
              totalCollateral: "24",
              totalDebt: "44",
              isBorrow: false,
              prices: ["3", "4"]
            });
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal2);
          });

          it("should return expected suppliedAmount", async () => {
            const collateralRatio = (10 + 5) / (24 + 12);
            expect(retRepay1.suppliedAmount).eq(10 + 5 - 12 * collateralRatio);
          });
          it("should return expected borrowedAmount", async () => {
            const debtRatio = (20 + 10) / (44 + 16);
            expect(retRepay1.borrowedAmount).approximately(20 + 10 - 16 * debtRatio, 1e-5);
          });

          it("should return expected total amounts", async () => {
            expect([retRepay1.totalCollateral, retRepay1.totalDebt].join()).eq([24, 44].join());
          });
          it("should return expected gain", async () => {
            const collateralRatio = (10 + 5) / (24 + 12);
            expect(retRepay1.gain).approximately(12 - 12 * collateralRatio, 1e-5);
          });
          it("should return expected losses", async () => {
            const debtRatio = (20 + 10) / (44 + 16);
            expect(retRepay1.losses).approximately(16 - 16 * debtRatio, 1e-5);
          });
          it("should return expected prices", async () => {
            expect(retRepay1.prices.join()).eq([3, 4].join());
          });
        });
        describe("full repay", () => {
          let snapshotLocal2: string;
          let retRepay1: IResults;
          before(async function () {
            snapshotLocal2 = await TimeUtils.snapshot();
            // let's assume, that we have totalDebt: "37", totalCollateral: "60" before repay, so total gain is 21 + 1 = 22, total losses = 25 + 5 = 30
            retRepay1 = await makeTest({
              amountC: "25",
              amountB: "40",
              totalCollateral: "0",
              totalDebt: "0",
              isBorrow: false,
              prices: ["2", "0.5"]
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
            expect([retRepay1.totalCollateral, retRepay1.totalDebt].join()).eq([0, 0].join());
          });
          it("should return expected gain", async () => {
            const collateralRatio = (10 + 5) / (25);
            expect(retRepay1.gain).approximately(25 - 25 * collateralRatio, 1e-5);
          });
          it("should return expected losses", async () => {
            const debtRatio = (20 + 10) / (40);
            expect(retRepay1.losses).approximately(40 - 40 * debtRatio, 1e-5);
          });
          it("should return expected prices", async () => {
            expect(retRepay1.prices.join()).eq([2, 0.5].join());
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