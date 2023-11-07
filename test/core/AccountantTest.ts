import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {Accountant} from "../../typechain";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {expect} from "chai";
import {Misc} from "../../scripts/utils/Misc";

describe("AccountantTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let signer: SignerWithAddress;
  let accountant: Accountant;
  let decimalsCollateral: number;
  let decimalsBorrow: number;
  let user: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];

    accountant = (await DeployUtils.deployContract(signer, "Accountant")) as Accountant;
    decimalsCollateral = 18;
    decimalsBorrow = 6;
    user = await Misc.impersonate(ethers.Wallet.createRandom().address);
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Unit tests
  describe("sequence of borrow/repay", () => {
    interface IAction {
      /** true - borrow, false - repay */
      isBorrow: boolean;
      amountC: string;
      amountB: string;
      totalCollateral: string;
      totalDebt: string;
    }
    interface IParams {
      actions: IAction[];
    }

    interface IResults {
      suppliedAmount: number;
      borrowedAmount: number;
      lastTotalCollateral: number;
      lastTotalDebt: number;

      gains: number[];
      losses: number[];
    }

    async function makeTest(p: IParams): Promise<IResults> {
      const gains: number[] = [];
      const losses: number[] = [];

      for (const action of p.actions) {
        if (action.isBorrow) {
          await accountant.connect(user).onBorrow(
            parseUnits(action.amountC, decimalsCollateral),
            parseUnits(action.amountB, decimalsBorrow),
            parseUnits(action.totalCollateral, decimalsCollateral),
            parseUnits(action.totalDebt, decimalsBorrow)
          );
        } else {
          const ret = await accountant.connect(user).callStatic.onRepay(
            parseUnits(action.amountC, decimalsCollateral),
            parseUnits(action.amountB, decimalsBorrow),
            parseUnits(action.totalCollateral, decimalsCollateral),
            parseUnits(action.totalDebt, decimalsBorrow)
          );
          await accountant.connect(user).onRepay(
            parseUnits(action.amountC, decimalsCollateral),
            parseUnits(action.amountB, decimalsBorrow),
            parseUnits(action.totalCollateral, decimalsCollateral),
            parseUnits(action.totalDebt, decimalsBorrow)
          );
          gains.push(+formatUnits(ret.gain, decimalsCollateral));
          losses.push(+formatUnits(ret.losses, decimalsBorrow));
        }
      }

      const userState = await accountant.getUserState(user.address);
      return {
        gains,
        losses,

        borrowedAmount: +formatUnits(userState.borrowedAmount, decimalsBorrow),
        suppliedAmount: +formatUnits(userState.suppliedAmount, decimalsCollateral),
        lastTotalCollateral: +formatUnits(userState.lastTotalCollateral, decimalsCollateral),
        lastTotalDebt: +formatUnits(userState.lastTotalDebt, decimalsBorrow)
      }
    }

    describe("borrow", () => {
      let snapshotLocal0: string;
      let retBorrow1: IResults;
      before(async function () {
        snapshotLocal0 = await TimeUtils.snapshot();
        retBorrow1 = await makeTest({actions: [{amountC: "10", amountB: "20", totalCollateral: "10", totalDebt: "20", isBorrow: true}]});
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
            actions: [{
              amountC: "5",
              amountB: "10",
              totalCollateral: "36",
              totalDebt: "55",
              isBorrow: true
            }]
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
              actions: [{
                amountC: "12",
                amountB: "16",
                totalCollateral: "25",
                totalDebt: "44",
                isBorrow: false
              }]
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
            expect(retRepay1.gains[0]).approximately(12 - 12 / 37 * 15, 1e-5);
          });
          it("should return expected losses", async () => {
            expect(retRepay1.losses[0]).approximately(16 - 16 / 60 * 30, 1e-5);
          });
        });
        describe("full repay", () => {
          let snapshotLocal2: string;
          let retRepay1: IResults;
          before(async function () {
            snapshotLocal2 = await TimeUtils.snapshot();
            // let's assume, that we have totalDebt: "37", totalCollateral: "60" before repay, so total gain is 21 + 1 = 22, total losses = 25 + 5 = 30
            retRepay1 = await makeTest({
              actions: [{
                amountC: "37",
                amountB: "60",
                totalCollateral: "0",
                totalDebt: "0",
                isBorrow: false
              }]
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
            expect(retRepay1.gains[0]).eq(22);
          });
          it("should return expected losses", async () => {
            expect(retRepay1.losses[0]).eq(30);
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