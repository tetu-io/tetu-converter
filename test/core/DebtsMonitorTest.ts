import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  Controller,
  DebtMonitor,
  DebtMonitor__factory, IPoolAdapter,
  IPoolAdapter__factory,
  MockERC20, MockERC20__factory, PoolAdapterMock,
  PoolAdapterMock__factory, PriceOracleMock, PriceOracleMock__factory, Borrower, BorrowManager, BorrowManager__factory
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {
  BorrowManagerHelper,
  IBorrowInputParams,
  MockPoolParams,
  PoolInstanceInfo
} from "../baseUT/helpers/BorrowManagerHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {CoreContracts} from "../baseUT/types/CoreContracts";

describe("DebtsMonitor", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;
  let user5: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user1 = signers[2];
    user2 = signers[3];
    user3 = signers[4];
    user4 = signers[5];
    user5 = signers[6];
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

//region Data types
  interface OldNewValue {
    initial: number;
    updated: number;
  }

  interface TestParams {
    amountCollateral: number;
    sourceDecimals: number;
    targetDecimals: number;
    amountToBorrow: number;
    priceSourceUSD: OldNewValue;
    priceTargetUSD: OldNewValue;
    collateralFactor: OldNewValue;
    countPassedBlocks: number;
    borrowRate: number; // i.e. 1e-18
  }
//endregion Data types

//region Initialization utils
  async function initializeApp(
    tt: IBorrowInputParams,
    user: string,
  ) : Promise<{
    core: CoreContracts,
    userContract: Borrower,
    sourceToken: MockERC20,
    targetToken: MockERC20,
    pools: PoolInstanceInfo[],
    poolAdapters: string[]
  }>{
    const healthFactor2 = 200;
    const periodInBlocks = 117;

    const {core, sourceToken, targetToken, pools} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(deployer
      , tt
      , async () => (await MocksHelper.createPoolAdapterMock(deployer)).address
    );
    const userContract = await MocksHelper.deployBorrower(user, core.controller, healthFactor2, periodInBlocks);
    const bmAsTc = BorrowManager__factory.connect(core.bm.address,
      await DeployerUtils.startImpersonate(core.tc.address)
    );

    const poolAdapters: string[] = [];
    for (const p of pools) {
      // we need to set up a pool adapter
      await bmAsTc.registerPoolAdapter(
        p.converter,
        userContract.address,
        sourceToken.address,
        targetToken.address
      );
      poolAdapters.push(
        await core.bm.getPoolAdapter(
          p.converter,
          userContract.address,
          sourceToken.address,
          targetToken.address
        )
      );
    }

    return {
      core,
      userContract,
      sourceToken,
      targetToken,
      pools,
      poolAdapters
    };
  }
//endregion Initialization utils

//region Test impl
  async function makeBorrow(
    userTC: string,
    pool: string,
    poolAdapterAddress: string,
    sourceToken: MockERC20,
    targetToken: MockERC20,
    amountBorrowLiquidityInPool: BigNumber,
    amountCollateral: BigNumber,
    amountToBorrow: BigNumber
  ) {
    // get data from the pool adapter
    const pa: IPoolAdapter = IPoolAdapter__factory.connect(
      poolAdapterAddress, await DeployerUtils.startImpersonate(userTC)
    );

    // prepare initial balances
    await targetToken.mint(pool, amountBorrowLiquidityInPool);
    await sourceToken.mint(userTC, amountCollateral);

    // user transfers collateral to pool adapter
    await MockERC20__factory.connect(sourceToken.address, await DeployerUtils.startImpersonate(userTC))
      .transfer(pa.address, amountCollateral);

    // borrow
    await pa.borrow(amountCollateral, amountToBorrow, userTC);
  }

  async function prepareTest(
    pp: TestParams
  ) : Promise<{
    dm: DebtMonitor,
    poolAdapterMock: PoolAdapterMock,
    sourceToken: MockERC20,
    targetToken: MockERC20,
    userTC: string,
    controller: Controller,
    pool: string
  }> {
    const user = ethers.Wallet.createRandom().address;
    const tt: IBorrowInputParams = {
      collateralFactor: pp.collateralFactor.initial,
      priceSourceUSD: pp.priceSourceUSD.initial,
      priceTargetUSD: pp.priceTargetUSD.initial,
      sourceDecimals: pp.sourceDecimals,
      targetDecimals: pp.targetDecimals,
      availablePools: [{
        borrowRateInTokens: [0, getBigNumberFrom(1e18*pp.borrowRate)],
        availableLiquidityInTokens: [0, 200_000]
      }]
    };

    const amountBorrowLiquidityInPool = getBigNumberFrom(1e10, tt.targetDecimals);

    const {core, pools, userContract, sourceToken, targetToken, poolAdapters} = await initializeApp(tt, user);
    // there is only one available pool above
    const poolAdapter = poolAdapters[0];
    const pool = pools[0].pool;

    const poolAdapterMock = await PoolAdapterMock__factory.connect(poolAdapter, deployer);

    const dm = DebtMonitor__factory.connect(await core.controller.debtMonitor(), deployer);

    await makeBorrow(
      userContract.address,
      pool,
      poolAdapterMock.address,
      sourceToken,
      targetToken,
      amountBorrowLiquidityInPool,
      getBigNumberFrom(pp.amountCollateral, tt.sourceDecimals),
      getBigNumberFrom(pp.amountToBorrow, tt.targetDecimals)
    );

    const pam: PoolAdapterMock = PoolAdapterMock__factory.connect(poolAdapterMock.address
      , deployer);
    if (pp.collateralFactor.initial != pp.collateralFactor.updated) {
      await pam.changeCollateralFactor(getBigNumberFrom(pp.collateralFactor.updated * 10, 17));
      console.log("Collateral factor is changed from", pp.collateralFactor.initial
        , "to", pp.collateralFactor.updated);
    }

    await pam.setPassedBlocks(pp.countPassedBlocks);

    const priceOracle: PriceOracleMock = PriceOracleMock__factory.connect(
      await poolAdapterMock.priceOracle()
      , deployer
    );
    await priceOracle.changePrices(
      [sourceToken.address, targetToken.address],
      [
        getBigNumberFrom(pp.priceSourceUSD.updated * 10, 17)
        , getBigNumberFrom(pp.priceTargetUSD.updated * 10, 17)
      ]
    );

    return {
      dm,
      poolAdapterMock,
      sourceToken,
      targetToken,
      userTC: userContract.address,
      controller: core.controller,
      pool
    };
  }
//endregion Test impl

//region Setup app
  async function setUpSinglePool() : Promise<{
    core: CoreContracts,
    pool: string,
    userContract: Borrower,
    sourceToken: MockERC20,
    targetToken: MockERC20,
    poolAdapter: string
  }>{
    const user = ethers.Wallet.createRandom().address;
    const targetDecimals = 12;
    const tt: IBorrowInputParams = {
      collateralFactor: 0.8,
      priceSourceUSD: 0.1,
      priceTargetUSD: 4,
      sourceDecimals: 24,
      targetDecimals: targetDecimals,
      availablePools: [
        {   // source, target
          borrowRateInTokens: [
            getBigNumberFrom(0, targetDecimals),
            getBigNumberFrom(1, targetDecimals - 6), //1e-6
          ],
          availableLiquidityInTokens: [0, 200_000_000]
        }
      ]
    };

    const r = await initializeApp(tt, user);
    return {
      core: r.core,
      pool: r.pools[0].pool,
      poolAdapter: r.poolAdapters[0],
      sourceToken: r.sourceToken,
      targetToken: r.targetToken,
      userContract: r.userContract,
    }
  }
//endregion Setup app

//region Unit tests
  describe("setThresholdAPR", () => {
    describe("Good paths", () => {
      describe("Set thresholdAPR equal to 0", () => {
        it("should set expected value", async () => {
          const r = await setUpSinglePool();
          await r.core.dm.setThresholdAPR(0);
          const ret = await r.core.dm.thresholdAPR();
          const expected = 0;
          expect(ret).equal(expected);
        });
      });
      describe("Set thresholdAPR less then 100", () => {
        it("should set expected value", async () => {
          const thresholdApr = 99;
          const r = await setUpSinglePool();
          await r.core.dm.setThresholdAPR(thresholdApr);
          const ret = await r.core.dm.thresholdAPR();
          expect(ret).equal(thresholdApr);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Set thresholdAPR equal to 100", () => {
        it("should revert", async () => {
          const thresholdApr = 100; //(!)
          const r = await setUpSinglePool();
          await expect(
            r.core.dm.setThresholdAPR(thresholdApr)
          ).revertedWith("TC-29") // INCORRECT_VALUE
        });
      });
      describe("Set thresholdAPR greater then 100 and not 0", () => {
        it("should revert", async () => {
          const thresholdApr = 101; //(!)
          const r = await setUpSinglePool();
          await expect(
            r.core.dm.setThresholdAPR(thresholdApr)
          ).revertedWith("TC-29") // INCORRECT_VALUE
        });
      });
      describe("Not governance", () => {
        it("should revert", async () => {
          const thresholdApr = 30;
          const r = await setUpSinglePool();
          const dmNotGov = await DebtMonitor__factory.connect(r.core.dm.address, user4); // (!)
          await expect(
            dmNotGov.setThresholdAPR(thresholdApr)
          ).revertedWith("TC-9") // GOVERNANCE_ONLY
        });
      });
    });
  });

  describe("setThresholdCountBlocks", () => {
    describe("Good paths", () => {
      describe("Set setThresholdCountBlocks equal to 0", () => {
        it("should set expected value", async () => {
          const r = await setUpSinglePool();
          await r.core.dm.setThresholdCountBlocks(0);
          const ret = await r.core.dm.thresholdCountBlocks();
          const expected = 0;
          expect(ret).equal(expected);
        });
      });
      describe("Set thresholdCountBlocks not 0", () => {
        it("should set expected value", async () => {
          const thresholdCountBlocks = 99;
          const r = await setUpSinglePool();
          await r.core.dm.setThresholdCountBlocks(thresholdCountBlocks);
          const ret = await r.core.dm.thresholdCountBlocks();
          expect(ret).equal(thresholdCountBlocks);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Not governance", () => {
        it("should revert", async () => {
          const thresholdCountBlocks = 30;
          const r = await setUpSinglePool();
          const dmNotGov = await DebtMonitor__factory.connect(r.core.dm.address, user4); // (!)
          await expect(
            dmNotGov.setThresholdCountBlocks(thresholdCountBlocks)
          ).revertedWith("TC-9") // GOVERNANCE_ONLY
        });
      });
    });
  });

  describe("onOpenPosition", () => {
    describe("Good paths", () => {
      describe("Open single position twice", () => {
        it("should set expected state", async () => {
          const user = ethers.Wallet.createRandom().address;
          const tt: IBorrowInputParams = {
            collateralFactor: 0.8,
            priceSourceUSD: 0.1,
            priceTargetUSD: 4,
            sourceDecimals: 12,
            targetDecimals: 24,
            availablePools: [
              {   // source, target
                borrowRateInTokens: [1, 1],
                availableLiquidityInTokens: [0, 200_000_000]
              }
            ]
          };

          const {core, userContract, sourceToken, targetToken, poolAdapters} = await initializeApp(tt, user);
          const poolAdapter = poolAdapters[0];

          const dmAsPa = DebtMonitor__factory.connect(core.dm.address
            , await DeployerUtils.startImpersonate(poolAdapter)
          );

          const poolAdapterInstance = await IPoolAdapter__factory.connect(poolAdapter, deployer);
          const config = await poolAdapterInstance.getConfig();

          const funcGetState = async function () : Promise<string> {
            const poolAdapterKey = await dmAsPa.getPoolAdapterKey(
              userContract.address,
              sourceToken.address,
              targetToken.address
            );
            const poolAdaptersLength = await dmAsPa.poolAdaptersLength(
              userContract.address,
              sourceToken.address,
              targetToken.address
            );
            const countPositions = await dmAsPa.getCountPositions();
            return [
              poolAdaptersLength,
              poolAdaptersLength.eq(0) ? "" : await dmAsPa.poolAdapters(poolAdapterKey, 0),
              !(await dmAsPa.positionLastAccess(poolAdapter)).eq(0),
              countPositions,
              countPositions.eq(0) ? "" : await dmAsPa.positions(0),
              await dmAsPa.isConverterInUse(config.originConverter),
            ].join("\n");
          }

          const before = await funcGetState();
          await dmAsPa.onOpenPosition();
          const after1 = await funcGetState();
          await dmAsPa.onOpenPosition();
          const after2 = await funcGetState();

          const ret = [
            before,
            after1,
            after2
          ].join("\n");

          const expected = [
            //before
            0, "", false, 0, "", false,
            //after1
            1, poolAdapter, true, 1, poolAdapter, true,
            //after2
            1, poolAdapter, true, 1, poolAdapter, true,
          ].join("\n");

          expect(ret).equal(expected);
        });
      });
      describe("Open two same positions in different two pools", () => {
        it("should set expected state", async () => {
          const user = ethers.Wallet.createRandom().address;
           const tt: IBorrowInputParams = {
            collateralFactor: 0.8,
            priceSourceUSD: 0.1,
            priceTargetUSD: 4,
            sourceDecimals: 12,
            targetDecimals: 24,
            availablePools: [
              {   // source, target
                borrowRateInTokens: [1, 1],
                availableLiquidityInTokens: [0, 200_000_000]
              },
              {   // source, target
                borrowRateInTokens: [1, 1],
                availableLiquidityInTokens: [0, 200_000_000]
              },
            ]
          };

          const {core, poolAdapters} = await initializeApp(tt, user);
          // there are two available pools above
          const poolAdapter1 = poolAdapters[0];
          const poolAdapter2 = poolAdapters[1];

          const dmAsPa1 = DebtMonitor__factory.connect(core.dm.address
            , await DeployerUtils.startImpersonate(poolAdapter1)
          );
          const dmAsPa2 = DebtMonitor__factory.connect(core.dm.address
            , await DeployerUtils.startImpersonate(poolAdapter2)
          );

          await dmAsPa1.onOpenPosition();
          await dmAsPa2.onOpenPosition();

          const poolAdapterInstance1 = await IPoolAdapter__factory.connect(poolAdapter1, deployer);
          const poolAdapterInstance2 = await IPoolAdapter__factory.connect(poolAdapter2, deployer);
          const config1 = await poolAdapterInstance1.getConfig();
          const config2 = await poolAdapterInstance2.getConfig();
          const poolAdapterKey = await dmAsPa1.getPoolAdapterKey(
            config1.user,
            config1.collateralAsset,
            config1.borrowAsset
          );

          const ret = [
            await dmAsPa1.poolAdaptersLength(
              config1.user,
              config1.collateralAsset,
              config1.borrowAsset
            ),
            await dmAsPa1.poolAdapters(poolAdapterKey, 0),
            await dmAsPa1.poolAdapters(poolAdapterKey, 1),

            !(await dmAsPa1.positionLastAccess(poolAdapter1)).eq(0),
            !(await dmAsPa1.positionLastAccess(poolAdapter2)).eq(0),

            await dmAsPa1.getCountPositions(),
            await dmAsPa1.positions(0),
            await dmAsPa1.positions(1),

            await dmAsPa1.isConverterInUse(config1.originConverter),
            await dmAsPa1.isConverterInUse(config2.originConverter),
          ].join("\n");

          const expected = [
            2, poolAdapter1, poolAdapter2,
            true, true,
            2, poolAdapter1, poolAdapter2,
            true, true,
          ].join("\n");

          expect(ret).equal(expected);
        });
      });
    });
  });

  describe("onClosePosition", () => {
    describe("Good paths", () => {
      describe("Single borrow, single repay", () => {
        it("should set expected state", async () => {
          const user = ethers.Wallet.createRandom().address;
          const targetDecimals = 12;
          const sourceDecimals = 24;
          const availableBorrowLiquidityNumber = 200_000_000;
          const tt: IBorrowInputParams = {
            collateralFactor: 0.8,
            priceSourceUSD: 0.1,
            priceTargetUSD: 4,
            sourceDecimals: sourceDecimals,
            targetDecimals: targetDecimals,
            availablePools: [
              {   // source, target
                borrowRateInTokens: [
                  getBigNumberFrom(0, targetDecimals),
                  getBigNumberFrom(1, targetDecimals - 6), //1e-6
                ],
                availableLiquidityInTokens: [0, availableBorrowLiquidityNumber]
              }
            ]
          };

          const {core, userContract, sourceToken, targetToken, poolAdapters} = await initializeApp(tt, user);
          const poolAdapter = poolAdapters[0];

          const dmAsPa = DebtMonitor__factory.connect(core.dm.address
            , await DeployerUtils.startImpersonate(poolAdapter)
          );

          const poolAdapterInstance = await IPoolAdapter__factory.connect(poolAdapter, deployer);
          const config = await poolAdapterInstance.getConfig();

          const funcGetState = async function() : Promise<string> {
            const poolAdapterKey = await dmAsPa.getPoolAdapterKey(
              userContract.address,
              sourceToken.address,
              targetToken.address
            );
            const poolAdaptersLength = await dmAsPa.poolAdaptersLength(
              userContract.address,
              sourceToken.address,
              targetToken.address
            );
            const countPositions = await dmAsPa.getCountPositions();
            return [
              poolAdaptersLength,
              poolAdaptersLength.eq(0) ? "" : await dmAsPa.poolAdapters(poolAdapterKey, 0),
              !(await dmAsPa.positionLastAccess(poolAdapter)).eq(0),
              countPositions,
              countPositions.eq(0) ? "" : await dmAsPa.positions(0),
              await dmAsPa.isConverterInUse(config.originConverter),
            ].join("\n");
          }

          const before = await funcGetState();
          await dmAsPa.onOpenPosition();
          const afterBorrow = await funcGetState();
          await dmAsPa.onClosePosition();
          const afterRepay = await funcGetState();

          const ret = [
            before,
            afterBorrow,
            afterRepay
          ].join("\n");

          const expected = [
            //before
            0, "", false, 0, "", false,
            //after open
            1, poolAdapter, true, 1, poolAdapter, true,
            //after close
            0, "", false, 0, "", false,
          ].join("\n");

          expect(ret).equal(expected);
        });
      });

      describe("Open N positions, close one of them", () => {
        it("should set debtMonitor to expected state", async () => {
          const countUsers = 5;
          const countConvertersPerPlatformAdapter = [1, 2, 3, 4, 5];
          const countPlatformAdapters = countConvertersPerPlatformAdapter.length;
          const countAssets = 5;

          const assets = await MocksHelper.createAssets(countAssets);

          const poolParams: MockPoolParams[] = [];
          for (let i = 0; i < countPlatformAdapters; ++i) {
            const pp: MockPoolParams = {
              assets: assets.map(x => x.address),
              cTokens: (await MocksHelper.createCTokensMocks(
                deployer,
                assets.map(x => x.address),
                assets.map(x => 18)
              )).map(x => x.address),
              pool: (await MocksHelper.createPoolStub(deployer)).address,
              converters: (
                await MocksHelper.createConverters(deployer, countConvertersPerPlatformAdapter[i])
              ).map(x => x.address),
              assetPrices: assets.map(x => getBigNumberFrom(1, 18)),
              assetLiquidityInPool: assets.map(x => getBigNumberFrom(1000, 18)),
            }
            poolParams.push(pp);
          }

          await BorrowManagerHelper.initAppWithMockPools(deployer, poolParams);

          expect.fail("TODO");
        });
      });
    });

    describe("Bad paths", () => {
      describe("Borrow position is not registered", () => {
        it("should set debtMonitor to expected state", async () => {
          expect.fail("TODO");
        });
      });
      describe("Attempt to close not empty position", () => {
        it("should set debtMonitor to expected state", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("getPositions", () => {
    describe("Good paths", () => {
      it("should TODO", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      it("should TODO", async () => {
        expect.fail("TODO");
      });
    });
  });

  describe("checkForReconversion, unhealthy", () => {
    describe("Good paths", () => {
      describe("Single borrowed token, no better borrow strategy", () => {
        describe("The token is healthy", () => {
          describe("Health factor > min", () => {
            it("should return empty", async () => {
              const index = 0;
              const count = 100; // find all pools
              const healthFactor2 = 200;
              const periodBlocks = 1000

              const pp: TestParams = {
                amountCollateral:  10_000
                , sourceDecimals: 6
                , targetDecimals: 24
                , amountToBorrow: 1000
                , priceSourceUSD: {initial: 1, updated: 1}
                , priceTargetUSD: {initial: 2, updated: 2}
                , collateralFactor: {initial: 0.5, updated: 0.5}
                , countPassedBlocks: 0 // no debts
                , borrowRate: 1e-10
              }
              const {dm, poolAdapterMock, controller} = await prepareTest(pp);

              const currentHealthFactor18 = (await poolAdapterMock.getStatus()).healthFactor18;
              const minAllowedHealthFactor2 = currentHealthFactor18
                .div(2)
                .div(getBigNumberFrom(1, 18-2))
                .toNumber();
              await controller.setMinHealthFactor2(minAllowedHealthFactor2);

              const expectedHealthFactor =
                pp.collateralFactor.updated
                * pp.priceSourceUSD.updated * pp.amountCollateral
                / (pp.priceTargetUSD.updated * pp.amountToBorrow + pp.borrowRate * pp.countPassedBlocks);
              console.log("Expected healthy factor", expectedHealthFactor);

              const ret = await dm.checkForReconversion(index, count, count, healthFactor2, periodBlocks);

              const sret = [
                ret.nextIndexToCheck0.toNumber(),
                ret.outPoolAdapters.length,
                ret.outPoolAdapters,
                expectedHealthFactor > minAllowedHealthFactor2 / 100
              ].join();

              const sexpected = [
                0,
                0,
                [],
                true
              ].join();

              expect(sret).equal(sexpected);
            });
          });
          describe("Health factor == min", () => {
            it("should return empty", async () => {
              const index = 0;
              const count = 100; // find all pools

              const pp: TestParams = {
                amountCollateral:  10_000
                , sourceDecimals: 6
                , targetDecimals: 24
                , amountToBorrow: 1000
                , priceSourceUSD: {initial: 1, updated: 1}
                , priceTargetUSD: {initial: 2, updated: 2}
                , collateralFactor: {initial: 0.5, updated: 0.5}
                , countPassedBlocks: 0 // no debts
                , borrowRate: 1e-10
              }
              const {dm, poolAdapterMock, controller} = await prepareTest(pp);

              const currentHealthFactor18 = (await poolAdapterMock.getStatus()).healthFactor18;
              const minAllowedHealthFactor2 = currentHealthFactor18
                .div(getBigNumberFrom(1, 18-2))
                .toNumber();
              await controller.setMinHealthFactor2(minAllowedHealthFactor2);

              const dummyHealthFactor2 = minAllowedHealthFactor2 * 10;
              const dummyPeriodBlocks = 1000;

              const expectedHealthFactor =
                pp.collateralFactor.updated
                * pp.priceSourceUSD.updated * pp.amountCollateral
                / (pp.priceTargetUSD.updated * pp.amountToBorrow + pp.borrowRate * pp.countPassedBlocks);
              console.log("Expected healthy factor", expectedHealthFactor);

              const ret = await dm.checkForReconversion(index, count, count
                , dummyHealthFactor2
                , dummyPeriodBlocks
              );

              const sret = [
                ret.nextIndexToCheck0.toNumber(),
                ret.outPoolAdapters.length,
                ret.outPoolAdapters,
                expectedHealthFactor == minAllowedHealthFactor2 / 100
              ].join();

              const sexpected = [
                0,
                0,
                [],
                true
              ].join();

              expect(sret).equal(sexpected);
            });
          });
        });
        describe("The token is unhealthy", () => {
          describe("Collateral factor is too high", () => {
            it("should return the token", async () => {
              const index = 0;
              const count = 100; // find all pools
              const healthFactor2 = 250;
              const periodBlocks = 1000

              const pp: TestParams = {
                amountCollateral:  10_000
                , sourceDecimals: 6
                , targetDecimals: 24
                , amountToBorrow: 1000
                , priceSourceUSD: {initial: 1, updated: 1}
                , priceTargetUSD: {initial: 2, updated: 2}
                , collateralFactor: {
                  initial: 0.5
                  , updated: 0.5
                }
                , countPassedBlocks: 0 // no debts
                , borrowRate: 1e-10
              }
              const {dm, poolAdapterMock, controller} = await prepareTest(pp);

              const currentHealthFactor18 = (await poolAdapterMock.getStatus()).healthFactor18;
              const minAllowedHealthFactor2 = currentHealthFactor18
                .mul(2)
                .div(getBigNumberFrom(1, 18-2))
                .toNumber();
              await controller.setMinHealthFactor2(minAllowedHealthFactor2);

              const expectedHealthFactor =
                pp.collateralFactor.updated
                * pp.priceSourceUSD.updated * pp.amountCollateral
                / (pp.priceTargetUSD.updated * pp.amountToBorrow + pp.borrowRate * pp.countPassedBlocks);
              console.log("Expected healthy factor", expectedHealthFactor);

              const ret = await dm.checkForReconversion(index, count, count, healthFactor2, periodBlocks);

              const sret = [
                ret.nextIndexToCheck0.toNumber(),
                ret.outPoolAdapters.length,
                ret.outPoolAdapters,
                expectedHealthFactor < minAllowedHealthFactor2 / 100
              ].join();

              const sexpected = [
                0,
                1,
                [poolAdapterMock.address],
                true
              ].join();

              expect(sret).equal(sexpected);
            });
          });
          describe("Collateral is too cheap", () => {
            it("should return the token", async () => {
              expect.fail("TODO");
            });
          });
          describe("Borrowed token is too expensive", () => {
            it("should return the token", async () => {
              expect.fail("TODO");
            });
          });
          describe("Debt is too high", () => {
            it("should return the token", async () => {
              expect.fail("TODO");
            });
          });
        });
      });
      describe("Multiple borrowed tokens", () => {
        describe("All tokens are healthy", () => {
          describe("Tokens have different decimals", () => {
            it("should return empty", async () => {
              expect.fail("TODO");
            });
          });
        });
        describe("All tokens are unhealthy", () => {
          describe("Tokens have different decimals", () => {
            it("should return all tokens", async () => {
              expect.fail("TODO");
            });
          });
        });
        describe("First token is unhealthy", () => {
          it("should return first token only", async () => {
            expect.fail("TODO");
          });
        });
        describe("Last token is unhealthy", () => {
          it("should return last token only", async () => {
            expect.fail("TODO");
          });
        });
      });
    });
    describe("Bad paths", () => {
      describe("Unknown pool adapter", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
      describe("Price oracle returns zero price", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("checkForReconversion, healthy, better borrow way exists", () => {
    describe("Good paths", () => {
      describe("Threshold APR enabled", () => {
        describe("Threshold count blocks enabled", () => {
          it("should return empty", async () => {
            expect.fail("TODO");
          });
        });
        describe("Threshold count blocks disabled", () => {
          it("should return empty", async () => {
            expect.fail("TODO");
          });
        });
      });

    });
    describe("Bad paths", () =>{

    });
  });

  describe("getPoolAdapterKey", () => {
    describe("Good paths", () => {
      describe("All pool adapters are in good state", () => {
        it("should return no pool adapters ", async () => {
          expect.fail("TODO");
        });
      });
      describe("Single unhealthy PA", () => {
        describe("Single unhealthy borrowed token", () => {
          it("should TODO", async () => {
            expect.fail("TODO");
          });
        });
        describe("Multiple unhealthy borrowed tokens", () => {
          describe("Multiple calls of findFirst", () => {
            it("should return all unhealthy pool adapters", async () => {
              expect.fail("TODO");
            });
          });
        });
      });

      describe("First pool adapter is unhealthy", () => {
        it("should TODO", async () => {
          expect.fail("TODO");
        });
      });
      describe("Last pool adapter is unhealthy", () => {
        it("should TODO", async () => {
          expect.fail("TODO");
        });
      });

    });
    describe("Bad paths", () => {
      it("should TODO", async () => {
        expect.fail("TODO");
      });
    });
  });

  describe("getCountPositions", () => {
    describe("Good paths", () => {
      it("should TODO", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      it("should TODO", async () => {
        expect.fail("TODO");
      });
    });
  });
//endregion Unit tests

});