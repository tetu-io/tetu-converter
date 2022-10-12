import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  Controller,
  DebtMonitor,
  DebtMonitor__factory,
  IPoolAdapter,
  IPoolAdapter__factory,
  MockERC20,
  MockERC20__factory,
  PoolAdapterMock,
  PoolAdapterMock__factory,
  PriceOracleMock,
  PriceOracleMock__factory,
  Borrower,
  BorrowManager__factory,
  PoolAdapterStub, PoolAdapterStub__factory
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {
  BorrowManagerHelper,
  IBorrowInputParams, IBorrowInputParamsBasic,
  IMockPoolParams, IPoolInfo,
  IPoolInstanceInfo
} from "../baseUT/helpers/BorrowManagerHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {CoreContracts} from "../baseUT/types/CoreContracts";
import {generateAssetPairs} from "../baseUT/utils/AssetPairUtils";
import {resolveProjectPaths} from "hardhat/internal/core/config/config-resolution";

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
  interface IOldNewValue {
    initial: number;
    updated: number;
  }

  interface IAssetsDecimalsInfo {
    sourceDecimals: number;
    targetDecimals: number;
  }

  interface IAssetsPricesInfo {
    priceSourceUSD: IOldNewValue;
    priceTargetUSD: IOldNewValue;
  }

  interface IAssetsAmounts {
    amountToBorrow: number;
    amountCollateral: number;
  }

  interface ISinglePoolAdapterTestParams extends IAssetsDecimalsInfo, IAssetsPricesInfo, IAssetsAmounts {
    collateralFactor: IOldNewValue;
    countPassedBlocks: number;
    borrowRate: number; // i.e. 1e-18
  }

  interface IPoolAdapterConfig {
    originConverter: string;
    user: string;
    collateralAsset: string;
    borrowAsset: string;
  }

  interface IMultiplePoolAdaptersTestParams extends IAssetsDecimalsInfo {
    priceSourceUSD: number;
    priceTargetUSD: number;

    /// for simplicity, all pool adapters have same collateral factors; we can change it later if necessary
    collateralFactor: number;
    countPassedBlocks: number;
  }

  interface IPoolInfoForBorrowOnly {
    borrowRateInTokens: number | BigNumber,
    availableLiquidityInTokens: number
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
    pools: IPoolInstanceInfo[],
    poolAdapters: string[]
  }>{
    const healthFactor2 = 200;
    const periodInBlocks = 117;

    const {core, sourceToken, targetToken, pools} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(deployer
      , tt
      , async () => (await MocksHelper.createPoolAdapterMock(deployer)).address
    );
    const userContract = await MocksHelper.deployBorrower(user, core.controller, periodInBlocks);
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

  async function prepareSinglePoolAdapterHealthTest(
    pp: ISinglePoolAdapterTestParams
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
        borrowRateInTokens: [0, getBigNumberFrom(pp.borrowRate)],
        availableLiquidityInTokens: [0, 500_000]
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

    const pam: PoolAdapterMock = PoolAdapterMock__factory.connect(poolAdapterMock.address, deployer);
    console.log(await pam.getStatus());
    if (pp.collateralFactor.initial !== pp.collateralFactor.updated) {
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

  async function prepareMultiplePoolAdaptersHealthTest(
    pp: IMultiplePoolAdaptersTestParams,
    poolsInfo: IPoolInfoForBorrowOnly[],
    amounts: IAssetsAmounts[]
  ) : Promise<{
    dm: DebtMonitor,
    sourceToken: MockERC20,
    targetToken: MockERC20,
    userTC: string,
    controller: Controller,
    poolAdapterMocks: PoolAdapterMock[],
    pools: string[]
  }> {
    const user = ethers.Wallet.createRandom().address;
    const tt: IBorrowInputParams = {
      collateralFactor: pp.collateralFactor,
      priceSourceUSD: pp.priceSourceUSD,
      priceTargetUSD: pp.priceTargetUSD,
      sourceDecimals: pp.sourceDecimals,
      targetDecimals: pp.targetDecimals,
      availablePools: poolsInfo.map(x => ({
        borrowRateInTokens: [0, x.borrowRateInTokens],
        availableLiquidityInTokens: [0, x.availableLiquidityInTokens]
      }))
    };

    const {core, pools, userContract, sourceToken, targetToken, poolAdapters} = await initializeApp(tt, user);
    const dm = DebtMonitor__factory.connect(await core.controller.debtMonitor(), deployer);

    const poolAdapterMocks: PoolAdapterMock[] = [];
    for (let i = 0; i < pools.length; ++i) {
      const poolAdapter = poolAdapters[i];
      const pool = pools[i].pool;

      const amountBorrowLiquidityInPool = getBigNumberFrom(1e10, tt.targetDecimals);
      const poolAdapterMock = await PoolAdapterMock__factory.connect(poolAdapter, deployer);

      await makeBorrow(
        userContract.address,
        pool,
        poolAdapterMock.address,
        sourceToken,
        targetToken,
        amountBorrowLiquidityInPool,
        getBigNumberFrom(amounts[i].amountCollateral, tt.sourceDecimals),
        getBigNumberFrom(amounts[i].amountToBorrow, tt.targetDecimals)
      );

      poolAdapterMocks.push(PoolAdapterMock__factory.connect(poolAdapterMock.address, deployer));
    }
    return {
      dm,
      sourceToken,
      targetToken,
      userTC: userContract.address,
      controller: core.controller,
      poolAdapterMocks,
      pools: pools.map(x => x.pool)
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

//region Utils for onClosePosition
  /**
   * Create pool adapters, register them and open all possible positions
   */
  async function preparePoolAdapters(
    countConvertersPerPlatformAdapter: number[],
    countUsers: number = 2,
    countAssets: number = 2
  ) : Promise<{poolAdapters: string[], core: CoreContracts}>{
    const assets = await MocksHelper.createAssets(countAssets);
    const users = [...Array(countUsers).keys()].map(x => ethers.Wallet.createRandom().address);

    // prepare platform adapters and available assets and converters
    const poolParams: IMockPoolParams[] = [];
    for (const item of countConvertersPerPlatformAdapter) {
      const pp: IMockPoolParams = {
        assets: assets.map(x => x.address),
        cTokens: (await MocksHelper.createCTokensMocks(
          deployer,
          assets.map(x => x.address),
          assets.map(x => 18)
        )).map(x => x.address),
        pool: (await MocksHelper.createPoolStub(deployer)).address,
        converters: (
          await MocksHelper.createConverters(deployer, item)
        ).map(x => x.address),
        assetPrices: assets.map(x => getBigNumberFrom(1, 18)),
        assetLiquidityInPool: assets.map(x => getBigNumberFrom(1000, 18)),
      }
      poolParams.push(pp);
    }

    // initialize the app
    const r = await BorrowManagerHelper.initAppWithMockPools(deployer, poolParams);
    const bmAsTc = BorrowManager__factory.connect(
      r.core.bm.address,
      await DeployerUtils.startImpersonate(r.core.tc.address)
    );

    // register all possible pool adapters for the given count of users
    const poolAdapters: string[] = [];
    for (let i = 0; i < countUsers; ++i) {
      for (const p of r.pools) {
        const assetPairs = generateAssetPairs([...p.asset2cTokens.keys()]);
        for (const pair of assetPairs) {
          await bmAsTc.registerPoolAdapter(p.converter, users[i], pair.smallerAddress, pair.biggerAddress);
          await bmAsTc.registerPoolAdapter(p.converter, users[i], pair.biggerAddress, pair.smallerAddress);

          poolAdapters.push(
            await r.core.bm.getPoolAdapter(p.converter, users[i], pair.smallerAddress, pair.biggerAddress)
          );
          poolAdapters.push(
            await r.core.bm.getPoolAdapter(p.converter, users[i], pair.biggerAddress, pair.smallerAddress)
          );
        }
      }
    }

    // now open all positions
    for (const poolAdapter of poolAdapters) {
      const dmAsPA = DebtMonitor__factory.connect(
        r.core.dm.address,
        await DeployerUtils.startImpersonate(poolAdapter)
      );
      await dmAsPA.onOpenPosition();
    }

    return {
      poolAdapters,
      core: r.core
    };
  }

  async function getRegisteredPositions(dm: DebtMonitor) : Promise<string[]> {
    const count = (await dm.getCountPositions()).toNumber();
    const items = await Promise.all(
      [...Array(count).keys()].map(
        async index => dm.positions(index)
      )
    );
    return items.sort();
  }

  async function getRegisteredPoolAdapters(dm: DebtMonitor, config: IPoolAdapterConfig) : Promise<string[]> {
    const key = await dm.getPoolAdapterKey(config.user, config.collateralAsset, config.borrowAsset);
    const length = (await dm.poolAdaptersLength(config.user, config.collateralAsset, config.borrowAsset)).toNumber();
    const items = await Promise.all(
      [...Array(length).keys()].map(
        async index => dm.poolAdapters(key, index)
      )
    );
    return items.sort();
  }

  function removeItem(items: string[], itemToRemove: string): string[] {
    return items.filter(
      function (item) {
        return item !== itemToRemove;
      }
    )
  }


//endregion Utils for onClosePosition

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
          const thresholdApr = 100; // (!)
          const r = await setUpSinglePool();
          await expect(
            r.core.dm.setThresholdAPR(thresholdApr)
          ).revertedWith("TC-29") // INCORRECT_VALUE
        });
      });
      describe("Set thresholdAPR greater then 100 and not 0", () => {
        it("should revert", async () => {
          const thresholdApr = 101; // (!)
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
            // before
            0, "", false, 0, "", false,
            // after1
            1, poolAdapter, true, 1, poolAdapter, true,
            // after2
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
            sourceDecimals,
            targetDecimals,
            availablePools: [
              {   // source, target
                borrowRateInTokens: [
                  getBigNumberFrom(0, targetDecimals),
                  getBigNumberFrom(1, targetDecimals - 6), // 1e-6
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
            // before
            0, "", false, 0, "", false,
            // after open
            1, poolAdapter, true, 1, poolAdapter, true,
            // after close
            0, "", false, 0, "", false,
          ].join("\n");

          expect(ret).equal(expected);
        });
      });

      describe("Open N positions, close one of them", async () => {
        it("should set debtMonitor.positions to expected state", async () => {
          const r = await preparePoolAdapters([1, 2]);
          let localSnapshot: string;
          for (const poolAdapterToRemove of r.poolAdapters) {
            localSnapshot = await TimeUtils.snapshot();

            // get current state
            const before = await getRegisteredPositions(r.core.dm);

            // close single position
            const dmAsPA = DebtMonitor__factory.connect(
              r.core.dm.address,
              await DeployerUtils.startImpersonate(poolAdapterToRemove)
            );
            await dmAsPA.onClosePosition();

            // get new state
            const after = await getRegisteredPositions(r.core.dm);
            const beforeMinusPoolAdapter = removeItem(before, poolAdapterToRemove);
            const ret = [
              after.join(),
              after.length
            ].join();
            const expected = [
              beforeMinusPoolAdapter.join(),
              before.length - 1
            ].join();

            await TimeUtils.rollback(localSnapshot);

            expect(ret).equal(expected);
          }
        });
        it("should set debtMonitor.poolAdapters to expected state", async () => {
          const r = await preparePoolAdapters([1, 2]);
          let localSnapshot: string;
          for (const poolAdapterToRemove of r.poolAdapters) {
            localSnapshot = await TimeUtils.snapshot();

            const poolAdapter = IPoolAdapter__factory.connect(poolAdapterToRemove, deployer);
            const config = await poolAdapter.getConfig();

            // get current state
            const before = await getRegisteredPoolAdapters(r.core.dm, config);

            // close single position
            const dmAsPA = DebtMonitor__factory.connect(
              r.core.dm.address,
              await DeployerUtils.startImpersonate(poolAdapterToRemove)
            );
            await dmAsPA.onClosePosition();

            // get new state
            const after = await getRegisteredPoolAdapters(r.core.dm, config);
            const beforeMinusPoolAdapter = removeItem(before, poolAdapterToRemove);
            const ret = [
              after.join(),
              after.length
            ].join();
            const expected = [
              beforeMinusPoolAdapter.join(),
              before.length - 1
            ].join();

            await TimeUtils.rollback(localSnapshot);

            expect(ret).equal(expected);
          }
        });
      });

      describe("Create two positions for single converter, close both", async () => {
        it("should set debtMonitor._poolAdaptersForConverters to expected state", async () => {
          const r = await preparePoolAdapters([1], 1, 2);

          const poolAdapter1 = r.poolAdapters[0];
          const poolAdapter2 = r.poolAdapters[1];

          const config = await IPoolAdapter__factory.connect(poolAdapter1, deployer).getConfig();
          const converter = (await config).originConverter;

          const before = await r.core.dm.isConverterInUse(converter);

          const dmAsPA1 = DebtMonitor__factory.connect(
            r.core.dm.address,
            await DeployerUtils.startImpersonate(poolAdapter1)
          );
          await dmAsPA1.onClosePosition();
          const middle = await r.core.dm.isConverterInUse(converter);

          const dmAsPA2 = DebtMonitor__factory.connect(
            r.core.dm.address,
            await DeployerUtils.startImpersonate(poolAdapter2)
          );
          await dmAsPA2.onClosePosition();

          const after = await r.core.dm.isConverterInUse(converter);

          const ret = [before, middle, after].join();
          const expected = [true, true, false].join();

          expect(ret).equal(expected);
        });
      });
    });

    describe("Bad paths", () => {
      describe("Borrow position is not registered", () => {
        it("should set debtMonitor to expected state", async () => {
          const r = await preparePoolAdapters([1], 1, 2);
          const poolAdapterNotRegistered = ethers.Wallet.createRandom().address;
          const dmAsPa = await DebtMonitor__factory.connect(
            r.core.dm.address,
            await DeployerUtils.startImpersonate(poolAdapterNotRegistered)
          );

          await expect(
            dmAsPa.onClosePosition()
          ).revertedWith("TC-11"); // BORROW_POSITION_IS_NOT_REGISTERED
        });
      });

      describe("Attempt to close not empty position", () => {
        async function prepareTest(collateralAmount: number, amountToPay: number): Promise<DebtMonitor> {
          const r = await preparePoolAdapters([1], 1, 2);
          const poolAdapter = r.poolAdapters[0];
          const stub: PoolAdapterStub = await PoolAdapterStub__factory.connect(poolAdapter, deployer);
          await stub.setManualStatus(
            collateralAmount,
            amountToPay,
            0,
            false
          );

          return DebtMonitor__factory.connect(
            r.core.dm.address,
            await DeployerUtils.startImpersonate(poolAdapter)
          );
        }
        describe("collateralAmount is not zero", () => {
          it("should set debtMonitor to expected state", async () => {
            const dmAsPa = await prepareTest(
              1, // (!)
              0
            );
            await expect(
              dmAsPa.onClosePosition()
            ).revertedWith("TC-10"); // ATTEMPT_TO_CLOSE_NOT_EMPTY_BORROW_POSITION
          });
        });
        describe("amountToPay is not zero", () => {
          it("should set debtMonitor to expected state", async () => {
            const dmAsPa = await prepareTest(
              0,
              1 // (!)
            );
            await expect(
              dmAsPa.onClosePosition()
            ).revertedWith("TC-10"); // ATTEMPT_TO_CLOSE_NOT_EMPTY_BORROW_POSITION
          });
        });
      });
    });
  });

  describe("getPositions", () => {
    describe("Good paths", () => {
      it("should return pool adapters with expected params", async () => {
        const countUsers = 2;
        const countAssets = 4;
        const countConvertersPerPlatformAdapters = [1, 2];
        const r = await preparePoolAdapters(countConvertersPerPlatformAdapters, countUsers, countAssets);

        const ret: number[] = [];
        for (const poolAdapterAddress of r.poolAdapters) {
          const poolAdapter = IPoolAdapter__factory.connect(poolAdapterAddress, deployer);
          const config = await poolAdapter.getConfig();
          const positions = await r.core.dm.getPositions(config.user, config.collateralAsset, config.borrowAsset);
          ret.push(positions.length);
        }

        const sret = ret.join();
        const sexpected = r.poolAdapters.map(
          x => (countConvertersPerPlatformAdapters[0] + countConvertersPerPlatformAdapters[1])
        ).join();

        expect(sret).equal(sexpected);
      });
    });
  });

  describe("getPoolAdapterKey", () => {
    it("should return no pool adapters ", async () => {
        const r = await preparePoolAdapters([1], 1, 2);
        const ret = (await r.core.dm.getPoolAdapterKey(
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address
        )).eq(0);
        expect(ret).equal(false);
    });
  });

  describe("getCountPositions", () => {
    it("should return expected value", async () => {
      const countUsers = 2;
      const countAssets = 2;
      const countConvertersPerPlatformAdapters = [1, 2];
      const r = await preparePoolAdapters(countConvertersPerPlatformAdapters, countUsers, countAssets);

      const ret = (await r.core.dm.getCountPositions()).toNumber();
      const expected = countUsers * countAssets
        * (countConvertersPerPlatformAdapters[0] + countConvertersPerPlatformAdapters[1]);

      expect(ret).equal(expected);
    });
  });

  describe("checkHealth", () => {
    describe("Good paths", () => {
      describe("Single borrow", () => {
        describe("Pool adapter is healthy", () => {
          describe("Health factor > min", () => {
            it("should return empty", async () => {
              const index = 0;
              const count = 100; // find all pools

              const pp: ISinglePoolAdapterTestParams = {
                amountCollateral:  10_000,
                sourceDecimals: 6,
                targetDecimals: 24,
                amountToBorrow: 1000,
                priceSourceUSD: {initial: 1, updated: 1},
                priceTargetUSD: {initial: 2, updated: 2},
                collateralFactor: {initial: 0.5, updated: 0.5},
                countPassedBlocks: 0, // no debts
                borrowRate: 1e8
              }
              const {dm, poolAdapterMock, controller} = await prepareSinglePoolAdapterHealthTest(pp);

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

              const ret = await dm.checkHealth(index, count, count);

              const sret = [
                ret.nextIndexToCheck0.toNumber(),
                ret.outPoolAdapters.length,
                ret.outPoolAdapters,
                expectedHealthFactor > minAllowedHealthFactor2 / 100,
                ret.outAmountsToRepay.length
              ].join();

              const sexpected = [
                0,
                0,
                [],
                true,
                0
              ].join();

              expect(sret).equal(sexpected);
            });
          });

          describe("Health factor == min", () => {
            it("should return empty", async () => {
              const index = 0;
              const count = 100; // find all pools

              const pp: ISinglePoolAdapterTestParams = {
                amountCollateral:  10_000,
                sourceDecimals: 6,
                targetDecimals: 24,
                amountToBorrow: 1000,
                priceSourceUSD: {initial: 1, updated: 1},
                priceTargetUSD: {initial: 2, updated: 2},
                collateralFactor: {initial: 0.5, updated: 0.5},
                countPassedBlocks: 0, // no debts
                borrowRate: 1e8
              }
              const {dm, poolAdapterMock, controller} = await prepareSinglePoolAdapterHealthTest(pp);

              const currentHealthFactor18 = (await poolAdapterMock.getStatus()).healthFactor18;
              const minAllowedHealthFactor2 = currentHealthFactor18
                .div(getBigNumberFrom(1, 18-2))
                .toNumber();
              await controller.setMaxHealthFactor2(minAllowedHealthFactor2 * 10);
              await controller.setTargetHealthFactor2(minAllowedHealthFactor2 * 8);
              await controller.setMinHealthFactor2(minAllowedHealthFactor2);

              const expectedHealthFactor =
                pp.collateralFactor.updated
                * pp.priceSourceUSD.updated * pp.amountCollateral
                / (pp.priceTargetUSD.updated * pp.amountToBorrow + pp.borrowRate * pp.countPassedBlocks);
              console.log("Expected healthy factor", expectedHealthFactor);

              const ret = await dm.checkHealth(index, count, count);

              const sret = [
                ret.nextIndexToCheck0.toNumber(),
                ret.outPoolAdapters.length,
                ret.outPoolAdapters,
                expectedHealthFactor === minAllowedHealthFactor2 / 100,
                ret.outAmountsToRepay.length
              ].join();

              const sexpected = [
                0,
                0,
                [],
                true,
                0,
              ].join();

              expect(sret).equal(sexpected);
            });
          });
        });
        describe("Pool adapter is unhealthy", () => {
          describe("Collateral factor becomes too small", () => {
            it("should found problem pool adapter", async () => {
              const index = 0;
              const count = 100; // find all pools

              const pp: ISinglePoolAdapterTestParams = {
                amountCollateral:  10_000,
                sourceDecimals: 6,
                targetDecimals: 24,
                amountToBorrow: 1000,
                priceSourceUSD: {initial: 1, updated: 1},
                priceTargetUSD: {initial: 2, updated: 2},
                collateralFactor: {
                  initial: 0.5,
                  updated: 0.1 // (!)
                },
                countPassedBlocks: 0, // no debts
                borrowRate: 1e8
              }

              // Set up target health factor
              // Let's do it 5 times bigger than current health factor
              const timesToReduceHF = 5.;
              const {dm, poolAdapterMock, controller} = await prepareSinglePoolAdapterHealthTest(pp);
              const currentHealthFactor18 = (await poolAdapterMock.getStatus()).healthFactor18;
              await controller.setTargetHealthFactor2(
                currentHealthFactor18
                  .div(getBigNumberFrom(1, 16)) // decimals 18 => 2
                  .mul(timesToReduceHF)
              );

              const ret = await dm.checkHealth(index, count, count);

              const sret = [
                ret.nextIndexToCheck0.toNumber(),
                ret.outPoolAdapters.length,
                ret.outPoolAdapters,
                ret.outAmountsToRepay.length,
                ret.outAmountsToRepay
              ].join();

              // Current health factor is 5 times fewer than target one
              // deltaBorrowAmount = BorrowAmount * (1 - HealthFactorCurrent/HealthFactorTarget)
              const expectedAmountToRepay = pp.amountToBorrow * (1 - 1./timesToReduceHF);

              const sexpected = [
                0,
                1,
                [poolAdapterMock.address],
                1,
                [getBigNumberFrom(expectedAmountToRepay, pp.targetDecimals)]
              ].join();

              expect(sret).equal(sexpected);
            });
          });
          describe("Collateral price is too cheap", () => {
            it("should found problem pool adapter", async () => {
              const index = 0;
              const count = 100; // find all pools

              const pp: ISinglePoolAdapterTestParams = {
                amountCollateral:  10_000,
                sourceDecimals: 6,
                targetDecimals: 24,
                amountToBorrow: 1000_000,
                priceSourceUSD: {initial: 77_777, updated: 3}, // (!)
                priceTargetUSD: {initial: 2, updated: 2},
                collateralFactor: {
                  initial: 0.5,
                  updated: 0.5
                },
                countPassedBlocks: 0, // no debts
                borrowRate: 1e8
              }
              const {dm, poolAdapterMock} = await prepareSinglePoolAdapterHealthTest(pp);

              const ret = await dm.checkHealth(index, count, count);

              const sret = [
                ret.nextIndexToCheck0.toNumber(),
                ret.outPoolAdapters.length,
                ret.outPoolAdapters,
                ret.outAmountsToRepay.length
              ].join();

              const sexpected = [
                0,
                1,
                [poolAdapterMock.address],
                1
              ].join();

              expect(sret).equal(sexpected);
            });
          });
          describe("Borrowed token is too expensive", () => {
            it("should found problem pool adapter", async () => {
              const index = 0;
              const count = 100; // find all pools

              const pp: ISinglePoolAdapterTestParams = {
                amountCollateral:  10_000,
                sourceDecimals: 6,
                targetDecimals: 24,
                amountToBorrow: 100_000,
                priceSourceUSD: {initial: 10_000, updated: 10_000},
                priceTargetUSD: {initial: 2, updated: 99_999}, // (!)
                collateralFactor: {
                  initial: 0.5,
                  updated: 0.5
                },
                countPassedBlocks: 0, // no debts
                borrowRate: 1e8
              }
              const {dm, poolAdapterMock} = await prepareSinglePoolAdapterHealthTest(pp);

              const ret = await dm.checkHealth(index, count, count);

              const sret = [
                ret.nextIndexToCheck0.toNumber(),
                ret.outPoolAdapters.length,
                ret.outPoolAdapters,
                ret.outAmountsToRepay.length
              ].join();

              const sexpected = [
                0,
                1,
                [poolAdapterMock.address],
                1
              ].join();

              expect(sret).equal(sexpected);
            });
          });
          describe("Amount to pay is too high", () => {
            it("should return the token", async () => {
              const index = 0;
              const count = 100; // find all pools

              const pp: ISinglePoolAdapterTestParams = {
                amountCollateral:  10_000,
                sourceDecimals: 6,
                targetDecimals: 24,
                amountToBorrow: 100_000,
                priceSourceUSD: {initial: 10_000, updated: 10_000},
                priceTargetUSD: {initial: 2, updated: 2},
                collateralFactor: {
                  initial: 0.5,
                  updated: 0.5
                },
                countPassedBlocks: 10_000, // (!)
                borrowRate: 1e2 // decimals 1e18
              }
              const {dm, poolAdapterMock} = await prepareSinglePoolAdapterHealthTest(pp);

              const ret = await dm.checkHealth(index, count, count);

              const sret = [
                ret.nextIndexToCheck0.toNumber(),
                ret.outPoolAdapters.length,
                ret.outPoolAdapters,
                ret.outAmountsToRepay.length
              ].join();

              const sexpected = [
                0,
                1,
                [poolAdapterMock.address],
                1,
              ].join();

              expect(sret).equal(sexpected);
            });
          });
        });
      });
      describe("Multiple borrows", () => {
        async function checkAllBorrows(
          portionSize: number,
          countBorrows: number,
          filterToMakeUnhealthy?: (borrowIndex: number) => boolean,
        ) : Promise<{countAdapters: number, countAmounts: number}> {
          let index = 0;

          const pp: IMultiplePoolAdaptersTestParams = {
            sourceDecimals: 6,
            targetDecimals: 24,
            priceSourceUSD: 1,
            priceTargetUSD: 1,
            collateralFactor: 0.9,
            countPassedBlocks: 0, // no debts
          }
          const {dm, poolAdapterMocks} = await prepareMultiplePoolAdaptersHealthTest(
            pp,
            [...Array(countBorrows).keys()].map(n => ({
              borrowRateInTokens: 1000 * (n + 1), availableLiquidityInTokens: 100_000 * (n + 1)
            })),
            [...Array(countBorrows).keys()].map(n => ({
              amountCollateral: 1000 * (n + 1), amountToBorrow: 500 * (n + 1)
            })),
          );

          if (filterToMakeUnhealthy) {
            for (let i = 0; i < poolAdapterMocks.length; ++i) {
              if (filterToMakeUnhealthy(i)) {
                // move the pool adapter to unhealthy state
                // let's reduce collateral factor significantly
                await poolAdapterMocks[i].changeCollateralFactor(getBigNumberFrom(1, 17));
              }
            }
          }

          let countUnhealthy = 0;
          let countAmounts = 0;
          do {
            const ret = await dm.checkHealth(index, portionSize, portionSize);
            countUnhealthy += ret.outPoolAdapters.length;
            countAmounts += ret.outAmountsToRepay.length;
            index = ret.nextIndexToCheck0.toNumber();
          } while (index !== 0);

          return {countAdapters: countUnhealthy, countAmounts};
        }

        describe("All borrows are healthy", () => {
          describe("Check all borrows at once", () => {
            it("should return empty", async () => {
              const ret = await checkAllBorrows(100, 5);
              const sret = [ret.countAdapters, ret.countAmounts].join();
              const sexpected = [0, 0].join();
              expect(sret).equal(sexpected);
            });
          });
          describe("Check the borrows by parts", () => {
            it("should return empty", async () => {
              const ret = await checkAllBorrows(3, 5);
              const sret = [ret.countAdapters, ret.countAmounts].join();
              const sexpected = [0, 0].join();
              expect(sret).equal(sexpected);
            });
          });
        });
        describe("All borrows are unhealthy", () => {
          describe("Check all borrows at once", () => {
            it("should return all borrows", async () => {
              const countPoolAdapters = 5;
              const ret = await checkAllBorrows(
                100,
                countPoolAdapters,
                _ => true
              );
              const sret = [ret.countAdapters, ret.countAmounts].join();
              const sexpected = [countPoolAdapters, countPoolAdapters].join();
              expect(sret).equal(sexpected);
            });
          });
          describe("Check the borrows by parts", () => {
            it("should return all borrows", async () => {
              const countPoolAdapters = 5;
              const ret = await checkAllBorrows(
                3,
                countPoolAdapters,
                _ => true
              );
              const sret = [ret.countAdapters, ret.countAmounts].join();
              const sexpected = [countPoolAdapters, countPoolAdapters].join();
              expect(sret).equal(sexpected);
            });
            it("should return all borrows", async () => {
              const countPoolAdapters = 7;
              const ret = await checkAllBorrows(
                2,
                countPoolAdapters,
                _ => true
              );
              const sret = [ret.countAdapters, ret.countAmounts].join();
              const sexpected = [countPoolAdapters, countPoolAdapters].join();
              expect(sret).equal(sexpected);
            });
          });
        });
        describe("First borrow is unhealthy", () => {
          it("should return single borrow only", async () => {
            const countPoolAdapters = 5;
            const ret = await checkAllBorrows(
              3,
              countPoolAdapters,
              borrowIndex => borrowIndex === 0
            );
            const sret = [ret.countAdapters, ret.countAmounts].join();
            const sexpected = [1, 1].join();
            expect(sret).equal(sexpected);
          });
        });
        describe("Last borrow is unhealthy", () => {
          it("should return last borrow only", async () => {
            const countPoolAdapters = 7;
            const ret = await checkAllBorrows(
              2,
              countPoolAdapters,
              borrowIndex => borrowIndex === countPoolAdapters - 1
            );
            const sret = [ret.countAdapters, ret.countAmounts].join();
            const sexpected = [1, 1].join();
            expect(sret).equal(sexpected);
          });
        });
      });
    });
  });

  describe("checkAdditionalBorrow", () => {
    describe("Good paths", () => {
      describe("Single borrow", () => {
        describe("Pool adapter is unhealthy", () => {
          describe("Health factor < max", () => {
            it("should return empty", async () => {
              const index = 0;
              const count = 100; // find all pools

              const pp: ISinglePoolAdapterTestParams = {
                amountCollateral:  10_000,
                sourceDecimals: 6,
                targetDecimals: 24,
                amountToBorrow: 1000,
                priceSourceUSD: {initial: 1, updated: 1},
                priceTargetUSD: {initial: 2, updated: 2},
                collateralFactor: {initial: 0.5, updated: 0.5},
                countPassedBlocks: 0, // no debts
                borrowRate: 1e8
              }
              const {dm, poolAdapterMock, controller} = await prepareSinglePoolAdapterHealthTest(pp);

              const currentHealthFactor18 = (await poolAdapterMock.getStatus()).healthFactor18;
              const maxAllowedHealthFactor2 = currentHealthFactor18
                .mul(2)
                .div(getBigNumberFrom(1, 18-2))
                .toNumber();
              await controller.setMaxHealthFactor2(maxAllowedHealthFactor2);

              const expectedHealthFactor =
                pp.collateralFactor.updated
                * pp.priceSourceUSD.updated * pp.amountCollateral
                / (pp.priceTargetUSD.updated * pp.amountToBorrow + pp.borrowRate * pp.countPassedBlocks);
              console.log("Expected healthy factor", expectedHealthFactor);

              const ret = await dm.checkHealth(index, count, count);

              const sret = [
                ret.nextIndexToCheck0.toNumber(),
                ret.outPoolAdapters.length,
                ret.outPoolAdapters,
                expectedHealthFactor < maxAllowedHealthFactor2 / 100,
                ret.outAmountsToRepay.length
              ].join();

              const sexpected = [
                0,
                0,
                [],
                true,
                0
              ].join();

              expect(sret).equal(sexpected);
            });
          });
          describe("Health factor == max", () => {
            it("should return empty", async () => {
              const index = 0;
              const count = 100; // find all pools

              const pp: ISinglePoolAdapterTestParams = {
                amountCollateral:  10_000,
                sourceDecimals: 6,
                targetDecimals: 24,
                amountToBorrow: 1000,
                priceSourceUSD: {initial: 1, updated: 1},
                priceTargetUSD: {initial: 2, updated: 2},
                collateralFactor: {initial: 0.9, updated: 0.9},
                countPassedBlocks: 0, // no debts
                borrowRate: 1e8
              }
              const {dm, poolAdapterMock, controller} = await prepareSinglePoolAdapterHealthTest(pp);

              const currentHealthFactor18 = (await poolAdapterMock.getStatus()).healthFactor18;
              const maxAllowedHealthFactor2 = currentHealthFactor18
                .div(getBigNumberFrom(1, 18-2))
                .toNumber();
              await controller.setMinHealthFactor2(maxAllowedHealthFactor2 / 3);
              await controller.setTargetHealthFactor2(maxAllowedHealthFactor2 / 1.5);
              await controller.setMaxHealthFactor2(maxAllowedHealthFactor2);

              const expectedHealthFactor =
                pp.collateralFactor.updated
                * pp.priceSourceUSD.updated * pp.amountCollateral
                / (pp.priceTargetUSD.updated * pp.amountToBorrow + pp.borrowRate * pp.countPassedBlocks);
              console.log("Expected healthy factor", expectedHealthFactor);

              const ret = await dm.checkHealth(index, count, count);

              const sret = [
                ret.nextIndexToCheck0.toNumber(),
                ret.outPoolAdapters.length,
                ret.outPoolAdapters,
                expectedHealthFactor === maxAllowedHealthFactor2 / 100,
                ret.outAmountsToRepay.length
              ].join();

              const sexpected = [
                0,
                0,
                [],
                true,
                0,
              ].join();

              expect(sret).equal(sexpected);
            });
          });
        });
        describe("Health factor exceeds max", () => {
          it("should found problem pool adapter", async () => {
            const index = 0;
            const count = 100; // find all pools

            const pp: ISinglePoolAdapterTestParams = {
              amountCollateral:  10_000,
              sourceDecimals: 6,
              targetDecimals: 24,
              amountToBorrow: 500,
              priceSourceUSD: {initial: 1, updated: 1},
              priceTargetUSD: {initial: 2, updated: 2},
              collateralFactor: {
                initial: 0.1,
                updated: 0.5 // (!)
              },
              countPassedBlocks: 0, // no debts
              borrowRate: 1e8
            }

            // Set up target health factor
            // Let's do it 4 times smaller than current health factor
            const timesToIncreaseHealthFactor = 4.;
            const {dm, poolAdapterMock, controller} = await prepareSinglePoolAdapterHealthTest(pp);
            const currentHealthFactor2 = (await poolAdapterMock.getStatus()).healthFactor18
              .div(getBigNumberFrom(1, 16)); // decimals 18 => 2

            await controller.setMaxHealthFactor2(currentHealthFactor2.div(2));
            await controller.setTargetHealthFactor2(currentHealthFactor2.div(timesToIncreaseHealthFactor));

            const ret = await dm.checkAdditionalBorrow(index, count, count);

            const sret = [
              ret.nextIndexToCheck0.toNumber(),
              ret.outPoolAdapters.length,
              ret.outPoolAdapters,
              ret.outAmountsToBorrow.length,
              ret.outAmountsToBorrow
            ].join();

            // Current health factor is 4 times fewer than target one
            //    additionalAmountToBeBorrowed = BorrowAmount * (HealthFactorCurrent/HealthFactorTarget - 1)
            const expectedAmountToBeBorrowed = pp.amountToBorrow * (timesToIncreaseHealthFactor - 1);

            const sexpected = [
              0,
              1,
              [poolAdapterMock.address],
              1,
              [getBigNumberFrom(expectedAmountToBeBorrowed, pp.targetDecimals)]
            ].join();

            expect(sret).equal(sexpected);
          });
        });
      });
      describe("Multiple borrows", () => {
        async function checkAllBorrows(
          portionSize: number,
          countBorrows: number,
          filterToMakeTooHealthy?: (borrowIndex: number) => boolean,
        ) : Promise<{countAdapters: number, countAmounts: number}> {
          let index = 0;

          const pp: IMultiplePoolAdaptersTestParams = {
            sourceDecimals: 6,
            targetDecimals: 24,
            priceSourceUSD: 1,
            priceTargetUSD: 1,
            collateralFactor: 0.1,
            countPassedBlocks: 0, // no debts
          }
          const {dm, poolAdapterMocks} = await prepareMultiplePoolAdaptersHealthTest(
            pp,
            [...Array(countBorrows).keys()].map(n => ({
              borrowRateInTokens: 1000 * (n + 1), availableLiquidityInTokens: 100_000 * (n + 1)
            })),
            [...Array(countBorrows).keys()].map(n => ({
              amountCollateral: 2000 * (n + 1), amountToBorrow: 100 * (n + 1)
            })),
          );

          if (filterToMakeTooHealthy) {
            for (let i = 0; i < poolAdapterMocks.length; ++i) {
              if (filterToMakeTooHealthy(i)) {
                // move the pool adapter to too-healthy state
                // let's increase collateral factor significantly from 0.1 to 0.9
                await poolAdapterMocks[i].changeCollateralFactor(getBigNumberFrom(9, 17));
              }
            }
          }

          let countUnhealthy = 0;
          let countAmounts = 0;
          do {
            const ret = await dm.checkAdditionalBorrow(index, portionSize, portionSize);
            countUnhealthy += ret.outPoolAdapters.length;
            countAmounts += ret.outAmountsToBorrow.length;
            index = ret.nextIndexToCheck0.toNumber();
          } while (index !== 0);

          return {countAdapters: countUnhealthy, countAmounts};
        }

        describe("All borrows are healthy", () => {
          describe("Check all borrows at once", () => {
            it("should return empty", async () => {
              const ret = await checkAllBorrows(100, 5);
              const sret = [ret.countAdapters, ret.countAmounts].join();
              const sexpected = [0, 0].join();
              expect(sret).equal(sexpected);
            });
          });
          describe("Check the borrows by parts", () => {
            it("should return empty", async () => {
              const ret = await checkAllBorrows(3, 5);
              const sret = [ret.countAdapters, ret.countAmounts].join();
              const sexpected = [0, 0].join();
              expect(sret).equal(sexpected);
            });
          });
        });
        describe("All borrows are too-healthy", () => {
          describe("Check all borrows at once", () => {
            it("should return all borrows", async () => {
              const countPoolAdapters = 5;
              const ret = await checkAllBorrows(
                100,
                countPoolAdapters,
                _ => true
              );
              const sret = [ret.countAdapters, ret.countAmounts].join();
              const sexpected = [countPoolAdapters, countPoolAdapters].join();
              expect(sret).equal(sexpected);
            });
          });
          describe("Check the borrows by parts", () => {
            it("should return all borrows", async () => {
              const countPoolAdapters = 5;
              const ret = await checkAllBorrows(
                3,
                countPoolAdapters,
                _ => true
              );
              const sret = [ret.countAdapters, ret.countAmounts].join();
              const sexpected = [countPoolAdapters, countPoolAdapters].join();
              expect(sret).equal(sexpected);
            });
            it("should return all borrows", async () => {
              const countPoolAdapters = 7;
              const ret = await checkAllBorrows(
                2,
                countPoolAdapters,
                _ => true
              );
              const sret = [ret.countAdapters, ret.countAmounts].join();
              const sexpected = [countPoolAdapters, countPoolAdapters].join();
              expect(sret).equal(sexpected);
            });
          });
        });
        describe("First borrow is too-healthy", () => {
          it("should return single borrow only", async () => {
            const countPoolAdapters = 5;
            const ret = await checkAllBorrows(
              3,
              countPoolAdapters,
              borrowIndex => borrowIndex === 0
            );
            const sret = [ret.countAdapters, ret.countAmounts].join();
            const sexpected = [1, 1].join();
            expect(sret).equal(sexpected);
          });
        });
        describe("Last borrow is too-healthy", () => {
          it("should return last borrow only", async () => {
            const countPoolAdapters = 7;
            const ret = await checkAllBorrows(
              2,
              countPoolAdapters,
              borrowIndex => borrowIndex === countPoolAdapters - 1
            );
            const sret = [ret.countAdapters, ret.countAmounts].join();
            const sexpected = [1, 1].join();
            expect(sret).equal(sexpected);
          });
        });
      });
    });
  });

  describe("TODO: checkBetterBorrowExists", () => {});
//endregion Unit tests

});