import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BookkeeperLibFacade, DebtMonitorMock, MockERC20, PoolAdapterMock2} from "../../typechain";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {MocksHelper} from "../baseUT/app/MocksHelper";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {expect} from "chai";
import {AppConstants} from "../baseUT/types/AppConstants";
import {Misc} from "../../scripts/utils/Misc";

describe("BookkeeperLibTest", () => {
//region Global vars for all tests
  let snapshotRoot: string;
  let signer: SignerWithAddress;
  let facade: BookkeeperLibFacade;
  let usdc: MockERC20;
  let usdt: MockERC20;
  let dai: MockERC20;
  let defaultPoolAdapter: PoolAdapterMock2;
  let debtMonitor: DebtMonitorMock;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

    snapshotRoot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];
    facade = await DeployUtils.deployContract(signer, "BookkeeperLibFacade") as BookkeeperLibFacade;

    usdc = await MocksHelper.createMockedToken(signer, "usdc", 6);
    usdt = await MocksHelper.createMockedToken(signer, "usdt", 6);
    dai = await MocksHelper.createMockedToken(signer, "dai", 18);

    defaultPoolAdapter = await DeployUtils.deployContract(signer, "PoolAdapterMock2") as PoolAdapterMock2;
    debtMonitor = await MocksHelper.createDebtMonitorMock(signer);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotRoot);
  });
//endregion before, after

//region Data types
  interface IAction {
    actionKind?: number; // ACTION_KIND_BORROW_0 by default
    suppliedAmount: string;
    borrowedAmount: string;
    gain?: string;
    loss?: string;
    prices?: string[]; // "1" by default
  }
//endregion Data types

//region Unit tests
  describe("checkpointForPoolAdapter", () => {
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

      // set up base state of the Bookkeeper

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
            actionKind: x.actionKind ?? AppConstants.ACTION_KIND_BORROW_0
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

    describe("() => checkpoint", () => {
      let snapshotLocal0: string;
      let ret: IResults;
      before(async function () {
        snapshotLocal0 = await TimeUtils.snapshot();
        ret = await checkout({
          actions: [{suppliedAmount: "1000", borrowedAmount: "500", }],
          checkpoint: {suppliedAmount: "0", borrowedAmount: "0", totalCollateral: "0", totalDebt: "0", countActions: 0},
          poolAdapter: {totalCollateral: "1010", totalDebt: "550"},
        });
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal0);
      });

      it("should return expected deltas", async () => {
        expect(ret.deltaGain).eq(0);
        expect(ret.deltaLoss).eq(0);
      });
      it("should setup expected checkpoint values", async () => {
        expect(ret.totalDebt).eq(550);
        expect(ret.totalCollateral).eq(1010);
        expect(ret.borrowedAmount).eq(500);
        expect(ret.suppliedAmount).eq(1000);
      });
    });
    describe("checkpoint => checkpoint", () => {
      let snapshotLocal0: string;
      let ret: IResults;
      before(async function () {
        snapshotLocal0 = await TimeUtils.snapshot();
        ret = await checkout({
          actions: [{suppliedAmount: "1000", borrowedAmount: "500", }],
          checkpoint: {suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1000", totalDebt: "500", countActions: 1},
          poolAdapter: {totalCollateral: "1010", totalDebt: "550"},
        });
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal0);
      });

      it("should return expected deltas", async () => {
        expect(ret.deltaGain).eq(10);
        expect(ret.deltaLoss).eq(50);
      });
      it("should setup expected checkpoint values", async () => {
        expect(ret.totalDebt).eq(550);
        expect(ret.totalCollateral).eq(1010);
        expect(ret.borrowedAmount).eq(500);
        expect(ret.suppliedAmount).eq(1000);
      });
    });
    describe("checkpoint => action => checkpoint", () => {
      let snapshotLocal0: string;
      let ret: IResults;
      before(async function () {
        snapshotLocal0 = await TimeUtils.snapshot();
        ret = await checkout({
          checkpoint: {suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1000", totalDebt: "500"},
          actions: [{suppliedAmount: "1500", borrowedAmount: "750", }],
          poolAdapter: {totalCollateral: "1512", totalDebt: "780"},
        });
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal0);
      });

      it("should return expected deltas", async () => {
        expect(ret.deltaGain).eq(0);
        expect(ret.deltaLoss).eq(0);
      });
      it("should setup expected checkpoint values", async () => {
        expect(ret.totalDebt).eq(780);
        expect(ret.totalCollateral).eq(1512);
        expect(ret.borrowedAmount).eq(750);
        expect(ret.suppliedAmount).eq(1500);
      });
    });
  });

  describe("checkpointForUser and previewCheckpointForUser" , () => {
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

        // set up base state of the Bookkeeper
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
              actions: [{suppliedAmount: "1000", borrowedAmount: "500", }],
              checkpoint: {suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1010", totalDebt: "550", countActions: 1},
              status: {totalCollateral: "1020", totalDebt: "590"} // +10, +40
            },
            { collateralAsset: usdc, borrowAsset: dai,
              actions: [{suppliedAmount: "1000", borrowedAmount: "500", }],
              checkpoint: {suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1010", totalDebt: "550", countActions: 1},
              status: {totalCollateral: "1021", totalDebt: "591"} // +11, +41
            },
            { collateralAsset: dai, borrowAsset: usdc,
              actions: [{suppliedAmount: "1000", borrowedAmount: "500", }],
              checkpoint: {suppliedAmount: "1000", borrowedAmount: "500", totalCollateral: "1010", totalDebt: "550", countActions: 1},
              status: {totalCollateral: "1019", totalDebt: "589"} // +9, +39
            },
            { collateralAsset: dai, borrowAsset: usdc,
              actions: [{suppliedAmount: "1000", borrowedAmount: "500", }],
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

  describe("onHardwork", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface IParams {
      collateralAsset?: MockERC20; // DAI by default
      borrowAsset?: MockERC20; // USDT by default
      isCollateralUnderlying?: boolean; // true by default

      actions: IAction[];
      periods: number[];
    }

    interface IResults {
      gains: number;
      loss: number;
      countActions: number;
    }

    async function onHardwork(p: IParams): Promise<IResults> {
      const poolAdapter = defaultPoolAdapter;
      const collateralAsset = p.collateralAsset ?? dai;
      const borrowAsset = p.borrowAsset ?? usdt;

      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();
      const decimalsUnderlying = (p.isCollateralUnderlying ?? true)
        ? decimalsCollateral
        : decimalsBorrow;

      // set up base state of the Bookkeeper
      await facade.setActionsWithRepayInfo(
        poolAdapter.address,
        p.actions.map(x => {
          return {
            suppliedAmount: parseUnits(x.suppliedAmount, decimalsCollateral),
            borrowedAmount: parseUnits(x.borrowedAmount, decimalsBorrow),
            actionKind: x.actionKind ?? AppConstants.ACTION_KIND_BORROW_0
          }
        }),
        p.actions.map(x => {
          return {
            gain: parseUnits(x.gain || "0", decimalsCollateral),
            loss: parseUnits(x.loss || "0", decimalsBorrow),
            prices: [
              parseUnits(x.prices ? x.prices[0] : "0", 18),
              parseUnits(x.prices ? x.prices[1] : "0", 18),
            ]
          }
        }),
      );
      await facade.setPeriods(poolAdapter.address, p.periods);

      const decs = [
        parseUnits("1", decimalsCollateral),
        parseUnits("1", decimalsBorrow),
      ];
      const ret = await facade.onHardwork(poolAdapter.address, p.isCollateralUnderlying ?? true, decs);

      return {
        gains: +formatUnits(ret.gains, decimalsUnderlying),
        loss: +formatUnits(ret.loss, decimalsUnderlying),
        countActions: ret.countActions.toNumber()
      }
    }

    describe("collateral is underlying", () => {
      describe("prices are equal", () => {
        describe("first period", () => {
          it("should return expected values if the period has repay-actions", async () => {
            const ret = await onHardwork({
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50",},
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "50",
                  borrowedAmount: "25",
                  loss: "13",
                  gain: "7",
                  prices: ["1", "1"]
                },
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "0",
                  borrowedAmount: "0",
                  loss: "17",
                  gain: "11",
                  prices: ["1", "1"]
                },
              ],
              periods: [],
              isCollateralUnderlying: true
            });
            expect(ret.loss).eq(30);
            expect(ret.gains).eq(18);
            expect(ret.countActions).eq(3);
          });
          it("should return expected values if the period doesn't have repay-actions", async () => {
            const ret = await onHardwork({
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50",},
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "200", borrowedAmount: "100",},
              ],
              periods: []
            });
            expect(ret.loss).eq(0);
            expect(ret.gains).eq(0);
            expect(ret.countActions).eq(2);
          });
          it("should return expected values if the period was empty", async () => {
            const ret = await onHardwork({
              actions: [],
              periods: []
            });
            expect(ret.loss).eq(0);
            expect(ret.gains).eq(0);
            expect(ret.countActions).eq(0);
          });
        });
        describe("second period", () => {
          it("should return expected values if the period has repay-actions", async () => {
            const ret = await onHardwork({
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50",},
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "50",
                  borrowedAmount: "25",
                  loss: "13",
                  gain: "7",
                  prices: ["1", "1"]
                },
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "0",
                  borrowedAmount: "0",
                  loss: "17",
                  gain: "11",
                  prices: ["1", "1"]
                },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50",},
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "50",
                  borrowedAmount: "25",
                  loss: "13",
                  gain: "7",
                  prices: ["1", "1"]
                },
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "0",
                  borrowedAmount: "0",
                  loss: "17",
                  gain: "11",
                  prices: ["1", "1"]
                },
              ],
              periods: [3],
              isCollateralUnderlying: true
            });
            expect(ret.loss).eq(30);
            expect(ret.gains).eq(18);
            expect(ret.countActions).eq(6);
          });
          it("should return expected values if the period doesn't have repay-actions", async () => {
            const ret = await onHardwork({
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50",},
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "50",
                  borrowedAmount: "25",
                  loss: "13",
                  gain: "7",
                  prices: ["1", "1"]
                },
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "0",
                  borrowedAmount: "0",
                  loss: "17",
                  gain: "11",
                  prices: ["1", "1"]
                },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50",},
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "200", borrowedAmount: "100",},
              ],
              periods: [3]
            });
            expect(ret.loss).eq(0);
            expect(ret.gains).eq(0);
            expect(ret.countActions).eq(5);
          });
          it("should return expected values if the period was empty", async () => {
            const ret = await onHardwork({
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50",},
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "50",
                  borrowedAmount: "25",
                  loss: "13",
                  gain: "7",
                  prices: ["1", "1"]
                },
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "0",
                  borrowedAmount: "0",
                  loss: "17",
                  gain: "11",
                  prices: ["1", "1"]
                },
              ],
              periods: [3]
            });
            expect(ret.loss).eq(0);
            expect(ret.gains).eq(0);
            expect(ret.countActions).eq(3);
          });
        });
      });
      describe("prices are different", () => {
        describe("second period", () => {
          it("should return expected values if the period has repay-actions", async () => {
            const ret = await onHardwork({
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50",},
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", loss: "13", gain: "7",},
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "0", borrowedAmount: "0", loss: "17", gain: "11", },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50",},
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "50",
                  borrowedAmount: "25",
                  gain: "7",
                  loss: "13",
                  prices: ["0.5", "2"]
                },
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "0",
                  borrowedAmount: "0",
                  gain: "11",
                  loss: "17",
                  prices: ["2", "0.5"]
                },
              ],
              periods: [3],
              isCollateralUnderlying: true
            });

            expect(ret.gains).eq(7 + 11);
            expect(ret.loss).eq(13*2/0.5 + 17*0.5/2);
            expect(ret.countActions).eq(6);
          });
        });
      });
    });
    describe("borrow asset is underlying", () => {
      describe("prices are different", () => {
        describe("second period", () => {
          it("should return expected values if the period has repay-actions", async () => {
            const ret = await onHardwork({
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50",},
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", loss: "13", gain: "7",},
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "0", borrowedAmount: "0", loss: "17", gain: "11", },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50",},
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "50",
                  borrowedAmount: "25",
                  gain: "7",
                  loss: "13",
                  prices: ["0.5", "2"]
                },
                {
                  actionKind: AppConstants.ACTION_KIND_REPAY_1,
                  suppliedAmount: "0",
                  borrowedAmount: "0",
                  gain: "11",
                  loss: "17",
                  prices: ["2", "0.5"]
                },
              ],
              periods: [3],
              isCollateralUnderlying: false
            });

            expect(ret.gains).eq(7/2*0.5 + 11/0.5*2);
            expect(ret.loss).eq(13 + 17);
            expect(ret.countActions).eq(6);
          });
        });
      });
    });
  });

  describe("startPeriod, previewPeriod", () => {
    interface IPoolAdapterData {
      collateralAsset?: MockERC20; // DAI by default
      borrowAsset?: MockERC20; // USDT by default
      actions: IAction[];
      periods: number[];
      openedAtTheEnd?: boolean; // true by default
    }

    interface IParams {
      underlying?: MockERC20; // DAI by default
      poolAdapters: IPoolAdapterData[];
    }

    interface IResults {
      gains: number;
      losses: number;
      inSet: boolean[];
      lastPeriodValues: number[];
      previewGains: number;
      previewLosses: number;
    }

    async function startPeriod(p: IParams): Promise<IResults> {
      const user = ethers.Wallet.createRandom().address;
      const underlying = p.underlying ?? dai;
      const decimalsUnderlying = await underlying.decimals();
      const poolAdapters: PoolAdapterMock2[] = [];

      for (let i = 0; i < p.poolAdapters.length; ++i) {
        const poolAdapter = i === 0
          ? defaultPoolAdapter
          : await DeployUtils.deployContract(signer, "PoolAdapterMock2") as PoolAdapterMock2;
        poolAdapters.push(poolAdapter);

        const data = p.poolAdapters[i];
        const collateralAsset = data.collateralAsset ?? dai;
        const borrowAsset = data.borrowAsset ?? usdt;

        const decimalsCollateral = await collateralAsset.decimals();
        const decimalsBorrow = await borrowAsset.decimals();

        // set up base state of the Bookkeeper
        await facade.setActionsWithRepayInfo(
          poolAdapter.address,
          data.actions.map(x => {
            return {
              suppliedAmount: parseUnits(x.suppliedAmount, decimalsCollateral),
              borrowedAmount: parseUnits(x.borrowedAmount, decimalsBorrow),
              actionKind: x.actionKind ?? AppConstants.ACTION_KIND_BORROW_0
            }
          }),
          data.actions.map(x => {
            return {
              gain: parseUnits(x.gain || "0", decimalsCollateral),
              loss: parseUnits(x.loss || "0", decimalsBorrow),
              prices: [
                parseUnits(x.prices ? x.prices[0] : "0", 18),
                parseUnits(x.prices ? x.prices[1] : "0", 18),
              ]
            }
          }),
        );
        await facade.setPeriods(poolAdapter.address, data.periods);

        await poolAdapter.setConfig(
          ethers.Wallet.createRandom().address,
          user,
          collateralAsset.address,
          borrowAsset.address
        );

        await debtMonitor.setOpenPosition(poolAdapter.address, data.openedAtTheEnd ?? true);
      }
      await facade.setPoolAdaptersPerUser(user, poolAdapters.map(x => x.address));

      const preview = await facade.previewPeriod(user, underlying.address);

      const ret = await facade.callStatic.startPeriod(debtMonitor.address, user, underlying.address);
      await facade.startPeriod(debtMonitor.address, user, underlying.address);

      return {
        gains: +formatUnits(ret.gains, decimalsUnderlying),
        losses: +formatUnits(ret.losses, decimalsUnderlying),
        inSet: await Promise.all(poolAdapters.map(
          async x => facade.poolAdaptersPerUserContains(user, x.address)
        )),
        lastPeriodValues: await Promise.all(poolAdapters.map(
          async x => (await facade.lastPeriodValue(x.address)).toNumber()
        )),
        previewGains: +formatUnits(preview.gains, decimalsUnderlying),
        previewLosses: +formatUnits(preview.losses, decimalsUnderlying),
      }
    }

    describe("Direct debt, keep position opened", () => {
      let snapshotLocal: string;
      let ret: IResults;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
        ret = await startPeriod({
          underlying: dai,
          poolAdapters: [
            {
              collateralAsset: dai,
              borrowAsset: usdt,
              openedAtTheEnd: true,
              periods: [1],
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50", },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", loss: "5", gain: "2", prices: ["1", "1"] },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50", },
              ]
            }
          ]
        })
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      it("should return expected gain and loss", async () => {
        expect([ret.gains, ret.losses].join()).eq([2, 5].join());
      });
      it("should keep the pool adapter in the set of the user", async () => {
        expect(ret.inSet.join()).eq([true].join());
      });
      it("should add expected value to periods array", async () => {
        expect(ret.lastPeriodValues.join()).eq([3].join());
      });
      it("should return values same to preview values", async () => {
        expect([ret.gains, ret.losses].join()).eq([ret.previewGains, ret.previewLosses].join());
      });
    });
    describe("Reverse debt, close position", () => {
      let snapshotLocal: string;
      let ret: IResults;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
        ret = await startPeriod({
          underlying: usdt,
          poolAdapters: [
            {
              collateralAsset: dai,
              borrowAsset: usdt,
              openedAtTheEnd: false,
              periods: [1],
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50", },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", gain: "2", loss: "5", prices: ["1", "1"] },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", gain: "1", loss: "3", prices: ["1", "1"] },
              ]
            }
          ]
        })
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      it("should return expected gain and loss", async () => {
        expect([ret.gains, ret.losses].join()).eq([3, 8].join());
      });
      it("should keep the pool adapter in the set of the user", async () => {
        expect(ret.inSet.join()).eq([false].join());
      });
      it("should add expected value to periods array", async () => {
        expect(ret.lastPeriodValues.join()).eq([3].join());
      });
      it("should return values same to preview values", async () => {
        expect([ret.gains, ret.losses].join()).eq([ret.previewGains, ret.previewLosses].join());
      });
    });
    describe("Direct and reverse debts, remove all", () => {
      let snapshotLocal: string;
      let ret: IResults;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
        ret = await startPeriod({
          underlying: dai,
          poolAdapters: [
            {
              collateralAsset: dai,
              borrowAsset: usdt,
              openedAtTheEnd: false,
              periods: [1, 2],
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "50", borrowedAmount: "25", },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50", },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", gain: "2", loss: "5", prices: ["1", "1"] },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50", },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "0", borrowedAmount: "0", gain: "3", loss: "7", prices: ["1", "1"] },
              ]
            },
            {
              collateralAsset: usdt,
              borrowAsset: dai,
              openedAtTheEnd: false,
              periods: [],
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50", },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", gain: "2", loss: "5", prices: ["1", "1"] },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", gain: "1", loss: "3", prices: ["1", "1"] },
              ]
            }
          ]
        })
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      it("should return expected gain and loss", async () => {
        expect([ret.gains, ret.losses].join()).eq([8, 20].join());
      });
      it("should keep the pool adapter in the set of the user", async () => {
        expect(ret.inSet.join()).eq([false, false].join());
      });
      it("should add expected value to periods array", async () => {
        expect(ret.lastPeriodValues.join()).eq([5, 3].join());
      });
      it("should return values same to preview values", async () => {
        expect([ret.gains, ret.losses].join()).eq([ret.previewGains, ret.previewLosses].join());
      });
    });
    describe("Direct and reverse debts, remove one", () => {
      let snapshotLocal: string;
      let ret: IResults;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
        ret = await startPeriod({
          underlying: dai,
          poolAdapters: [
            {
              collateralAsset: dai,
              borrowAsset: usdt,
              openedAtTheEnd: true,
              periods: [1, 2],
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "50", borrowedAmount: "25", },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50", },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", gain: "2", loss: "5", prices: ["1", "1"] },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50", },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "2", borrowedAmount: "1", gain: "3", loss: "7", prices: ["1", "1"] },
              ]
            },
            {
              collateralAsset: dai,
              borrowAsset: usdt,
              openedAtTheEnd: false,
              periods: [1, 2, 3, 4],
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "5", borrowedAmount: "25", },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "0", borrowedAmount: "0", gain: "2", loss: "5", prices: ["1", "1"] },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "50", borrowedAmount: "25", },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "0", borrowedAmount: "0", gain: "2", loss: "5", prices: ["1", "1"] },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50", },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", gain: "1", loss: "2", prices: ["1", "1"] },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50", },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "0", borrowedAmount: "0", gain: "2", loss: "9", prices: ["1", "1"] },
              ]
            },
            {
              collateralAsset: usdt,
              borrowAsset: dai,
              openedAtTheEnd: true,
              periods: [3],
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "1", borrowedAmount: "2", },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "3", borrowedAmount: "4", },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50", },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", gain: "2", loss: "5", prices: ["1", "1"] },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", gain: "4", loss: "3", prices: ["1", "1"] },
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50", },
              ]
            },
            {
              collateralAsset: usdt,
              borrowAsset: dai,
              openedAtTheEnd: true,
              periods: [],
              actions: [
                {actionKind: AppConstants.ACTION_KIND_BORROW_0, suppliedAmount: "100", borrowedAmount: "50", },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", gain: "2", loss: "5", prices: ["1", "1"] },
                {actionKind: AppConstants.ACTION_KIND_REPAY_1, suppliedAmount: "50", borrowedAmount: "25", gain: "2", loss: "4", prices: ["1", "1"] },
              ]
            },
          ]
        })
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      it("should return expected gain and loss", async () => {
        expect([ret.gains, ret.losses].join()).eq([5 + 3 + 6 + 4, 12 + 11 + 8 + 9].join());
      });
      it("should keep the pool adapter in the set of the user", async () => {
        expect(ret.inSet.join()).eq([true, false, true, true].join());
      });
      it("should add expected value to periods array", async () => {
        expect(ret.lastPeriodValues.join()).eq([5, 8, 6, 3].join());
      });
      it("should return values same to preview values", async () => {
        expect([ret.gains, ret.losses].join()).eq([ret.previewGains, ret.previewLosses].join());
      });
    });

  });
//endregion Unit tests
});

