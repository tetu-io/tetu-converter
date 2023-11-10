import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {AccountantLibFacade, MockERC20, PoolAdapterMock2} from "../../typechain";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {MocksHelper} from "../baseUT/app/MocksHelper";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {expect} from "chai";
import {AppConstants} from "../baseUT/types/AppConstants";

describe("AccountantLibTest", () => {
//region Global vars for all tests
  let snapshotRoot: string;
  let signer: SignerWithAddress;
  let facade: AccountantLibFacade;
  let usdc: MockERC20;
  let usdt: MockERC20;
  let dai: MockERC20;
  let poolAdapter: PoolAdapterMock2;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

    snapshotRoot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];
    facade = await DeployUtils.deployContract(signer, "AccountantLibFacade") as AccountantLibFacade;

    usdc = await MocksHelper.createMockedToken(signer, "usdc", 6);
    usdt = await MocksHelper.createMockedToken(signer, "usdt", 6);
    dai = await MocksHelper.createMockedToken(signer, "dai", 18);

    poolAdapter = await DeployUtils.deployContract(signer, "PoolAdapterMock2") as PoolAdapterMock2;
  });

  after(async function () {
    await TimeUtils.rollback(snapshotRoot);
  });
//endregion before, after

//region Unit tests
  describe("checkout", () => {
    interface IAction {
      suppliedAmount: string;
      borrowedAmount: string;
      totalCollateral: string;
      totalDebt: string;
      gain?: string;
      loss?: string;
      prices?: string[]; // "1" by default
    }
    interface IParams {
      collateralAsset?: MockERC20; // usdc by default
      borrowAsset?: MockERC20; // dai by default

      poolAdapter: {
        totalCollateral: string;
        totalDebt: string;
      }

      checkpoint: {
        suppliedAmount: string;
        borrowedAmount: string;
        totalCollateral: string;
        totalDebt: string;
        countActions?: number; // 0 by default
      }

      actions: IAction[];
    }
    interface IResults {
      deltaGain: number;
      deltaLoss: number;

      // current checkpoint
      suppliedAmount: number;
      borrowedAmount: number;
      totalCollateral: number;
      totalDebt: number;
      countActions: number;
    }

    async function checkout(p: IParams): Promise<IResults> {
      const collateralAsset = p.collateralAsset ?? usdc;
      const borrowAsset = p.borrowAsset ?? dai;

      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();

      // set up pool adapter
      await poolAdapter.setStatus(
        parseUnits(p.poolAdapter.totalCollateral, decimalsCollateral),
        parseUnits(p.poolAdapter.totalDebt, decimalsBorrow),
        2,
        true,
        0,
        false
      );
      await poolAdapter.setConfig(
        ethers.Wallet.createRandom().address,
        signer.address,
        collateralAsset.address,
        borrowAsset.address
      );

      // set up base state of the Accountant

      await facade.setPoolAdapterCheckpoint(poolAdapter.address, {
        suppliedAmount: parseUnits(p.checkpoint.suppliedAmount, decimalsCollateral),
        borrowedAmount: parseUnits(p.checkpoint.borrowedAmount, decimalsBorrow),
        totalCollateral: parseUnits(p.checkpoint.totalCollateral, decimalsCollateral),
        totalDebt: parseUnits(p.checkpoint.totalDebt, decimalsBorrow),
        countActions: p.checkpoint.countActions ?? 0,
      });

      await facade.setActions(
        poolAdapter.address,
        p.actions.map(x => {
          const prices = (x.prices ?? ["1", "1"]).map(price => parseUnits(price, 18));
          return {
            suppliedAmount: parseUnits(x.suppliedAmount, decimalsCollateral),
            borrowedAmount: parseUnits(x.borrowedAmount, decimalsBorrow),
            totalCollateral: parseUnits(x.totalCollateral, decimalsCollateral),
            totalDebt: parseUnits(x.totalDebt, decimalsBorrow),
            actionKind: AppConstants.ACTION_KIND_BORROW_0
          }
        })
      );

      const ret = await facade.callStatic.checkpoint(poolAdapter.address);
      await facade.checkpoint(poolAdapter.address);

      const after = await facade.getPoolAdapterCheckpoint(poolAdapter.address);

      return {
        deltaGain: +formatUnits(ret.deltaGain, decimalsCollateral),
        deltaLoss: +formatUnits(ret.deltaLoss, decimalsBorrow),

        suppliedAmount: +formatUnits(after.suppliedAmount, decimalsCollateral),
        borrowedAmount: +formatUnits(after.borrowedAmount, decimalsBorrow),
        countActions: after.countActions.toNumber(),
        totalCollateral: +formatUnits(after.totalCollateral, decimalsCollateral),
        totalDebt: +formatUnits(after.totalDebt, decimalsBorrow)
      }
    }

    describe("checkpoint => checkpoint", () => {
      let snapshotLocal0: string;
      before(async function () {
        snapshotLocal0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal0);
      });

      it("should return expected deltas", async () => {
        const ret = await checkout({
          actions: [{suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1000", totalDebt: "500"}],
          checkpoint: {suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1000", totalDebt: "500", countActions: 1},
          poolAdapter: {totalCollateral: "1010", totalDebt: "550"},
        });

        expect(ret.deltaGain).eq(10);
        expect(ret.deltaLoss).eq(50);
      })
    });
    describe("checkpoint => action => checkpoint", () => {
      let snapshotLocal0: string;
      before(async function () {
        snapshotLocal0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal0);
      });

      it("should return expected deltas", async () => {
        const ret = await checkout({
          checkpoint: {suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1000", totalDebt: "500"},
          actions: [{suppliedAmount: "1500", borrowedAmount: "750", totalCollateral: "1505", totalDebt: "775"}],
          poolAdapter: {totalCollateral: "1512", totalDebt: "780"},
        });

        expect(ret.deltaGain).eq(0);
        expect(ret.deltaLoss).eq(0);
      })
    });
  });

//endregion Unit tests
});

