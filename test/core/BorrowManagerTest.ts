import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  BorrowManager, BorrowManager__factory, Controller, Controller__factory, IBorrowManager__factory,
  IPoolAdapter,
  IPoolAdapter__factory, ITetuConverter__factory, LendingPlatformMock__factory, MockERC20,
  PlatformAdapterStub
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {controlGasLimitsEx} from "../../scripts/utils/hardhatUtils";
import {
  GAS_LIMIT_BM_FIND_POOL_1,
  GAS_LIMIT_BM_FIND_POOL_10,
  GAS_LIMIT_BM_FIND_POOL_100, GAS_LIMIT_BM_FIND_POOL_5
} from "../baseUT/GasLimit";
import {IBorrowInputParams, BorrowManagerHelper, IPoolInstanceInfo} from "../baseUT/helpers/BorrowManagerHelper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {generateAssetPairs, getAssetPair, IAssetPair} from "../baseUT/utils/AssetPairUtils";
import {Misc} from "../../scripts/utils/Misc";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {deprecate} from "util";
import {getExpectedApr18} from "../baseUT/apr/aprUtils";

describe("BorrowManager", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let signer: SignerWithAddress;
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
    signer = signers[0];
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

//region DataTypes
  interface IPoolAdapterConfig {
    originConverter: string;
    user: string;
    collateralAsset: string;
    borrowAsset: string
  }
//endregion DataTypes

//region Utils
  /** Get list of platform adapters registered for the given pairs */
  async function getPairsList(bm: BorrowManager, pairs: IAssetPair[]): Promise<string[]> {
    const dest: string[] = [];
    for (const pair of pairs) {
      const len = (await bm.pairsListLength(pair.smallerAddress, pair.biggerAddress)).toNumber();
      for (let i = 0; i < len; ++i) {
        dest.push(await bm.pairsListAt(pair.smallerAddress, pair.biggerAddress, i));
      }
    }
    return dest;
  }

  async function getAllRegisteredPairs(bm: BorrowManager, platformAdapter: string) : Promise<IAssetPair[]> {
    const dest: IAssetPair[] = [];
    const len = (await bm.platformAdapterPairsLength(platformAdapter)).toNumber();
    for (let i = 0; i < len; ++i) {
      const r = await bm.platformAdapterPairsAt(platformAdapter, i);
      if (r.assetLeft < r.assetRight) {
        dest.push({
          smallerAddress: r.assetLeft,
          biggerAddress: r.assetRight
        });
      } else {
        dest.push({
          smallerAddress: r.assetRight,
          biggerAddress: r.assetLeft
        });
      }
    }
    return dest;
  }

  async function initializeAssetPairs(
    converters: string[],
    pairs: IAssetPair[]
  ) : Promise<{
    borrowManager: BorrowManager,
    platformAdapter: PlatformAdapterStub
  }>{
    const controller = await CoreContractsHelper.createController(signer);
    const borrowManager = await CoreContractsHelper.createBorrowManager(signer, controller);
    const debtsMonitor = await MocksHelper.createDebtsMonitorStub(signer, false);
    await controller.setBorrowManager(borrowManager.address);
    await controller.setDebtMonitor(debtsMonitor.address);

    const platformAdapter = await MocksHelper.createPlatformAdapterStub(signer, converters);

    // generate all possible pairs of underlying
    await borrowManager.addAssetPairs(
      platformAdapter.address
      , pairs.map(x => x.smallerAddress)
      , pairs.map(x => x.biggerAddress)
    );

    return {borrowManager, platformAdapter};
  }

  async function initializeApp(valueIsConverterInUse: boolean = false) : Promise<BorrowManager>{
    const controller = await CoreContractsHelper.createController(signer);
    const borrowManager = await CoreContractsHelper.createBorrowManager(signer, controller);
    const debtsMonitor = await MocksHelper.createDebtsMonitorStub(signer, valueIsConverterInUse);
    const tetuConverter = await CoreContractsHelper.createTetuConverter(signer, controller);
    await controller.setBorrowManager(borrowManager.address);
    await controller.setDebtMonitor(debtsMonitor.address);
    await controller.setTetuConverter(tetuConverter.address);
    return borrowManager;
  }

  function pairToStr(pair: BorrowManager.AssetPairStructOutput) {
    return pair.assetLeft < pair.assetRight
      ? `${pair.assetLeft} ${pair.assetRight}`
      : `${pair.assetRight} ${pair.assetLeft}`;
  }
//endregion Utils

//region Set up asset pairs
  async function setUpThreePairsTestSet(borrowManager: BorrowManager) : Promise<{
    pair12: IAssetPair,
    pair13: IAssetPair,
    pair23: IAssetPair,
    platformAdapter1: string,
    platformAdapter2: string,
    platformAdapter3: string,
    converter11: string,
    converter21: string,
    converter22: string,
    converter31: string,
  }> {
    const converter11 = ethers.Wallet.createRandom().address;
    const converter21 = ethers.Wallet.createRandom().address;
    const converter22 = ethers.Wallet.createRandom().address;
    const converter31 = ethers.Wallet.createRandom().address;

    const asset1 = ethers.Wallet.createRandom().address;
    const asset2 = ethers.Wallet.createRandom().address;
    const asset3 = ethers.Wallet.createRandom().address;

    // register platform adapters
    const platformAdapter1 = await MocksHelper.createPlatformAdapterStub(signer, [converter11]);
    const platformAdapter2 = await MocksHelper.createPlatformAdapterStub(signer, [converter21, converter22]);
    const platformAdapter3 = await MocksHelper.createPlatformAdapterStub(signer, [converter31]);

    // first platform adapter allows to convert all 3 assets
    await borrowManager.addAssetPairs(
      platformAdapter1.address,
      [asset1, asset3, asset2],
      [asset2, asset1, asset3]
    );
    // second platform adapter - only one pair of assets
    await borrowManager.addAssetPairs(platformAdapter2.address,
      [asset2, asset1],
      [asset1, asset3]);
    // third platform adapter - only another pair of assets
    await borrowManager.addAssetPairs(platformAdapter3.address, [asset3], [asset2]);

    const pair12 = getAssetPair(asset1, asset2);
    const pair13 = getAssetPair(asset1, asset3);
    const pair23 = getAssetPair(asset2, asset3);

    return {
      pair12,
      pair13,
      pair23,
      platformAdapter1: platformAdapter1.address,
      platformAdapter2: platformAdapter2.address,
      platformAdapter3: platformAdapter3.address,
      converter11,
      converter21,
      converter22,
      converter31
    };
  }

  async function setUpSinglePlatformAdapterTestSet(
    borrowManager: BorrowManager,
    countConverters: number = 2,
    countAssets: number = 4
  ) : Promise<{
    pairs: IAssetPair[],
    platformAdapter: string,
    converters: string[],
    assets: string[]
  }> {

    const converters: string[] = await Promise.all(
        [...Array(countConverters).keys()].map(
          async x => (await MocksHelper.createPoolAdapterMock(signer)).address
        )
    );
    const assets = [...Array(countAssets).keys()].map(x => ethers.Wallet.createRandom().address);

    // register platform adapters
    const platformAdapter = await MocksHelper.createPlatformAdapterStub(signer, converters);

    // register all possible pairs of assets
    const pairs = generateAssetPairs(assets).sort(
      (x, y) => (x.smallerAddress + x.biggerAddress)
        .localeCompare(y.smallerAddress + y.biggerAddress)
    );
    await borrowManager.addAssetPairs(
      platformAdapter.address
      , pairs.map(x => x.smallerAddress)
      , pairs.map(x => x.biggerAddress)
    );

    return {
      pairs,
      platformAdapter: platformAdapter.address,
      converters,
      assets
    };
  }
//endregion Set up asset pairs

//region Test impl
  interface IMakeTestFindConverterResults {
    outPoolIndex0: number;
    outApr18: BigNumber;
    outMaxTargetAmount: BigNumber;
    outGas?: BigNumber;
    rewardsFactor: BigNumber;
    amountCollateralInBorrowAsset36: BigNumber;
  }
  async function makeTestFindConverter(
    tt: IBorrowInputParams,
    sourceAmountNum: number,
    periodInBlocks: number,
    targetHealthFactor?: number,
    estimateGas: boolean = false,
  ) : Promise<IMakeTestFindConverterResults> {
    // There are TWO underlying: source, target
    const {core, sourceToken, targetToken, pools} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(signer, tt);
    if (targetHealthFactor) {
      await core.controller.setMaxHealthFactor2(2 * targetHealthFactor * 100);
      await core.controller.setTargetHealthFactor2(targetHealthFactor * 100);
    }

    console.log("Source amount:", getBigNumberFrom(sourceAmountNum, await sourceToken.decimals()).toString());
    const ret = await core.bm.findConverter({
      sourceToken: sourceToken.address,
      sourceAmount: getBigNumberFrom(sourceAmountNum, await sourceToken.decimals()),
      targetToken: targetToken.address,
      periodInBlocks
    });
    const gas = estimateGas
      ? await core.bm.estimateGas.findConverter({
        sourceToken: sourceToken.address,
        sourceAmount: getBigNumberFrom(sourceAmountNum, await sourceToken.decimals()),
        targetToken: targetToken.address,
        periodInBlocks
      })
      : undefined;

    return {
      outPoolIndex0: pools.findIndex(x => x.converter === ret.converter),
      outApr18: ret.apr18,
      outMaxTargetAmount: ret.maxTargetAmount,
      outGas: gas,
      rewardsFactor: await core.bm.rewardsFactor(),
      amountCollateralInBorrowAsset36: getBigNumberFrom(
        sourceAmountNum * tt.priceSourceUSD / tt.priceTargetUSD,
        36
      )
    }
  }

  interface ITestAprCalculationsResults {
    apr18: BigNumber;
    amountCollateralInBorrowAsset36: BigNumber;
  }
  /**
   * Find conversion plan, return result Apr36
   * @param borrowRate Borrow rate in terms of borrow token
   * @param supplyRateBt Supply rate in terms of borrow token, decimals = decimals of the borrow token
   * @param rewardsAmountBt36 Total amount of rewards for the period, decimals 36
   * @param countBlocks Period in blocks
   * @param targetDecimals
   * @param rewardsFactor
   */
  async function testAprCalculations(
    borrowRate: number,
    supplyRateBt: number,
    rewardsAmountBt36: BigNumber,
    countBlocks: number,
    targetDecimals: number,
    rewardsFactor: BigNumber
  ) : Promise<ITestAprCalculationsResults> {
    const sourceAmountNum = 1000;
    const p: IBorrowInputParams = {
      collateralFactor: 0.8,
      priceSourceUSD: 0.1,
      priceTargetUSD: 2,
      sourceDecimals: 14,
      targetDecimals,
      availablePools: [{   // source, target
        borrowRateInTokens: [0, 0],
        availableLiquidityInTokens: [0, 1000] // not enough money
      }]
    };

    // initialize app
    const {core, sourceToken, targetToken, pools} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(signer, p);

    await core.bm.setRewardsFactor(rewardsFactor);

    // set up APR
    const platformAdapter = await LendingPlatformMock__factory.connect(pools[0].platformAdapter, signer);
    await platformAdapter.changeBorrowRate(
      targetToken.address,
      getBigNumberFrom(borrowRate, p.targetDecimals)
    );

    await platformAdapter.setSupplyRate(
      sourceToken.address,
      // for simplicity, we set supply rate in BORROW tokens
      getBigNumberFrom(supplyRateBt, p.targetDecimals)
    );
    await platformAdapter.setRewardsAmount(
      targetToken.address,
      rewardsAmountBt36
    );

    const sourceAmount = getBigNumberFrom(sourceAmountNum, await sourceToken.decimals());
    const r = await core.bm.findConverter({
      sourceToken: sourceToken.address,
      sourceAmount,
      targetToken: targetToken.address,
      periodInBlocks: countBlocks
    });

    return {
      apr18: r.apr18,
      amountCollateralInBorrowAsset36: getBigNumberFrom(
        sourceAmountNum * p.priceSourceUSD / p.priceTargetUSD,
        36
      )
    };
  }
//endregion Test impl

//region registerPoolAdapter utils
  async function registerPoolAdapters(
    borrowManager: BorrowManager,
    converters: string[],
    users: string[],
    assetPairs: {collateral: string, borrow: string}[],
    countRepeats: number = 1
  ): Promise<{
    poolAdapterAddress: string,
    initConfig: IPoolAdapterConfig,
    resultConfig: IPoolAdapterConfig
  }[]> {
    const dest: {
      poolAdapterAddress: string,
      initConfig: IPoolAdapterConfig,
      resultConfig: IPoolAdapterConfig
    }[] = [];
    for (let i = 0; i < countRepeats; ++i) {
      for (const converter of converters) {
        for (const user of users) {
          for (const pair of assetPairs) {
            await borrowManager.registerPoolAdapter(converter, user, pair.collateral, pair.borrow);
            const poolAdapterAddress = await borrowManager.getPoolAdapter(converter, user, pair.collateral, pair.borrow);

            const poolAdapter = await IPoolAdapter__factory.connect(poolAdapterAddress, signer);
            const config = await poolAdapter.getConfig();
            dest.push({
              poolAdapterAddress,
              initConfig: {
                originConverter: converter,
                user,
                borrowAsset: pair.borrow,
                collateralAsset: pair.collateral
              },
              resultConfig: config
            });
          }
        }
      }
    }
    return dest;
  }

  async function getUniquePoolAdaptersForTwoPoolsAndTwoPairs(countUsers: number) : Promise<{
    out: {
      poolAdapterAddress: string,
      initConfig: IPoolAdapterConfig,
      resultConfig: IPoolAdapterConfig,
    }[],
    app: {
      borrowManager: BorrowManager,
      controller: Controller,
      pools: IPoolInstanceInfo[]
    }
  }> {
    const tt = {
      collateralFactor: 0.8,
      priceSourceUSD: 0.1,
      priceTargetUSD: 4,
      sourceDecimals: 24,
      targetDecimals: 12,
      availablePools: [
        {   // source, target
          borrowRateInTokens: [0, 0],
          availableLiquidityInTokens: [0, 200_000]
        },
        {   // source, target
          borrowRateInTokens: [0, 0],
          availableLiquidityInTokens: [0, 100_000]
        },
      ]
    };

    const {core, sourceToken, targetToken, pools} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(signer, tt);

    const tc = ITetuConverter__factory.connect(await core.controller.tetuConverter(), signer);
    const bmAsTc = BorrowManager__factory.connect(
      core.bm.address,
      await DeployerUtils.startImpersonate(tc.address)
    );

    // register pool adapter
    const converters = [pools[0].converter, pools[1].converter];
    const users = [...Array(countUsers).keys()].map(x => ethers.Wallet.createRandom().address);
    const assetPairs = [
      {
        collateral: sourceToken.address,
        borrow: targetToken.address
      },
      {
        collateral: targetToken.address,
        borrow: sourceToken.address
      },
    ];

    const poolAdapters = await registerPoolAdapters(bmAsTc, converters, users, assetPairs, 2);

    return {
      out: poolAdapters.filter(
        function onlyUnique(value, index, self) {
          return self.findIndex(
            function poolAdapterAddressIsEqual(item) {
              return item.poolAdapterAddress === value.poolAdapterAddress;
            }
          ) === index;
        }
      ),
      app: {
        borrowManager: core.bm,
        controller: core.controller,
        pools
      }
    };
  }
//endregion registerPoolAdapter utils

//region Unit tests
  describe("setHealthFactor", () => {
    async function prepareBorrowManagerWithGivenHealthFactor(minHealthFactor2: number) : Promise<BorrowManager> {
      const controller = await CoreContractsHelper.createController(signer);
      await controller.setMinHealthFactor2(minHealthFactor2);
      return CoreContractsHelper.createBorrowManager(signer, controller);
    }
    describe("Good paths", () => {
      it("should save specified value to defaultHealthFactors", async () => {
        const asset = ethers.Wallet.createRandom().address;
        const healthFactor = 400;

        const controller = await CoreContractsHelper.createController(signer);
        const borrowManager = await CoreContractsHelper.createBorrowManager(signer, controller);

        const before = await borrowManager.defaultHealthFactors2(asset);
        await borrowManager.setHealthFactor(asset, healthFactor);
        const after = await borrowManager.defaultHealthFactors2(asset);

        const ret = [
          ethers.utils.formatUnits(before),
          ethers.utils.formatUnits(after)
        ].join();

        const expected = [
          ethers.utils.formatUnits(0),
          ethers.utils.formatUnits(healthFactor)
        ].join();

        expect(ret).equal(expected);
      });
      describe("Health factor is equal to min value", () => {
        it("should not revert", async () => {
          const minHealthFactor = 120;
          const borrowManager = await prepareBorrowManagerWithGivenHealthFactor(minHealthFactor);
          const asset = ethers.Wallet.createRandom().address;
          await borrowManager.setHealthFactor(asset , minHealthFactor)

          const ret = await borrowManager.defaultHealthFactors2(asset);

          expect(ret).equal(minHealthFactor);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Health factor is less then min value", () => {
        it("should revert", async () => {
          const minHealthFactor = 120;
          const borrowManager = await prepareBorrowManagerWithGivenHealthFactor(minHealthFactor);
          await expect(
            borrowManager.setHealthFactor(ethers.Wallet.createRandom().address, minHealthFactor - 1)
          ).revertedWith("TC-3");
        });
      });
      describe("Not governance", () => {
        it("should revert", async () => {
          const minHealthFactor = 120;
          const borrowManager = await prepareBorrowManagerWithGivenHealthFactor(minHealthFactor);
          const bmAsNotGov = BorrowManager__factory.connect(
            borrowManager.address,
            await DeployerUtils.startImpersonate(user3.address)
          );
          await expect(
            bmAsNotGov.setHealthFactor(ethers.Wallet.createRandom().address, minHealthFactor - 1)
          ).revertedWith("TC-9"); // GOVERNANCE_ONLY
        });
      });
    });

  });

  describe("setRewardsFactor", () => {
    describe("Good paths", () => {
      it("should set expected value", async () => {
        const rewardsFactor = getBigNumberFrom(9, 17);

        const controller = await CoreContractsHelper.createController(signer);
        const borrowManager = await CoreContractsHelper.createBorrowManager(signer, controller);

        await borrowManager.setRewardsFactor(rewardsFactor);
        const ret = (await borrowManager.rewardsFactor()).toString();
        const expected = rewardsFactor.toString();

        expect(ret).equal(expected);
      });
    });
    describe("Bad paths", () => {
      describe("Not governance", () => {
        it("should revert", async () => {
          const rewardsFactor = getBigNumberFrom(9, 17);

          const controller = await CoreContractsHelper.createController(signer);
          const borrowManager = await CoreContractsHelper.createBorrowManager(signer, controller);

          const bmAsNotGov = BorrowManager__factory.connect(
            borrowManager.address,
            await DeployerUtils.startImpersonate(user3.address)
          );
          await expect(
            bmAsNotGov.setRewardsFactor(rewardsFactor)
          ).revertedWith("TC-9"); // GOVERNANCE_ONLY
        });
      });
    });

  });

  describe("addAssetPairs", () => {
    describe("Good paths", () => {
      describe("Register single platform adapter first time", () => {
        it("should set borrow manager to expected state", async () => {
          const borrowManager = await initializeApp();
          const r = await setUpSinglePlatformAdapterTestSet(borrowManager);

          const registeredPairs = await getAllRegisteredPairs(borrowManager, r.platformAdapter);
          const lenPlatformAdapters = (await borrowManager.platformAdaptersLength()).toNumber();

          const ret = [
            // there is single platform adapter
            lenPlatformAdapters,
            lenPlatformAdapters === 0 ? "" : await borrowManager.platformAdaptersAt(0),

            // list of all pairs registered for the platform adapter
            registeredPairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),

            // List of platform adapters registered for each pair
            (await getPairsList(borrowManager, r.pairs)).join(";")
          ].join("\n");

          const expected = [
            1,
            r.platformAdapter,

            r.pairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),

            [...Array(r.pairs.length).keys()].map(x => r.platformAdapter).join(";")
          ].join("\n");

          expect(ret).equal(expected);
        });

        describe("Register same platform adapter second time", () => {
          it("should not throw exception", async () => {
            const borrowManager = await initializeApp();
            // initialize platform adapter first time
            const r = await setUpSinglePlatformAdapterTestSet(borrowManager);

            // register the platform adapter with exactly same parameters second time

            const cr = await (await borrowManager.addAssetPairs(
              r.platformAdapter
              , r.pairs.map(x => x.smallerAddress)
              , r.pairs.map(x => x.biggerAddress)
            )).wait();
            expect(cr.status).eq(1); // we don't have any exception
          });
        });
        describe("Add new asset pairs to exist platform adapter", () => {
          it("should not throw exception", async () => {
            const borrowManager = await initializeApp();
            // initialize platform adapter first time
            const r = await setUpSinglePlatformAdapterTestSet(borrowManager);
            const newAsset = ethers.Wallet.createRandom().address;

            // register the platform adapter with exactly same parameters second time
            const cr = await (await borrowManager.addAssetPairs(
                r.platformAdapter
                , r.assets.map(x => newAsset)
                , r.assets.map(x => x)
            )).wait();
            expect(cr.status).eq(1); // we don't have any exception
          });
        });
      });
      describe("Register several platform adapters", () => {
        describe("Set up three pairs", () => {
          it("should setup pairsList correctly", async () => {
            const borrowManager = await initializeApp();
            const r = await setUpThreePairsTestSet(borrowManager);

            const list12 = await getPairsList(borrowManager, [r.pair12]);
            const list13 = await getPairsList(borrowManager, [r.pair13]);
            const list23 = await getPairsList(borrowManager, [r.pair23]);

            const ret = [
              list12.join(),
              list13.join(),
              list23.join(),
            ].join("\n");
            const expected = [
              [r.platformAdapter1, r.platformAdapter2].join(),
              [r.platformAdapter1, r.platformAdapter2].join(),
              [r.platformAdapter1, r.platformAdapter3].join()
            ].join("\n");

            expect(ret).equal(expected);
          });

          it("should setup converterToPlatformAdapter correctly", async () => {
            const borrowManager = await initializeApp();
            const r = await setUpThreePairsTestSet(borrowManager);

            const ret = [
              await borrowManager.converterToPlatformAdapter(r.converter11),
              await borrowManager.converterToPlatformAdapter(r.converter21),
              await borrowManager.converterToPlatformAdapter(r.converter22),
              await borrowManager.converterToPlatformAdapter(r.converter31)
            ].join("\n");

            const expected = [
              r.platformAdapter1,
              r.platformAdapter2,
              r.platformAdapter2,
              r.platformAdapter3,
            ].join("\n");
            expect(ret).equal(expected);
          });

          it("should setup _platformAdapters correctly", async () => {
            const borrowManager = await initializeApp();
            const r = await setUpThreePairsTestSet(borrowManager);

            const ret = [
              await borrowManager.platformAdaptersLength(),
              await borrowManager.platformAdaptersAt(0),
              await borrowManager.platformAdaptersAt(1),
              await borrowManager.platformAdaptersAt(2),
            ].join("\n");

            const expected = [
              3,
              r.platformAdapter1,
              r.platformAdapter2,
              r.platformAdapter3,
            ].join("\n");
            expect(ret).equal(expected);
          });

          it("should setup _platformAdapterPairs and _assetPairs correctly", async () => {
            const borrowManager = await initializeApp();
            const r = await setUpThreePairsTestSet(borrowManager);

            const ret = [
              await borrowManager.platformAdapterPairsLength(r.platformAdapter1),
              pairToStr(await borrowManager.platformAdapterPairsAt(r.platformAdapter1,0)),
              pairToStr(await borrowManager.platformAdapterPairsAt(r.platformAdapter1,1)),
              pairToStr(await borrowManager.platformAdapterPairsAt(r.platformAdapter1,2)),
              await borrowManager.platformAdapterPairsLength(r.platformAdapter2),
              pairToStr(await borrowManager.platformAdapterPairsAt(r.platformAdapter2, 0)),
              pairToStr(await borrowManager.platformAdapterPairsAt(r.platformAdapter2, 1)),
              await borrowManager.platformAdapterPairsLength(r.platformAdapter3),
              pairToStr(await borrowManager.platformAdapterPairsAt(r.platformAdapter3, 0)),
            ].join("\n");

            const expected = [
              3,
              `${r.pair12.smallerAddress} ${r.pair12.biggerAddress}`,
              `${r.pair13.smallerAddress} ${r.pair13.biggerAddress}`,
              `${r.pair23.smallerAddress} ${r.pair23.biggerAddress}`,
              2,
              `${r.pair12.smallerAddress} ${r.pair12.biggerAddress}`,
              `${r.pair13.smallerAddress} ${r.pair13.biggerAddress}`,
              1,
              `${r.pair23.smallerAddress} ${r.pair23.biggerAddress}`,
            ].join("\n");
            expect(ret).equal(expected);
          });
        });
      });
    });

    describe("Bad paths", () => {
      describe("Wrong lengths", () => {
        it("should revert", async () => {
          const borrowManager = await initializeApp();
          const platformAdapter = await MocksHelper.createPlatformAdapterStub(signer,
            [ethers.Wallet.createRandom().address]
          );

          await expect(
            borrowManager.addAssetPairs(
              platformAdapter.address
              , [ethers.Wallet.createRandom().address]
              , [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address]
            )
          ).revertedWith("TC-12")
        });
      });
      describe("Converter is used by two platform adapters", () => {
        it("should revert", async () => {
          const borrowManager = await initializeApp();
          const converter = ethers.Wallet.createRandom().address;

          const asset1 = ethers.Wallet.createRandom().address;
          const asset2 = ethers.Wallet.createRandom().address;

          // There are two platform adapters that use SAME converter
          const platformAdapter1 = await MocksHelper.createPlatformAdapterStub(signer, [converter]);
          const platformAdapter2 = await MocksHelper.createPlatformAdapterStub(signer, [converter]);

          // Try to register both platform adapters
          await borrowManager.addAssetPairs(platformAdapter1.address, [asset1], [asset2]);
          await expect(
            borrowManager.addAssetPairs(platformAdapter2.address, [asset1], [asset2])
          ).revertedWith("TC-37");

        });
      });
    });
  });

  describe("removeAssetPairs", () => {
    describe("Good paths", () => {
      describe("Register single pool", () => {
        describe("Remove all asset pairs", () => {
          it("should completely unregister the platform adapter", async () => {
            const borrowManager = await initializeApp();
            const r = await setUpSinglePlatformAdapterTestSet(borrowManager
              , 1 // single converter
            );

            await borrowManager.removeAssetPairs(
              r.platformAdapter
              , r.pairs.map(x => x.smallerAddress)
              , r.pairs.map(x => x.biggerAddress)
            );

            const lenPlatformAdapters = (await borrowManager.platformAdaptersLength()).toNumber();
            const registeredPairs = await getAllRegisteredPairs(borrowManager, r.platformAdapter);
            const platformAdapterForConverter = await borrowManager.converterToPlatformAdapter(r.converters[0]);
            const platformAdapterPairsLength = (await borrowManager.platformAdapterPairsLength(
              r.platformAdapter
            )).toNumber();
            const pairsListLength = await borrowManager.pairsListLength(
              r.pairs[0].smallerAddress,
              r.pairs[0].biggerAddress
            );

            const ret = [
              lenPlatformAdapters,
              registeredPairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),
              platformAdapterForConverter,
              platformAdapterPairsLength,
              pairsListLength
            ].join("\n");

            const expected = [
              0,
              "",
              Misc.ZERO_ADDRESS,
              0,
              0,
            ].join("\n");

            expect(ret).equal(expected);
          });
        });
        describe("Remove not all pairs", () => {
          async function makeTestRemoveNotAllPairs(isConverterInUse: boolean): Promise<{ret: string, expected: string}> {
            const borrowManager = await initializeApp();
            const r = await setUpSinglePlatformAdapterTestSet(borrowManager
              , 1 // single converter
              , 3 // three assets (3 pairs)
            );

            // there are three assets and three pairs
            // let's remove last pair and keep first two pairs
            const pairsToRemove = r.pairs.slice(2);

            await borrowManager.removeAssetPairs(
              r.platformAdapter,
              pairsToRemove.map(x => x.smallerAddress),
              pairsToRemove.map(x => x.biggerAddress)
            );

            const lenPlatformAdapters = (await borrowManager.platformAdaptersLength()).toNumber();
            const registeredPairs = await getAllRegisteredPairs(borrowManager, r.platformAdapter);
            const platformAdapterForConverter = await borrowManager.converterToPlatformAdapter(r.converters[0]);
            const platformAdapterPairsLength = (await borrowManager.platformAdapterPairsLength(
              r.platformAdapter
            )).toNumber();
            const pairsListLength1 = await borrowManager.pairsListLength(
              r.pairs[0].smallerAddress,
              r.pairs[0].biggerAddress
            );
            const pairsListLength2 = await borrowManager.pairsListLength(
              r.pairs[1].smallerAddress,
              r.pairs[1].biggerAddress
            );
            const pairsListLength3 = await borrowManager.pairsListLength(
              r.pairs[2].smallerAddress,
              r.pairs[2].biggerAddress
            );

            const ret = [
              lenPlatformAdapters,
              registeredPairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),
              platformAdapterForConverter,
              platformAdapterPairsLength,
              pairsListLength1,
              pairsListLength2,
              pairsListLength3,
            ].join("\n");

            const expected = [
              1,
              r.pairs.slice(0, 2).map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),
              r.platformAdapter,
              2,
              1, // pairsListLength1
              1, // pairsListLength2
              0  // pairsListLength3
            ].join("\n");
            return {ret, expected};
          }
          describe("Converter is in use", () => {
            it("should unregister pairs", async () => {
              const r = await makeTestRemoveNotAllPairs(true);
              expect(r.ret).equal(r.expected);
            });
          });
          describe("Converter is NOT in use", () => {
            it("should unregister pairs", async () => {
              const r = await makeTestRemoveNotAllPairs(false);
              expect(r.ret).equal(r.expected);
            });
          });
        });
      });
    });
    describe("Bad paths", () => {
      describe("Platform adapter is not registered", () => {
        it("should revert", async () => {
          const borrowManager = await initializeApp();
          const platformAdapterNotExist = ethers.Wallet.createRandom().address;
          const r = await setUpSinglePlatformAdapterTestSet(borrowManager);

          await expect(
            borrowManager.removeAssetPairs(
              platformAdapterNotExist,
              r.pairs.map(x => x.smallerAddress),
              r.pairs.map(x => x.biggerAddress)
            )
          ).revertedWith("TC-6"); // PLATFORM_ADAPTER_NOT_FOUND
        });
      });
      describe("Wrong lengths", () => {
        it("should revert", async () => {
          const borrowManager = await initializeApp();
          const r = await setUpSinglePlatformAdapterTestSet(borrowManager);

          await expect(
            borrowManager.removeAssetPairs(
              r.platformAdapter,
              r.pairs.map(x => x.smallerAddress).slice(-1), // (!) incorrect length
              r.pairs.map(x => x.biggerAddress)
            )
          ).revertedWith("TC-12"); // WRONG_LENGTHS
        });
      });
      describe("Converter is in use", () => {
        it("should revert", async () => {
          const isConverterInUse = true;
          const borrowManager = await initializeApp(isConverterInUse);
          const r = await setUpSinglePlatformAdapterTestSet(borrowManager);

          await expect(
            borrowManager.removeAssetPairs(
              r.platformAdapter,
              r.pairs.map(x => x.smallerAddress),
              r.pairs.map(x => x.biggerAddress)
            )
          ).revertedWith("TC-33"); // PLATFORM_ADAPTER_IS_IN_USE
        });
      });
    });
  });

  describe("findConverter", () => {
    describe("Good paths", () => {
      describe("Check APR value calculation", () => {
        it("should return expected APR value", async () => {
          const borrowRate = 100;
          const supplyRateBt = 123;
          const rewardsAmountBt36 = getBigNumberFrom(8000, 36);
          const countBlocks = 4;
          const targetDecimals = 17;
          const rewardsFactor = getBigNumberFrom(3, 17);

          const ret = await testAprCalculations(
            borrowRate,
            supplyRateBt,
            rewardsAmountBt36,
            countBlocks,
            targetDecimals,
            rewardsFactor
          );

          const expectedApr = getExpectedApr18(
            getBigNumberFrom(borrowRate * countBlocks, 36),
            getBigNumberFrom(supplyRateBt * countBlocks, 36),
            rewardsAmountBt36,
            ret.amountCollateralInBorrowAsset36,
            rewardsFactor
          );

          const sret = ret.apr18.toString();
          const sexpected = expectedApr.toString();

          expect(sret).equal(sexpected);
        });
      });

      describe("Check pool selection", () => {
        describe("Example 1: Pool 1 has a lowest borrow rate", () => {
          it("should return Pool 1 and expected amount", async () => {
            const bestBorrowRate = 27;
            const sourceAmount = 100_000;
            const targetHealthFactor = 4;
            const period = 1;
            const p: IBorrowInputParams = {
              collateralFactor: 0.8,
              priceSourceUSD: 0.1,
              priceTargetUSD: 4,
              sourceDecimals: 24,
              targetDecimals: 12,
              availablePools: [
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate],
                  availableLiquidityInTokens: [0, 100] // not enough money
                },
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate], // best rate
                  availableLiquidityInTokens: [0, 2000] // enough cash
                },
                {   // source, target   -   pool 2 is the best
                  borrowRateInTokens: [0, bestBorrowRate+1], // the rate is worse
                  availableLiquidityInTokens: [0, 2000000000] // a lot of cash
                },
              ]
            };

            const ret = await makeTestFindConverter(p, sourceAmount, period, targetHealthFactor);
            console.log(ret);
            const sret = [
              ret.outPoolIndex0,
              ethers.utils.formatUnits(ret.outMaxTargetAmount, p.targetDecimals),
              ethers.utils.formatUnits(ret.outApr18, p.targetDecimals)
            ].join();

            const expectedApr18 = getExpectedApr18(
              getBigNumberFrom(bestBorrowRate * period, 36),
              BigNumber.from(0),
              BigNumber.from(0),
              ret.amountCollateralInBorrowAsset36,
              ret.rewardsFactor
            );

            const sexpected = [
              1, // best pool
              "500.0", // Use https://docs.google.com/spreadsheets/d/1oLeF7nlTefoN0_9RWCuNc62Y7W72-Yk7/edit?usp=sharing&ouid=116979561535348539867&rtpof=true&sd=true
                       // to calculate expected amounts
              ethers.utils.formatUnits(expectedApr18, p.targetDecimals),
            ].join();

            expect(sret).equal(sexpected);
          });
        });
        describe("Example 4: Pool 3 has a lowest borrow rate", () => {
          it("should return Pool 3 and expected amount", async () => {
            const bestBorrowRate = 270;
            const sourceAmount = 1000;
            const targetHealthFactor = 1.6;
            const period = 1;
            const input: IBorrowInputParams = {
              collateralFactor: 0.9,
              priceSourceUSD: 2,
              priceTargetUSD: 0.5,
              sourceDecimals: 6,
              targetDecimals: 6,
              availablePools: [
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate],
                  availableLiquidityInTokens: [0, 100] // not enough money
                },
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate * 5], // too high borrow rate
                  availableLiquidityInTokens: [0, 2000] // enough cash
                },
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate], // the rate is best
                  availableLiquidityInTokens: [0, 2000] // enough cash
                },
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate], // the rate is best
                  availableLiquidityInTokens: [0, 2000000000] // even more cash than in prev.pool
                },
                {   // source, target   -   pool 2 is the best
                  borrowRateInTokens: [0, bestBorrowRate+1], // the rate is not best
                  availableLiquidityInTokens: [0, 2000000000] // a lot of cash
                },
              ]
            };

            const ret = await makeTestFindConverter(input, sourceAmount, period, targetHealthFactor);
            const sret = [
              ret.outPoolIndex0,
              ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
              ethers.utils.formatUnits(ret.outApr18, input.targetDecimals)
            ].join();

            const expectedApr18 = getExpectedApr18(
              getBigNumberFrom(bestBorrowRate * period, 36),
              BigNumber.from(0),
              BigNumber.from(0),
              ret.amountCollateralInBorrowAsset36,
              ret.rewardsFactor
            );
            const sexpected = [
              3, // best pool
              "2250.0", // Use https://docs.google.com/spreadsheets/d/1oLeF7nlTefoN0_9RWCuNc62Y7W72-Yk7/edit?usp=sharing&ouid=116979561535348539867&rtpof=true&sd=true
              // to calculate expected amounts
              ethers.utils.formatUnits(expectedApr18, input.targetDecimals),
            ].join();

            expect(sret).equal(sexpected);
          });
        });
        describe("All pools has same borrow rate", () => {
          it("should return Pool 0", async () => {
            const bestBorrowRate = 7;
            const sourceAmount = 10000;
            const period = 1;
            const input: IBorrowInputParams = {
              collateralFactor: 0.5,
              priceSourceUSD: 0.5,
              priceTargetUSD: 0.2,
              sourceDecimals: 18,
              targetDecimals: 6,
              availablePools: [
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate],
                  availableLiquidityInTokens: [0, 10000]
                },
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate],
                  availableLiquidityInTokens: [0, 20000]
                },
                {   // source, target   -   pool 2 is the best
                  borrowRateInTokens: [0, bestBorrowRate],
                  availableLiquidityInTokens: [0, 40000]
                },
              ]
            };

            const ret = await makeTestFindConverter(input, sourceAmount, period);
            const sret = [
              ret.outPoolIndex0,
              ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
              ethers.utils.formatUnits(ret.outApr18, input.targetDecimals)
            ].join();

            const expectedApr18 = getExpectedApr18(
              getBigNumberFrom(bestBorrowRate * period, 36),
              BigNumber.from(0),
              BigNumber.from(0),
              ret.amountCollateralInBorrowAsset36,
              ret.rewardsFactor
            );
            const sexpected = [
              0, // best pool
              "6250.0", // Use https://docs.google.com/spreadsheets/d/1oLeF7nlTefoN0_9RWCuNc62Y7W72-Yk7/edit?usp=sharing&ouid=116979561535348539867&rtpof=true&sd=true
                        // to calculate expected amounts
              ethers.utils.formatUnits(expectedApr18, input.targetDecimals),
            ].join();

            expect(sret).equal(sexpected);
          });
        });
      });
    });
    describe("Bad paths", () => {
      describe("Pools don't have enough liquidity", () => {
        it("should return all 0", async () => {
          const bestBorrowRate = 7;
          const sourceAmount = 100_000;
          const collateralFactor = 0.5;
          const targetHealthFactor = 2;
          const expectedMaxAmountToBorrow = sourceAmount / targetHealthFactor * collateralFactor;
          const period = 1;
          const input: IBorrowInputParams = {
            collateralFactor,
            priceSourceUSD: 1,
            priceTargetUSD: 1,
            sourceDecimals: 18,
            targetDecimals: 6,
            availablePools: [
              {   // source, target
                borrowRateInTokens: [0, bestBorrowRate],
                availableLiquidityInTokens: [0, 0] // no liquidity at all
              },
              {   // source, target
                borrowRateInTokens: [0, bestBorrowRate],
                availableLiquidityInTokens: [0, expectedMaxAmountToBorrow - 1] // not enough liquidity
              },
            ]
          };

          const ret = await makeTestFindConverter(input, sourceAmount, period, targetHealthFactor);
          const sret = [
            ret.outPoolIndex0,
            ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
            ethers.utils.formatUnits(ret.outApr18, input.targetDecimals)
          ].join();

          const sexpected = [-1, "0.0", "0.0"].join();

          expect(sret).equal(sexpected);
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      describe("10 pools, each next pool is better then previous, estimate gas", () => {
        async function checkGas(countPools: number): Promise<BigNumber> {
          const bestBorrowRate = 270;
          const sourceAmount = 100_000;
          const healthFactor = 4;
          const period = 1;
          const input: IBorrowInputParams = {
            collateralFactor: 0.8,
            priceSourceUSD: 0.1,
            priceTargetUSD: 4,
            sourceDecimals: 24,
            targetDecimals: 12,
            availablePools: [...Array(countPools).keys()].map(
              x => ({   // source, target
                borrowRateInTokens: [0, bestBorrowRate - x], // next pool is better then previous
                availableLiquidityInTokens: [0, 2000000] // enough money
              }),
            )
          };

          const ret = await makeTestFindConverter(input,
            sourceAmount,
            healthFactor,
            period,
            true // we need to estimate gas
          );
          console.log(`findPools: estimated gas for ${countPools} pools`, ret.outGas);
          return ret.outGas || BigNumber.from(0);
        }
        it("1 pool, estimated gas should be less the limit", async () => {
          const gas = await checkGas(1);
          controlGasLimitsEx(gas, GAS_LIMIT_BM_FIND_POOL_1, (u, t) => {
            expect(u).to.be.below(t);
          });
        });
        it("5 pools, estimated gas should be less the limit", async () => {
          const gas = await checkGas(5);
          controlGasLimitsEx(gas, GAS_LIMIT_BM_FIND_POOL_5, (u, t) => {
            expect(u).to.be.below(t);
          });
        });
        it.skip("10 pools, estimated gas should be less the limit", async () => {
          const gas = await checkGas(10);
          controlGasLimitsEx(gas, GAS_LIMIT_BM_FIND_POOL_10, (u, t) => {
            expect(u).to.be.below(t);
          });
        });
        it.skip("100 pools, estimated gas should be less the limit", async () => {
          const gas = await checkGas(100);
          controlGasLimitsEx(gas, GAS_LIMIT_BM_FIND_POOL_100, (u, t) => {
            expect(u).to.be.below(t);
          });
        });
      });
    });
  });

  describe("registerPoolAdapter", () => {
    describe("Good paths", () => {
      describe("Single platform adapter + converter", () => {
        it("should create and initialize an instance of the converter contract", async () => {
          // create borrow manager (BM) with single pool
          const tt = BorrowManagerHelper.getBmInputParamsSinglePool();
          const {core, sourceToken, targetToken, pools} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(signer, tt);

          // register pool adapter
          const converter = pools[0].converter;
          const user = ethers.Wallet.createRandom().address;
          const collateral = sourceToken.address;

          const tc = ITetuConverter__factory.connect(await core.controller.tetuConverter(), signer);
          const bmAsTc = IBorrowManager__factory.connect(
            core.bm.address,
            await DeployerUtils.startImpersonate(tc.address)
          );

          await bmAsTc.registerPoolAdapter(converter, user, collateral, targetToken.address);
          const poolAdapter = await bmAsTc.getPoolAdapter(converter, user, collateral, targetToken.address);

          // get data from the pool adapter
          const pa: IPoolAdapter = IPoolAdapter__factory.connect(
            poolAdapter,
            await DeployerUtils.startImpersonate(user)
          );

          const paConfig = await pa.getConfig();
          const ret = [
            paConfig.originConverter,
            paConfig.collateralAsset,
            paConfig.user,
            paConfig.borrowAsset
          ].join("\n");

          const expected = [
            pools[0].converter,
            sourceToken.address,
            user,
            targetToken.address
          ].join("\n");

          expect(ret).equal(expected);
        });
      });
      describe("Create pool adapters for several sets of converters, users, assets twice", () => {
        it("should register expected number of pool adapters", async () => {
          const countConverters = 2; // see implementation of getUniquePoolAdaptersForTwoPoolsAndTwoPairs
          const countPairs = 2; // see implementation of getUniquePoolAdaptersForTwoPoolsAndTwoPairs

          const countUsers = 5;

          const uniquePoolAdapters = await getUniquePoolAdaptersForTwoPoolsAndTwoPairs(countUsers);

          const ret = uniquePoolAdapters.out.length;
          const expected = countConverters * countUsers * countPairs;

          expect(ret).equal(expected);
        });
        it("should initialize pool adapters by expected values", async () => {
          const countConverters = 2; // see implementation of getUniquePoolAdaptersForTwoPoolsAndTwoPairs
          const countPairs = 2; // see implementation of getUniquePoolAdaptersForTwoPoolsAndTwoPairs

          const countUsers = 5;

          const uniquePoolAdapters = await getUniquePoolAdaptersForTwoPoolsAndTwoPairs(countUsers);

          const ret = uniquePoolAdapters.out.filter(
            x => x.initConfig.originConverter === x.resultConfig.originConverter
              && x.initConfig.user === x.resultConfig.user
              && x.initConfig.collateralAsset === x.resultConfig.collateralAsset
              && x.initConfig.borrowAsset === x.resultConfig.borrowAsset
          ).length;
          const expected = countConverters * countUsers * countPairs;

          expect(ret).equal(expected);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Wrong converter address", () => {
        it("should revert", async () => {
          const tt = BorrowManagerHelper.getBmInputParamsSinglePool();
          const {core, sourceToken, targetToken} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(signer, tt);

          const bmAsTc = IBorrowManager__factory.connect(
            core.bm.address,
            await DeployerUtils.startImpersonate(core.tc.address)
          );

          const converter = ethers.Wallet.createRandom().address; // (!)
          const user = ethers.Wallet.createRandom().address;
          const collateral = sourceToken.address;

          await expect(
            bmAsTc.registerPoolAdapter(converter, user, collateral, targetToken.address)
          ).revertedWith("TC-6"); // PLATFORM_ADAPTER_NOT_FOUND
        });
      });
      describe("Not TetuConverter", () => {
        it("should revert", async () => {
          const tt = BorrowManagerHelper.getBmInputParamsSinglePool();
          const {core, sourceToken, targetToken, pools} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(signer, tt);

          const bmAsNotTc = IBorrowManager__factory.connect(core.bm.address, signer);

          const converter = pools[0].converter;
          const user = ethers.Wallet.createRandom().address;
          const collateral = sourceToken.address;

          await expect(
            bmAsNotTc.registerPoolAdapter(converter, user, collateral, targetToken.address)
          ).revertedWith("TC-8"); // TETU_CONVERTER_ONLY
        });
      });
    });
  });

  describe("getPlatformAdapter", () => {
    describe("Good paths", () => {
      it("should return expected platform adapter", async () => {
        const borrowManager = await initializeApp();
        const controller = Controller__factory.connect(await borrowManager.controller(), signer);

        const platformAdapterSets = [
          await setUpSinglePlatformAdapterTestSet(borrowManager),
          await setUpSinglePlatformAdapterTestSet(borrowManager),
          await setUpSinglePlatformAdapterTestSet(borrowManager)
        ];

        const tc = ITetuConverter__factory.connect(await controller.tetuConverter(), signer);
        const bmAsTc = BorrowManager__factory.connect(
          borrowManager.address,
          await DeployerUtils.startImpersonate(tc.address)
        );

        // register pool adapter
        const ret: string[] = [];
        const expected: string[] = [];
        for (const platformAdapterSet of platformAdapterSets) {
          const converter = platformAdapterSet.converters[0];
          const user = ethers.Wallet.createRandom().address;
          const pair = platformAdapterSet.pairs[0];

          const poolAdapters = await registerPoolAdapters(bmAsTc,
            [converter],
            [user],
            [{collateral: pair.biggerAddress, borrow: pair.smallerAddress}]
          );
          ret.push(
            await bmAsTc.getPlatformAdapter(converter)
          );
          expected.push(platformAdapterSet.platformAdapter);
        }
        expect(ret.join()).equal(expected.join());
      });
    });
    describe("Bad paths", () => {
      describe("converter address is not registered", () => {
        it("should revert", async () => {
          const borrowManager = await initializeApp();
          await expect(
            borrowManager.getPlatformAdapter(ethers.Wallet.createRandom().address)
          ).revertedWith("TC-6"); // PLATFORM_ADAPTER_NOT_FOUND
        });
      });
    });
  });

  describe("isPoolAdapter", () => {
    describe("Good paths", () => {
      it("should return true for registered pool adapters", async () => {
        const r = await getUniquePoolAdaptersForTwoPoolsAndTwoPairs(2);
        const addressesToCheck = [
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address,
          ...r.out.map(x => x.poolAdapterAddress)
        ];
        const ret = (await Promise.all(
          addressesToCheck.map(
            async x => r.app.borrowManager.isPoolAdapter(x)
          )
        )).join();
        const expected = [
          false,
          false,
          [...Array(r.out.length).keys()].map(x => true)
        ].join();

        expect(ret).equal(expected);
      });
    });
  });

  describe("getPoolAdapter", () => {
    describe("Good paths", () => {
      it("should return expected addresses", async () => {
        const r = await getUniquePoolAdaptersForTwoPoolsAndTwoPairs(2);
        const firstItem = r.out[0].initConfig;

        // unregistered pool adapters
        const ret: string[] = [
          await r.app.borrowManager.getPoolAdapter(
            ethers.Wallet.createRandom().address,
            firstItem.user,
            firstItem.collateralAsset,
            firstItem.borrowAsset
          ),
          await r.app.borrowManager.getPoolAdapter(
            firstItem.originConverter,
            ethers.Wallet.createRandom().address,
            firstItem.collateralAsset,
            firstItem.borrowAsset
          ),
          await r.app.borrowManager.getPoolAdapter(
            firstItem.originConverter,
            firstItem.user,
            ethers.Wallet.createRandom().address,
            firstItem.borrowAsset
          ),
          await r.app.borrowManager.getPoolAdapter(
            firstItem.originConverter,
            firstItem.user,
            firstItem.collateralAsset,
            ethers.Wallet.createRandom().address,
          )
        ];
        const expected: string[] = [
          Misc.ZERO_ADDRESS,
          Misc.ZERO_ADDRESS,
          Misc.ZERO_ADDRESS,
          Misc.ZERO_ADDRESS,
        ];

        // registered pool adapters
        for (const item of r.out) {
          const poolAdapter = await r.app.borrowManager.getPoolAdapter(
            item.initConfig.originConverter,
            item.initConfig.user,
            item.initConfig.collateralAsset,
            item.initConfig.borrowAsset
          );
          ret.push(poolAdapter);
          expected.push(item.poolAdapterAddress);
        }

        expect(ret.join()).equal(expected.join());
      });
    });
  });

  describe("getPoolAdapterKey", () => {
    it("should return not zero", async () => {
      const borrowManager = await initializeApp();
      const key = await borrowManager.getPoolAdapterKey(
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address
      );
      const ret = key.eq(0);
      expect(ret).eq(false);
    });
  });

  describe("getAssetPairKey", () => {
    it("should return not zero", async () => {
      const borrowManager = await initializeApp();
      const key = await borrowManager.getAssetPairKey(
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
      );
      const ret = key.eq(0);
      expect(ret).eq(false);
    });
    it("should return same value for (A, B) and (B, A)", async () => {
      const borrowManager = await initializeApp();
      const address1 = ethers.Wallet.createRandom().address;
      const address2 = ethers.Wallet.createRandom().address;
      const ret12 = await borrowManager.getAssetPairKey(address1, address2);
      const ret21 = await borrowManager.getAssetPairKey(address2, address1);
      const ret = ret12.eq(ret21)
      expect(ret).eq(true);
    });
  });

  describe("getPoolAdaptersForUser", () => {
    describe("Good paths", () => {
      describe("Create N borrows for the user", () => {
        it("should return N pool adapters", async () => {
          const countBorrows = 3;
          const countUsers = 2;

          const borrowManager = await initializeApp();
          const controller = Controller__factory.connect(await borrowManager.controller(), signer);
          const tetuConverter = await controller.tetuConverter();
          const bmAsTc = BorrowManager__factory.connect(borrowManager.address,
            await DeployerUtils.startImpersonate(tetuConverter)
          );

          const users: string[] = [...Array(countUsers).keys()].map(x => ethers.Wallet.createRandom().address);

          const asset1 = ethers.Wallet.createRandom().address;
          const asset2 = ethers.Wallet.createRandom().address;

          const converters: string[] = [...Array(countBorrows).keys()].map(x => ethers.Wallet.createRandom().address);
          const platformAdapters = await Promise.all(
            converters.map(
              async converter => MocksHelper.createPlatformAdapterStub(signer, [converter])
            )
          );

          await Promise.all(
            platformAdapters.map(
              async platformAdapter => borrowManager.addAssetPairs(platformAdapter.address, [asset1], [asset2])
            )
          );

          for (const user of users) {
            await Promise.all(
              converters.map(
                async converter => bmAsTc.registerPoolAdapter(converter, user, asset1, asset2)
              )
            );
          }
          const ret = await Promise.all(
            users.map(
              async user => (await borrowManager.getPoolAdaptersForUser(user)).length
            )
          );
          const sret = ret.join();
          const sexpected = users.map(x => countBorrows).join();

          expect(sret).eq(sexpected);
        });
      });
      describe("User doesn't have any pool adapters", () => {
        it("should return 0", async () => {
          const countBorrows = 3;
          const countUsers = 2;

          const borrowManager = await initializeApp();
          const controller = Controller__factory.connect(await borrowManager.controller(), signer);
          const tetuConverter = await controller.tetuConverter();
          const bmAsTc = BorrowManager__factory.connect(borrowManager.address,
            await DeployerUtils.startImpersonate(tetuConverter)
          );

          const users: string[] = [...Array(countUsers).keys()].map(x => ethers.Wallet.createRandom().address);

          const asset1 = ethers.Wallet.createRandom().address;
          const asset2 = ethers.Wallet.createRandom().address;

          const converters: string[] = [...Array(countBorrows).keys()].map(x => ethers.Wallet.createRandom().address);
          const platformAdapters = await Promise.all(
            converters.map(
              async converter => MocksHelper.createPlatformAdapterStub(signer, [converter])
            )
          );

          await Promise.all(
            platformAdapters.map(
              async platformAdapter => borrowManager.addAssetPairs(platformAdapter.address, [asset1], [asset2])
            )
          );

          const ret = await Promise.all(
            users.map(
              async user => (await borrowManager.getPoolAdaptersForUser(user)).length
            )
          );
          const sret = ret.join();
          const sexpected = users.map(x => 0).join();

          expect(sret).eq(sexpected);
        });
      });
    });
  });
//endregion Unit tests

});