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
import {Misc} from "../../scripts/utils/Misc";

describe("AccountantLibTest", () => {
//region Global vars for all tests
  let snapshotRoot: string;
  let signer: SignerWithAddress;
  let facade: AccountantLibFacade;
  let usdc: MockERC20;
  let usdt: MockERC20;
  let dai: MockERC20;
  let defaultPoolAdapter: PoolAdapterMock2;
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

    defaultPoolAdapter = await DeployUtils.deployContract(signer, "PoolAdapterMock2") as PoolAdapterMock2;
  });

  after(async function () {
    await TimeUtils.rollback(snapshotRoot);
  });
//endregion before, after

//region Unit tests
  describe("checkpointForPoolAdapter", () => {
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
      const poolAdapter = defaultPoolAdapter;
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
          return {
            suppliedAmount: parseUnits(x.suppliedAmount, decimalsCollateral),
            borrowedAmount: parseUnits(x.borrowedAmount, decimalsBorrow),
            totalCollateral: parseUnits(x.totalCollateral, decimalsCollateral),
            totalDebt: parseUnits(x.totalDebt, decimalsBorrow),
            actionKind: AppConstants.ACTION_KIND_BORROW_0
          }
        })
      );

      const ret = await facade.callStatic.checkpointForPoolAdapter(poolAdapter.address);
      await facade.checkpointForPoolAdapter(poolAdapter.address);

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

  describe("checkpointForUser and previewCheckpointForUser" , () => {
    interface IAction {
      suppliedAmount: string;
      borrowedAmount: string;
      totalCollateral: string;
      totalDebt: string;
      actionKind?: number; // BORROW_0 by default
    }
    interface IPoolAdapterParams {
      collateralAsset: MockERC20;
      borrowAsset: MockERC20;

      status: {
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
    interface IParams {
      tokens: MockERC20[];
      poolAdapters: IPoolAdapterParams[];
    }

    interface IResults {
      preview: {
        deltaGains: number[];
        deltaLosses: number[];
      }
      actual: {
        deltaGains: number[];
        deltaLosses: number[];
      }
    }

    async function checkpointForUser(p: IParams): Promise<IResults> {
      const poolAdapters: PoolAdapterMock2[] = [];
      const user = await Misc.impersonate(ethers.Wallet.createRandom().address);

      const tokenDecimals = await Promise.all(p.tokens.map(
        async x => x.decimals()
      ));

      // prepare pool adapters
      for (const pai of p.poolAdapters) {
        const poolAdapter = await DeployUtils.deployContract(signer, "PoolAdapterMock2") as PoolAdapterMock2;
        poolAdapters.push(poolAdapter);

        const decimalsCollateral = await pai.collateralAsset.decimals();
        const decimalsBorrow = await pai.borrowAsset.decimals();

        // set up pool adapter
        await poolAdapter.setStatus(
          parseUnits(pai.status.totalCollateral, decimalsCollateral),
          parseUnits(pai.status.totalDebt, decimalsBorrow),
          2,
          true,
          0,
          false
        );
        await poolAdapter.setConfig(
          ethers.Wallet.createRandom().address,
          user.address,
          pai.collateralAsset.address,
          pai.borrowAsset.address
        );

        // set up base state of the Accountant
        await facade.setPoolAdapterCheckpoint(poolAdapter.address, {
          suppliedAmount: parseUnits(pai.checkpoint.suppliedAmount, decimalsCollateral),
          borrowedAmount: parseUnits(pai.checkpoint.borrowedAmount, decimalsBorrow),
          totalCollateral: parseUnits(pai.checkpoint.totalCollateral, decimalsCollateral),
          totalDebt: parseUnits(pai.checkpoint.totalDebt, decimalsBorrow),
          countActions: pai.checkpoint.countActions ?? 0,
        });

        await facade.setActions(
          poolAdapter.address,
          pai.actions.map(x => {
            return {
              suppliedAmount: parseUnits(x.suppliedAmount, decimalsCollateral),
              borrowedAmount: parseUnits(x.borrowedAmount, decimalsBorrow),
              totalCollateral: parseUnits(x.totalCollateral, decimalsCollateral),
              totalDebt: parseUnits(x.totalDebt, decimalsBorrow),
              actionKind: x.actionKind ?? AppConstants.ACTION_KIND_BORROW_0
            }
          })
        );
      };

      await facade.setPoolAdaptersPerUser(user.address, poolAdapters.map(x => x.address));

      const tokens = p.tokens.map(x => x.address);
      const previewRet = await facade.connect(user).callStatic.previewCheckpointForUser(tokens);
      const ret = await facade.connect(user).callStatic.checkpointForUser(tokens);
      await facade.connect(user).checkpointForUser(tokens);

      return {
        actual: {
          deltaGains: ret.deltaGains.map((x, index) => +formatUnits(x, tokenDecimals[index])),
          deltaLosses: ret.deltaLosses.map((x, index) => +formatUnits(x, tokenDecimals[index])),
        },
        preview: {
          deltaGains: previewRet.deltaGains.map((x, index) => +formatUnits(x, tokenDecimals[index])),
          deltaLosses: previewRet.deltaLosses.map((x, index) => +formatUnits(x, tokenDecimals[index])),
        },
      }
    }

    describe("Normal case: 2 reverse and 2 direct pool adapters", () => {
      let results: IResults;
      let snapshotLocal0: string;
      before(async function () {
        snapshotLocal0 = await TimeUtils.snapshot();
        results = await checkpointForUser({
          tokens: [usdc, dai],
          poolAdapters: [
            { collateralAsset: usdc, borrowAsset: dai,
              actions: [{suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1000", totalDebt: "500"}],
              checkpoint: {suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1010", totalDebt: "550", countActions: 1},
              status: {totalCollateral: "1020", totalDebt: "590"} // +10, +40
            },
            { collateralAsset: usdc, borrowAsset: dai,
              actions: [{suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1000", totalDebt: "500"}],
              checkpoint: {suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1010", totalDebt: "550", countActions: 1},
              status: {totalCollateral: "1021", totalDebt: "591"} // +11, +41
            },
            { collateralAsset: dai, borrowAsset: usdc,
              actions: [{suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1000", totalDebt: "500"}],
              checkpoint: {suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1010", totalDebt: "550", countActions: 1},
              status: {totalCollateral: "1019", totalDebt: "589"} // +9, +39
            },
            { collateralAsset: dai, borrowAsset: usdc,
              actions: [{suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1000", totalDebt: "500"}],
              checkpoint: {suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1010", totalDebt: "550", countActions: 1},
              status: {totalCollateral: "1018", totalDebt: "588"} // +8, +38
            },
          ]
        });
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal0);
      });

      it("should preview expected gains", async () => {
        expect(results.preview.deltaGains.join()).eq([10 + 11, 9 + 8].join());
      });
      it("should return expected gains", async () => {
        expect(results.actual.deltaGains.join()).eq([10 + 11, 9 + 8].join());
      });
      it("should preview expected losses", async () => {
        expect(results.preview.deltaLosses.join()).eq([38 + 39, 40 + 41].join());
      });
      it("should return expected losses", async () => {
        expect(results.actual.deltaLosses.join()).eq([38 + 39, 40 + 41].join());
      });
    });
  });
//endregion Unit tests
});

