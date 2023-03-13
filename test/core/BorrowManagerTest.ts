import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  BorrowManager, BorrowManager__factory, Controller, Controller__factory, IBorrowManager__factory,
  IPoolAdapter,
  IPoolAdapter__factory, ITetuConverter__factory, LendingPlatformMock__factory
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
import {getExpectedApr18} from "../baseUT/apr/aprUtils";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {CoreContracts} from "../baseUT/types/CoreContracts";
import {parseUnits} from "ethers/lib/utils";
import {BalanceUtils} from "../baseUT/utils/BalanceUtils";

describe("BorrowManager", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let signer: SignerWithAddress;
  let user3: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];
    user3 = signers[4];
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

  async function createController(valueIsConverterInUse: boolean = false) : Promise<Controller> {
    return TetuConverterApp.createController(
      signer,
      {
        borrowManagerFabric: async c => (await CoreContractsHelper.createBorrowManager(signer, c.address)).address,
        tetuConverterFabric: async (
          c, borrowManager, debtMonitor, swapManager, keeper, priceOracle
        ) => (await CoreContractsHelper.createTetuConverter(
          signer,
          c.address,
          borrowManager,
          debtMonitor,
          swapManager,
          keeper,
          priceOracle
        )).address,
        debtMonitorFabric: async () => (await MocksHelper.createDebtsMonitorStub(signer, valueIsConverterInUse)).address,
        keeperFabric: async () => ethers.Wallet.createRandom().address,
        swapManagerFabric: async () => ethers.Wallet.createRandom().address,
        tetuLiquidatorAddress: ethers.Wallet.createRandom().address
      }
    );
  }
  async function initializeBorrowManager(valueIsConverterInUse: boolean = false) : Promise<BorrowManager>{
    const controller = await createController(valueIsConverterInUse);
    return BorrowManager__factory.connect(await controller.borrowManager(), controller.signer);
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
          async () => (await MocksHelper.createPoolAdapterMock(signer)).address
        )
    );
    const assets = [...Array(countAssets).keys()].map(() => ethers.Wallet.createRandom().address);

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
    outPoolIndices0: number[];
    outAprs18: BigNumber[];
    outAmountsToBorrow: BigNumber[];
    outCollateralAmounts: BigNumber[];
    outGas?: BigNumber;
    rewardsFactor: BigNumber;
    amountCollateralInBorrowAsset36: BigNumber;
  }
  interface IMakeTestFindConverterParams {
    setTinyMaxAmountToSupply?: boolean;
    targetHealthFactor?: number;
    estimateGas?: boolean;
    targetAssetToSearch?: string;
  }
  async function makeTestFindConverter(
    tt: IBorrowInputParams,
    sourceAmountNum: number,
    periodInBlocks: number,
    params?: IMakeTestFindConverterParams
  ) : Promise<IMakeTestFindConverterResults> {
    const core = await CoreContracts.build(await TetuConverterApp.createController(signer));
    const {sourceToken, targetToken, poolsInfo} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(core, signer, tt);

    if (params?.targetHealthFactor) {
      await core.controller.setMaxHealthFactor2(2 * params.targetHealthFactor * 100);
      await core.controller.setTargetHealthFactor2(params.targetHealthFactor * 100);
    }

    if (params?.setTinyMaxAmountToSupply) {
      for (const pi of poolsInfo) {
        await LendingPlatformMock__factory.connect(pi.platformAdapter, signer).setMaxAmountToSupply(
          sourceToken.address,
          BigNumber.from("1") // tiny amount
        );
      }
    }

    console.log("Source amount:", getBigNumberFrom(sourceAmountNum, await sourceToken.decimals()).toString());
    const ret = await core.bm.findConverter(
      "0x",
      sourceToken.address,
      params?.targetAssetToSearch || targetToken.address,
      getBigNumberFrom(sourceAmountNum, await sourceToken.decimals()),
      periodInBlocks,
    );
    const gas = params?.estimateGas
      ? await core.bm.estimateGas.findConverter(
        "0x",
        sourceToken.address,
        params?.targetAssetToSearch || targetToken.address,
        getBigNumberFrom(sourceAmountNum, await sourceToken.decimals()),
        periodInBlocks,
      )
      : undefined;

    return {
      outPoolIndices0: ret.convertersOut.map((c: string) => poolsInfo.findIndex(x => x.converter === c)),
      outAprs18: ret.aprs18Out,
      outAmountsToBorrow: ret.amountsToBorrowOut,
      outCollateralAmounts: ret.collateralAmountsOut,
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
    const core = await CoreContracts.build(await TetuConverterApp.createController(signer));
    const {sourceToken, targetToken, poolsInfo} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(core, signer, p);

    await core.bm.setRewardsFactor(rewardsFactor);

    // set up APR
    const platformAdapter = await LendingPlatformMock__factory.connect(poolsInfo[0].platformAdapter, signer);
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
    const r = await core.bm.findConverter(
      "0x",
      sourceToken.address,
      targetToken.address,
      sourceAmount,
      countBlocks,
    );

    return {
      apr18: r.aprs18Out[0], // best one
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

    const core = await CoreContracts.build(await TetuConverterApp.createController(signer));
    const {sourceToken, targetToken, poolsInfo} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(core, signer, tt);

    const tc = ITetuConverter__factory.connect(await core.controller.tetuConverter(), signer);
    const bmAsTc = BorrowManager__factory.connect(
      core.bm.address,
      await DeployerUtils.startImpersonate(tc.address)
    );

    // register pool adapter
    const converters = [poolsInfo[0].converter, poolsInfo[1].converter];
    const users = [...Array(countUsers).keys()].map(() => ethers.Wallet.createRandom().address);
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
        pools: poolsInfo
      }
    };
  }
//endregion registerPoolAdapter utils

//region Unit tests
  describe("constructor", () => {
    interface IMakeConstructorTestParams {
      rewardFactor?: BigNumber;
      useZeroController?: boolean;
    }
    async function makeConstructorTest(
      params?: IMakeConstructorTestParams
    ) : Promise<BorrowManager> {
      const controller = await TetuConverterApp.createController(
        signer,
        {
          borrowManagerFabric: async c => (await CoreContractsHelper.createBorrowManager(
            signer,
            params?.useZeroController ? Misc.ZERO_ADDRESS : c.address,
            params?.rewardFactor
          )).address,
          tetuConverterFabric: async () => ethers.Wallet.createRandom().address,
          debtMonitorFabric: async () => ethers.Wallet.createRandom().address,
          keeperFabric: async () => ethers.Wallet.createRandom().address,
          swapManagerFabric: async () => ethers.Wallet.createRandom().address,
          tetuLiquidatorAddress: ethers.Wallet.createRandom().address
        }
      );
      return BorrowManager__factory.connect(await controller.borrowManager(), signer);
    }
    describe("Good paths", () => {
      it("should return expected values", async () => {
        // we can call any function of BorrowManager to ensure that it was created correctly
        // let's check it using rewardFactor()

        const rewardFactor = parseUnits("0.5");
        const borrowManager = await makeConstructorTest({rewardFactor});
        const ret = await borrowManager.rewardsFactor();

        expect(ret.eq(rewardFactor)).eq(true);
      });
    });
    describe("Bad paths", () => {
      it("should revert if controller is zero", async () => {
        await expect(
          makeConstructorTest({useZeroController: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert if reward factor is too large", async () => {
        const tooLargeRewardFactor = parseUnits("1"); // BorrowManager.REWARDS_FACTOR_DENOMINATOR_18
        await expect(
          makeConstructorTest({rewardFactor: tooLargeRewardFactor})
        ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
      });
    });
  });

  describe("setTargetHealthFactors", () => {
    async function prepareBorrowManagerWithGivenHealthFactor(minHealthFactor2: number) : Promise<BorrowManager> {
      const controller = await createController();
      await controller.setMinHealthFactor2(minHealthFactor2);
      return CoreContractsHelper.createBorrowManager(signer, controller.address);
    }
    describe("Good paths", () => {
      describe("Set health factor for a single asset", () => {
        it("should set target health factor for the asset", async () => {
          const asset = ethers.Wallet.createRandom().address;
          const healthFactor = 400;

          const controller = await createController();
          const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), signer);

          const before = await borrowManager.targetHealthFactorsForAssets(asset);
          await borrowManager.setTargetHealthFactors([asset], [healthFactor]);
          const after = await borrowManager.targetHealthFactorsForAssets(asset);

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
            await borrowManager.setTargetHealthFactors([asset], [minHealthFactor]);

            const ret = await borrowManager.targetHealthFactorsForAssets(asset);

            expect(ret).equal(minHealthFactor);
          });
        });
      });
      describe("Set health factor for multiple assets", () => {
        it("should set target health factor for the assets", async () => {
          const asset1 = ethers.Wallet.createRandom().address;
          const asset2 = ethers.Wallet.createRandom().address;
          const healthFactor1 = 250;
          const healthFactor2 = 300;

          const controller = await createController();
          const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), signer);

          const before = [
            await borrowManager.targetHealthFactorsForAssets(asset1),
            await borrowManager.targetHealthFactorsForAssets(asset2),
          ].join();
          await borrowManager.setTargetHealthFactors(
            [asset1, asset2],
            [healthFactor1, healthFactor2]
          );
          const after = [
            await borrowManager.targetHealthFactorsForAssets(asset1),
            await borrowManager.targetHealthFactorsForAssets(asset2),
          ].join();

          const ret = [
            before,
            after
          ].join();

          const expected = [
            [0, 0].join(),
            [healthFactor1, healthFactor2].join()
          ].join();

          expect(ret).equal(expected);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Health factor is less then min value", () => {
        it("should revert", async () => {
          const minHealthFactor = 120;
          const borrowManager = await prepareBorrowManagerWithGivenHealthFactor(minHealthFactor);
          await expect(
            borrowManager.setTargetHealthFactors(
              [ethers.Wallet.createRandom().address],
              [minHealthFactor - 1]
            )
          ).revertedWith("TC-3 wrong health factor");
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
            bmAsNotGov.setTargetHealthFactors(
              [ethers.Wallet.createRandom().address],
              [minHealthFactor - 1]
            )
          ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
        });
      });
      describe("Wrong lengths", () => {
        it("should revert", async () => {
          const minHealthFactor = 120;
          const borrowManager = await prepareBorrowManagerWithGivenHealthFactor(minHealthFactor);
          await expect(
            borrowManager.setTargetHealthFactors(
              [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address],
              [minHealthFactor - 1]
            )
          ).revertedWith("TC-12 wrong lengths"); // WRONG_LENGTHS
        });
      });
    });

  });

  describe("setRewardsFactor", () => {
    describe("Good paths", () => {
      it("should set expected value", async () => {
        const rewardsFactor = getBigNumberFrom(9, 17);

        const controller = await createController();
        const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), signer);

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

          const controller = await createController();
          const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), signer);

          const bmAsNotGov = BorrowManager__factory.connect(
            borrowManager.address,
            await DeployerUtils.startImpersonate(user3.address)
          );
          await expect(
            bmAsNotGov.setRewardsFactor(rewardsFactor)
          ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
        });
        it("should revert if reward factor is too large", async () => {
          const tooLargeRewardFactor = parseUnits("1"); // BorrowManager.REWARDS_FACTOR_DENOMINATOR_18
          const controller = await createController();
          const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), signer);
          await expect(
            borrowManager.setRewardsFactor(tooLargeRewardFactor)
          ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
        });
      });
    });

  });

  describe("addAssetPairs", () => {
    describe("Good paths", () => {
      describe("Register single platform adapter first time", () => {
        it("should set borrow manager to expected state", async () => {
          const borrowManager = await initializeBorrowManager();
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

            [...Array(r.pairs.length).keys()].map(() => r.platformAdapter).join(";")
          ].join("\n");

          expect(ret).equal(expected);
        });

        describe("Register same platform adapter second time", () => {
          it("should not throw exception", async () => {
            const borrowManager = await initializeBorrowManager();
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
            const borrowManager = await initializeBorrowManager();
            // initialize platform adapter first time
            const r = await setUpSinglePlatformAdapterTestSet(borrowManager);
            const newAsset = ethers.Wallet.createRandom().address;

            // register the platform adapter with exactly same parameters second time
            const cr = await (await borrowManager.addAssetPairs(
                r.platformAdapter
                , r.assets.map(() => newAsset)
                , r.assets.map(x => x)
            )).wait();
            expect(cr.status).eq(1); // we don't have any exception
          });
        });
      });
      describe("Register several platform adapters", () => {
        describe("Set up three pairs", () => {
          it("should setup pairsList correctly", async () => {
            const borrowManager = await initializeBorrowManager();
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
            const borrowManager = await initializeBorrowManager();
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
            const borrowManager = await initializeBorrowManager();
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
            const borrowManager = await initializeBorrowManager();
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
          const borrowManager = await initializeBorrowManager();
          const platformAdapter = await MocksHelper.createPlatformAdapterStub(signer,
            [ethers.Wallet.createRandom().address]
          );

          await expect(
            borrowManager.addAssetPairs(
              platformAdapter.address
              , [ethers.Wallet.createRandom().address]
              , [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address]
            )
          ).revertedWith("TC-12 wrong lengths")
        });
      });
      describe("Converter is used by two platform adapters", () => {
        it("should revert", async () => {
          const borrowManager = await initializeBorrowManager();
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
          ).revertedWith("TC-37 one platform adapter per conv");

        });
      });
    });
  });

  describe("removeAssetPairs", () => {
    describe("Good paths", () => {
      describe("Register single pool", () => {
        describe("Remove all asset pairs", () => {
          it("should completely unregister the platform adapter", async () => {
            const borrowManager = await initializeBorrowManager();
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
            const borrowManager = await initializeBorrowManager(isConverterInUse);
            const r = await setUpSinglePlatformAdapterTestSet(borrowManager,
              1, // single converter
              3, // three assets (3 pairs)
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
          const borrowManager = await initializeBorrowManager();
          const platformAdapterNotExist = ethers.Wallet.createRandom().address;
          const r = await setUpSinglePlatformAdapterTestSet(borrowManager);

          await expect(
            borrowManager.removeAssetPairs(
              platformAdapterNotExist,
              r.pairs.map(x => x.smallerAddress),
              r.pairs.map(x => x.biggerAddress)
            )
          ).revertedWith("TC-6 platform adapter not found"); // PLATFORM_ADAPTER_NOT_FOUND
        });
      });
      describe("Wrong lengths", () => {
        it("should revert", async () => {
          const borrowManager = await initializeBorrowManager();
          const r = await setUpSinglePlatformAdapterTestSet(borrowManager);

          await expect(
            borrowManager.removeAssetPairs(
              r.platformAdapter,
              r.pairs.map(x => x.smallerAddress).slice(-1), // (!) incorrect length
              r.pairs.map(x => x.biggerAddress)
            )
          ).revertedWith("TC-12 wrong lengths"); // WRONG_LENGTHS
        });
      });
      describe("Converter is in use", () => {
        it("should revert", async () => {
          const isConverterInUse = true;
          const borrowManager = await initializeBorrowManager(isConverterInUse);
          const r = await setUpSinglePlatformAdapterTestSet(borrowManager);

          await expect(
            borrowManager.removeAssetPairs(
              r.platformAdapter,
              r.pairs.map(x => x.smallerAddress),
              r.pairs.map(x => x.biggerAddress)
            )
          ).revertedWith("TC-33 platform adapter is in use"); // PLATFORM_ADAPTER_IS_IN_USE
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

            const ret = await makeTestFindConverter(p, sourceAmount, period, {targetHealthFactor});
            console.log(ret);
            const sret = [
              ret.outPoolIndices0[0],
              ethers.utils.formatUnits(ret.outAmountsToBorrow[0], p.targetDecimals),
              ethers.utils.formatUnits(ret.outCollateralAmounts[0], p.sourceDecimals),
              ethers.utils.formatUnits(ret.outAprs18[0], p.targetDecimals)
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
              ethers.utils.formatUnits(parseUnits(sourceAmount.toString(), p.sourceDecimals), p.sourceDecimals),
              ethers.utils.formatUnits(expectedApr18, p.targetDecimals),
            ].join();

            expect(sret).equal(sexpected);
          });
        });
        describe("Example 4: Pool 3 has a lowest borrow rate", () => {
          interface IExample4Results {
            poolIndices0: number[];
            amountsToBorrowOut: string[];
            collateralAmountsOut: string[];
            aprs18: string[];
            expectedApr18: string[];
            input: IBorrowInputParams;
          }

          async function makeExample4Test(params?: IMakeTestFindConverterParams): Promise<IExample4Results> {
            const bestBorrowRate = 270;
            const sourceAmount = 1000;
            const period = 1;
            const availablePools = [
              {   // source, target
                borrowRateInTokens: [0, bestBorrowRate],
                availableLiquidityInTokens: [0, 100] // not enough money
              },
              {   // source, target
                borrowRateInTokens: [0, bestBorrowRate * 5], // too high borrow rate
                availableLiquidityInTokens: [0, 2250] // enough cash
              },
              {   // source, target
                borrowRateInTokens: [0, bestBorrowRate], // the rate is best
                availableLiquidityInTokens: [0, 2250] // enough cash
              },
              {   // source, target
                borrowRateInTokens: [0, bestBorrowRate], // the rate is best
                availableLiquidityInTokens: [0, 2000000000] // even more cash than in prev.pool
              },
              {   // source, target   -   pool 2 is the best
                borrowRateInTokens: [0, bestBorrowRate+1], // the rate is not best
                availableLiquidityInTokens: [0, 2000000000] // a lot of cash
              },
            ];
            const input: IBorrowInputParams = {
              collateralFactor: 0.9,
              priceSourceUSD: 2,
              priceTargetUSD: 0.5,
              sourceDecimals: 6,
              targetDecimals: 6,
              availablePools
            };

            const ret = await makeTestFindConverter(
              input,
              sourceAmount,
              period,
              params
            );
            return {
              poolIndices0: ret.outPoolIndices0,
              amountsToBorrowOut: ret.outAmountsToBorrow.map(x => ethers.utils.formatUnits(x, input.targetDecimals)),
              collateralAmountsOut: ret.outCollateralAmounts.map(x => ethers.utils.formatUnits(x, input.sourceDecimals)),
              aprs18: ret.outAprs18.map(x => ethers.utils.formatUnits(x, 18)),
              expectedApr18: ret.outPoolIndices0.map(
                index => ethers.utils.formatUnits(
                  getExpectedApr18(
                    getBigNumberFrom(availablePools[index].borrowRateInTokens[1] * period, 36),
                    BigNumber.from(0),
                    BigNumber.from(0),
                    ret.amountCollateralInBorrowAsset36,
                    ret.rewardsFactor
                  )
                ),
                18
              ),
              input
            };
          }

          it("should return Pool 3 and expected amount", async () => {
            const r = await makeExample4Test({targetHealthFactor: 1.6});
            const sret = [
              r.poolIndices0.map(x => BalanceUtils.toString(x)).join("\n"),
              r.amountsToBorrowOut.map(x => BalanceUtils.toString(x)).join("\n"),
              r.collateralAmountsOut.map(x => BalanceUtils.toString(x)).join("\n"),
              r.aprs18.map(x => BalanceUtils.toString(x)).join("\n"),
            ].join("\n");

            const collateralAmount = "1000.0";
            const expectedAmountToBorrow = "2250.0"; // Use https://docs.google.com/spreadsheets/d/1oLeF7nlTefoN0_9RWCuNc62Y7W72-Yk7/edit?usp=sharing&ouid=116979561535348539867&rtpof=true&sd=true

            const sexpected = [
              [2, 3, 4, 1].map(x => BalanceUtils.toString(x)).join("\n"), // best pool
              [expectedAmountToBorrow, expectedAmountToBorrow, expectedAmountToBorrow, expectedAmountToBorrow].map(x => BalanceUtils.toString(x)).join("\n"),
              [collateralAmount, collateralAmount, collateralAmount, collateralAmount].map(x => BalanceUtils.toString(x)).join("\n"),
              r.expectedApr18.map(x => BalanceUtils.toString(x)).join("\n"), // best pool
            ].join("\n");

            expect(sret).equal(sexpected);
          });
          it("should not find pool if all pools have too small max allowed amount to supply", async () => {
            const r = await makeExample4Test({setTinyMaxAmountToSupply: true});
            expect(r.poolIndices0.length === 0).eq(true);
          });
          it("should not find a pool for different target asset", async () => {
            const r = await makeExample4Test({targetAssetToSearch: ethers.Wallet.createRandom().address});
            expect(r.poolIndices0.length === 0).eq(true);
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
              ret.outPoolIndices0.join(),
              ret.outAmountsToBorrow.map(x => ethers.utils.formatUnits(x, input.targetDecimals)),
              ret.outCollateralAmounts.map(x => ethers.utils.formatUnits(x, input.sourceDecimals)),
              ret.outAprs18.map(x => ethers.utils.formatUnits(x, 18)),
            ].join("\n");

            const expectedApr18 = ethers.utils.formatUnits(getExpectedApr18(
              getBigNumberFrom(bestBorrowRate * period, 36),
              BigNumber.from(0),
              BigNumber.from(0),
              ret.amountCollateralInBorrowAsset36,
              ret.rewardsFactor
            ), 18);
            const expectedCollateralAmount = ethers.utils.formatUnits(parseUnits(sourceAmount.toString(), input.sourceDecimals), input.sourceDecimals);
            const sexpected = [
              [0, 1, 2], // best pool
              // Use https://docs.google.com/spreadsheets/d/1oLeF7nlTefoN0_9RWCuNc62Y7W72-Yk7/edit?usp=sharing&ouid=116979561535348539867&rtpof=true&sd=true to calculate expected amounts
              ["6250.0", "6250.0", "6250.0"],
              [expectedCollateralAmount, expectedCollateralAmount, expectedCollateralAmount],
              [expectedApr18, expectedApr18, expectedApr18],
            ].join("\n");

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

          const ret = await makeTestFindConverter(input, sourceAmount, period, {targetHealthFactor});
          const sret = [
            ret.outPoolIndices0.length === 0 ? -1 : ret.outPoolIndices0[0],
            ethers.utils.formatUnits(
              ret.outPoolIndices0.length === 0
                ? BigNumber.from(0)
                : ret.outAmountsToBorrow[0],
              input.targetDecimals
            ),
            ethers.utils.formatUnits(
              ret.outPoolIndices0.length === 0
                ? BigNumber.from(0)
                : ret.outCollateralAmounts[0],
              input.targetDecimals
            ),
            ethers.utils.formatUnits(
              ret.outPoolIndices0.length === 0
                ? BigNumber.from(0)
                : ret.outAprs18[0],
              input.targetDecimals
            ),
          ].join();

          const sexpected = [-1, "0.0", "0.0", "0.0"].join();

          expect(sret).equal(sexpected);
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      describe("10 pools, each next pool is better previous one, estimate gas", () => {
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
            period,
            {targetHealthFactor: healthFactor, estimateGas: true} // we need to estimate gas
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
          const core = await CoreContracts.build(await TetuConverterApp.createController(signer));
          const {sourceToken, targetToken, poolsInfo} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(core, signer, tt);

          // register pool adapter
          const converter = poolsInfo[0].converter;
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
            poolsInfo[0].converter,
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
          const core = await CoreContracts.build(await TetuConverterApp.createController(signer));
          const {sourceToken, targetToken} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(core, signer, tt);

          const bmAsTc = IBorrowManager__factory.connect(
            core.bm.address,
            await DeployerUtils.startImpersonate(core.tc.address)
          );

          const converter = ethers.Wallet.createRandom().address; // (!)
          const user = ethers.Wallet.createRandom().address;
          const collateral = sourceToken.address;

          await expect(
            bmAsTc.registerPoolAdapter(converter, user, collateral, targetToken.address)
          ).revertedWith("TC-6 platform adapter not found"); // PLATFORM_ADAPTER_NOT_FOUND
        });
      });
      describe("Not TetuConverter", () => {
        it("should revert", async () => {
          const tt = BorrowManagerHelper.getBmInputParamsSinglePool();
          const core = await CoreContracts.build(await TetuConverterApp.createController(signer));
          const {sourceToken, targetToken, poolsInfo} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(core, signer, tt);

          const bmAsNotTc = IBorrowManager__factory.connect(core.bm.address, signer);

          const converter = poolsInfo[0].converter;
          const user = ethers.Wallet.createRandom().address;
          const collateral = sourceToken.address;

          await expect(
            bmAsNotTc.registerPoolAdapter(converter, user, collateral, targetToken.address)
          ).revertedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
        });
      });
    });
  });

  describe("getPlatformAdapter", () => {
    describe("Good paths", () => {
      it("should return expected platform adapter", async () => {
        const borrowManager = await initializeBorrowManager();
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

          await registerPoolAdapters(bmAsTc,
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
          const borrowManager = await initializeBorrowManager();
          await expect(
            borrowManager.getPlatformAdapter(ethers.Wallet.createRandom().address)
          ).revertedWith("TC-6 platform adapter not found"); // PLATFORM_ADAPTER_NOT_FOUND
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
          [...Array(r.out.length).keys()].map(() => true)
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
      const borrowManager = await initializeBorrowManager();
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
      const borrowManager = await initializeBorrowManager();
      const key = await borrowManager.getAssetPairKey(
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
      );
      const ret = key.eq(0);
      expect(ret).eq(false);
    });
    it("should return same value for (A, B) and (B, A)", async () => {
      const borrowManager = await initializeBorrowManager();
      const address1 = ethers.Wallet.createRandom().address;
      const address2 = ethers.Wallet.createRandom().address;
      const ret12 = await borrowManager.getAssetPairKey(address1, address2);
      const ret21 = await borrowManager.getAssetPairKey(address2, address1);
      const ret = ret12.eq(ret21)
      expect(ret).eq(true);
    });
  });

  describe("markPoolAdapterAsDirty", () => {
    describe("Good paths", () => {
      describe("Create two pool adapters, mark first one as dirty", () => {
        async function makeMarkPoolAdapterAsDirtyTest(
          signerIsTetuConverter: boolean
        ) : Promise<{ret: string, expected: string}> {
          const r = await getUniquePoolAdaptersForTwoPoolsAndTwoPairs(1);
          const pa1 = r.out[0].initConfig;
          const pa2 = r.out[1].initConfig;

          const before1 = await r.app.borrowManager.getPoolAdapter(pa1.originConverter, pa1.user, pa1.collateralAsset, pa1.borrowAsset);
          const before2 = await r.app.borrowManager.getPoolAdapter(pa2.originConverter, pa2.user, pa2.collateralAsset, pa2.borrowAsset);

          const borrowManagerAsSigner = IBorrowManager__factory.connect(
            r.app.borrowManager.address,
            await DeployerUtils.startImpersonate(
              signerIsTetuConverter
                ? await r.app.controller.tetuConverter()
                : await r.app.controller.debtMonitor()
            )
          );
          await borrowManagerAsSigner.markPoolAdapterAsDirty(pa1.originConverter, pa1.user, pa1.collateralAsset, pa1.borrowAsset);

          const after1 = await r.app.borrowManager.getPoolAdapter(pa1.originConverter, pa1.user, pa1.collateralAsset, pa1.borrowAsset);
          const after2 = await r.app.borrowManager.getPoolAdapter(pa2.originConverter, pa2.user, pa2.collateralAsset, pa2.borrowAsset);

          const ret = [
            before1 === r.out[0].poolAdapterAddress,
            before2 === r.out[1].poolAdapterAddress,
            after1 === Misc.ZERO_ADDRESS,
            after2 === r.out[1].poolAdapterAddress,
          ].join();
          const expected = [true, true, true, true].join();

          return {ret, expected};
        }
        describe("should exclude first pool adapter from list of ready-to-borrow adapters", () => {
          it("sign as TetuConverter", async () => {
            const r = await makeMarkPoolAdapterAsDirtyTest(true);
            expect(r.ret).eq(r.expected);
          });
          it("sign as DebtMonitors", async () => {
            const r = await makeMarkPoolAdapterAsDirtyTest(false);
            expect(r.ret).eq(r.expected);
          });
        })
        it("should not change isPoolAdapter behavior", async () => {
          const r = await getUniquePoolAdaptersForTwoPoolsAndTwoPairs(1);
          const pa1 = r.out[0].initConfig;

          const before1 = await r.app.borrowManager.isPoolAdapter(r.out[0].poolAdapterAddress);
          const before2 = await r.app.borrowManager.isPoolAdapter(r.out[1].poolAdapterAddress);

          const borrowManagerAsTetuConverter = IBorrowManager__factory.connect(
            r.app.borrowManager.address,
            await DeployerUtils.startImpersonate(await r.app.controller.tetuConverter())
          );
          await borrowManagerAsTetuConverter.markPoolAdapterAsDirty(pa1.originConverter, pa1.user, pa1.collateralAsset, pa1.borrowAsset);

          const after1 = await r.app.borrowManager.isPoolAdapter(r.out[0].poolAdapterAddress);
          const after2 = await r.app.borrowManager.isPoolAdapter(r.out[1].poolAdapterAddress);

          const ret = [before1, before2, after1, after2].join();
          const expected = [true, true, true, true].join();

          expect(ret).eq(expected);
        });
        it("should not change poolAdaptersRegistered behavior", async () => {
          const r = await getUniquePoolAdaptersForTwoPoolsAndTwoPairs(1);
          const pa1 = r.out[0].initConfig;

          const before1 = await r.app.borrowManager.poolAdaptersRegistered(r.out[0].poolAdapterAddress);
          const before2 = await r.app.borrowManager.poolAdaptersRegistered(r.out[1].poolAdapterAddress);

          const borrowManagerAsTetuConverter = IBorrowManager__factory.connect(
            r.app.borrowManager.address,
            await DeployerUtils.startImpersonate(await r.app.controller.tetuConverter())
          );
          await borrowManagerAsTetuConverter.markPoolAdapterAsDirty(pa1.originConverter, pa1.user, pa1.collateralAsset, pa1.borrowAsset);

          const after1 = await r.app.borrowManager.poolAdaptersRegistered(r.out[0].poolAdapterAddress);
          const after2 = await r.app.borrowManager.poolAdaptersRegistered(r.out[1].poolAdapterAddress);

          const ret = [before1, before2, after1, after2].join();
          const expected = [true, true, true, true].join();

          expect(ret).eq(expected);
        });
      });
    });
    describe("Bad paths", () => {
      it("pool adapter not found", async () => {
        const r = await getUniquePoolAdaptersForTwoPoolsAndTwoPairs(1);
        const pa1 = r.out[0].initConfig;
        const incorrectUser = ethers.Wallet.createRandom().address;
        const borrowManagerAsTetuConverter = IBorrowManager__factory.connect(
          r.app.borrowManager.address,
          await DeployerUtils.startImpersonate(await r.app.controller.tetuConverter())
        );
        await expect(
          borrowManagerAsTetuConverter.markPoolAdapterAsDirty(pa1.originConverter,
              incorrectUser, // (!)
              pa1.collateralAsset,
              pa1.borrowAsset
          )
        ).revertedWith("TC-2 adapter not found"); // POOL_ADAPTER_NOT_FOUND
      });
      it("try to mark as dirty the same pool adapters second time", async () => {
        const r = await getUniquePoolAdaptersForTwoPoolsAndTwoPairs(1);
        const pa1 = r.out[0].initConfig;
        const borrowManagerAsTetuConverter = IBorrowManager__factory.connect(
          r.app.borrowManager.address,
          await DeployerUtils.startImpersonate(await r.app.controller.tetuConverter())
        );
        await borrowManagerAsTetuConverter.markPoolAdapterAsDirty(pa1.originConverter, pa1.user, pa1.collateralAsset, pa1.borrowAsset);
        await expect(
          borrowManagerAsTetuConverter.markPoolAdapterAsDirty(pa1.originConverter, pa1.user, pa1.collateralAsset, pa1.borrowAsset)
        ).revertedWith("TC-2 adapter not found"); // POOL_ADAPTER_NOT_FOUND
      });
      it("should revert if the sender is not TetuConverter and not DebtMonitor", async () => {
        const r = await getUniquePoolAdaptersForTwoPoolsAndTwoPairs(1);
        const pa1 = r.out[0].initConfig;
        const borrowManagerAsNotTetuConverter = IBorrowManager__factory.connect(
          r.app.borrowManager.address,
          await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
        );
        await expect(
          borrowManagerAsNotTetuConverter.markPoolAdapterAsDirty(pa1.originConverter, pa1.user, pa1.collateralAsset, pa1.borrowAsset)
        ).revertedWith("TC-48 access denied"); // ACCESS_DENIED
      });
    });
  });

  describe("getTargetHealthFactor2", () => {
    it("should return target factor for the given asset", async () => {
      const asset = ethers.Wallet.createRandom().address;
      const healthFactorForAsset = 207;
      const defaultTargetHealthFactor = 217;

      const controller = await createController();
      const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), signer);

      await controller.setTargetHealthFactor2(defaultTargetHealthFactor);
      await borrowManager.setTargetHealthFactors([asset], [healthFactorForAsset]);

      const ret = await borrowManager.getTargetHealthFactor2(asset);

      expect(ret).equal(healthFactorForAsset);
    });
    it("should return default value if there is not specific value for the given asset", async () => {
      const asset = ethers.Wallet.createRandom().address;
      const defaultTargetHealthFactor = 217;

      const controller = await createController();
      const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), signer);

      await controller.setTargetHealthFactor2(defaultTargetHealthFactor);
      const targetFactorForAsset = await borrowManager.targetHealthFactorsForAssets(asset);

      const ret = [
        targetFactorForAsset,
        await borrowManager.getTargetHealthFactor2(asset)
      ].map(x => BalanceUtils.toString(x)).join("\n");

      const expected = [
        0,
        defaultTargetHealthFactor
      ].map(x => BalanceUtils.toString(x)).join("\n");

      expect(ret).equal(expected);
    });
  });

  describe("events", () => {
    it("should emit expected events (check all except OnRemoveAssetPairs)", async () => {
      const controller = await TetuConverterApp.createController(
        signer, {
          borrowManagerFabric: async c => (await CoreContractsHelper.createBorrowManager(signer, c.address)).address,
          tetuConverterFabric: async () => ethers.Wallet.createRandom().address,
          debtMonitorFabric: async () => ethers.Wallet.createRandom().address,
          keeperFabric: async () => ethers.Wallet.createRandom().address,
          swapManagerFabric: async () => ethers.Wallet.createRandom().address,
          tetuLiquidatorAddress: ethers.Wallet.createRandom().address
      });
      const borrowManagerAdGov = BorrowManager__factory.connect(
        await controller.borrowManager(),
        await DeployerUtils.startImpersonate(await controller.governance())
      );
      const borrowManagerAdTetuConverter = BorrowManager__factory.connect(
        await controller.borrowManager(),
        await DeployerUtils.startImpersonate(await controller.tetuConverter())
      );

      const converter = ethers.Wallet.createRandom().address;
      const user = ethers.Wallet.createRandom().address;
      const platformAdapter = (await MocksHelper.createPlatformAdapterStub(signer, [converter])).address;
      const left = (await MocksHelper.createMockedCToken(signer)).address;
      const right = (await MocksHelper.createMockedCToken(signer)).address;

      await expect(
        borrowManagerAdGov.addAssetPairs(platformAdapter, [left], [right])
      ).to.emit(borrowManagerAdGov, "OnAddAssetPairs").withArgs(platformAdapter, [left], [right]);

      await expect(
        borrowManagerAdGov.setRewardsFactor(parseUnits("0.1"))
      ).to.emit(borrowManagerAdGov, "OnSetRewardsFactor").withArgs(parseUnits("0.1"));

      await expect(
        borrowManagerAdGov.setTargetHealthFactors([left, right], [205, 200])
      ).to.emit(borrowManagerAdGov, "OnSetTargetHealthFactors").withArgs([left, right], [205, 200]);

      await expect(
        borrowManagerAdGov.setRewardsFactor(parseUnits("0.1"))
      ).to.emit(borrowManagerAdGov, "OnSetRewardsFactor").withArgs(parseUnits("0.1"));

      await expect(
        borrowManagerAdTetuConverter.registerPoolAdapter(converter, user, left, right)
      ).to.emit(borrowManagerAdGov, "OnRegisterPoolAdapter").withArgs(anyValue, converter, user, left, right);

      const poolAdapter = await borrowManagerAdTetuConverter.getPoolAdapter(converter, user, left, right)
      await expect(
        borrowManagerAdTetuConverter.markPoolAdapterAsDirty(converter, user, left, right)
      ).to.emit(borrowManagerAdGov, "OnMarkPoolAdapterAsDirty").withArgs(poolAdapter);
    });

    it("should emit expected events", async () => {
      const controller = await TetuConverterApp.createController(
        signer, {
          borrowManagerFabric: async c => (await CoreContractsHelper.createBorrowManager(signer, c.address)).address,
          tetuConverterFabric: async () => ethers.Wallet.createRandom().address,
          debtMonitorFabric: async () => (await MocksHelper.createDebtsMonitorStub(signer, false)).address,
          keeperFabric: async () => ethers.Wallet.createRandom().address,
          swapManagerFabric: async () => ethers.Wallet.createRandom().address,
          tetuLiquidatorAddress: ethers.Wallet.createRandom().address
        });
      const borrowManagerAdGov = BorrowManager__factory.connect(
        await controller.borrowManager(),
        await DeployerUtils.startImpersonate(await controller.governance())
      );

      const converter = ethers.Wallet.createRandom().address;
      const platformAdapter = (await MocksHelper.createPlatformAdapterStub(signer, [converter])).address;
      const left1 = (await MocksHelper.createMockedCToken(signer)).address;
      const left2 = (await MocksHelper.createMockedCToken(signer)).address;
      const right1 = (await MocksHelper.createMockedCToken(signer)).address;
      const right2 = (await MocksHelper.createMockedCToken(signer)).address;

      await borrowManagerAdGov.addAssetPairs(platformAdapter, [left1, left2], [right1, right2]);

      await expect(
        borrowManagerAdGov.removeAssetPairs(platformAdapter, [left1], [right1])
      ).to.emit(borrowManagerAdGov, "OnRemoveAssetPairs").withArgs(platformAdapter, [left1], [right1]);

      await expect(
        borrowManagerAdGov.removeAssetPairs(platformAdapter, [left2], [right2])
      ).to.emit(borrowManagerAdGov, "OnRemoveAssetPairs").withArgs(platformAdapter, [left2], [right2])
       .to.emit(borrowManagerAdGov, "OnUnregisterPlatformAdapter").withArgs(platformAdapter)
    });
  });
//endregion Unit tests

})