import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  BorrowManager,
  IPoolAdapter,
  IPoolAdapter__factory,
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
import {IBmInputParams, BorrowManagerHelper} from "../baseUT/helpers/BorrowManagerHelper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {generateAssetPairs, getAssetPair, IAssetPair} from "../baseUT/utils/AssetPairUtils";
import {Misc} from "../../scripts/utils/Misc";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";

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

    return {borrowManager: borrowManager, platformAdapter};
  }

  async function initializeApp(valueIsConverterInUse: boolean = false) : Promise<BorrowManager>{
    const controller = await CoreContractsHelper.createController(signer);
    const borrowManager = await CoreContractsHelper.createBorrowManager(signer, controller);
    const debtsMonitor = await MocksHelper.createDebtsMonitorStub(signer, valueIsConverterInUse);
    await controller.setBorrowManager(borrowManager.address);
    await controller.setDebtMonitor(debtsMonitor.address);
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
    const converters: string[] = [...Array(countConverters).keys()].map(x => ethers.Wallet.createRandom().address);
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
      assets: assets
    };
  }
//endregion Set up asset pairs

//region Unit tests
  describe("setHealthFactor", () => {
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
    });
    describe("Bad paths", () => {
      async function prepareBorrowManagerWithGivenHealthFactor(minHealthFactor2: number) : Promise<BorrowManager> {
        const controller = await CoreContractsHelper.createController(signer);
        await controller.setMinHealthFactor2(minHealthFactor2);
        return await CoreContractsHelper.createBorrowManager(signer, controller);
      }
      describe("Health factor is equal to min value", () => {
        it("should revert", async () => {
          const minHealthFactor = 120;
          const borrowManager = await prepareBorrowManagerWithGivenHealthFactor(minHealthFactor);
          await expect(
            borrowManager.setHealthFactor(ethers.Wallet.createRandom().address, minHealthFactor)
          ).revertedWith("TC-3");
        });
      });
      describe("Health factor is less then min value", () => {
        it("should revert", async () => {
          const minHealthFactor = 120;
          const borrowManager = await prepareBorrowManagerWithGivenHealthFactor(minHealthFactor);
          await expect(
            borrowManager.setHealthFactor(ethers.Wallet.createRandom().address, minHealthFactor - 1)
          ).revertedWith("TC-3");
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
            lenPlatformAdapters == 0 ? "" : await borrowManager.platformAdaptersAt(0),

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
          it("should success", async () => {
            const borrowManager = await initializeApp();
            // initialize platform adapter first time
            const r = await setUpSinglePlatformAdapterTestSet(borrowManager);

            // register the platform adapter with exactly same parameters second time
            await expect(
              borrowManager.addAssetPairs(
                r.platformAdapter
                , r.pairs.map(x => x.smallerAddress)
                , r.pairs.map(x => x.biggerAddress)
              )
            ).ok;
          });
        });
        describe("Add new asset pairs to exist platform adapter", () => {
          it("should success", async () => {
            const borrowManager = await initializeApp();
            // initialize platform adapter first time
            const r = await setUpSinglePlatformAdapterTestSet(borrowManager);
            const newAsset = ethers.Wallet.createRandom().address;

            // register the platform adapter with exactly same parameters second time
            await expect(
              borrowManager.addAssetPairs(
                r.platformAdapter
                , r.assets.map(x => newAsset)
                , r.assets.map(x => x)
              )
            ).ok;
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
          ).revertedWith("TC-35");

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
    async function makeTestTwoUnderlying(
      tt: IBmInputParams,
      sourceAmount: number,
      healthFactor: number,
      estimateGas: boolean = false
    ) : Promise<{
      outPoolIndex0: number;
      outApr36: BigNumber;
      outMaxTargetAmount: BigNumber;
      outGas?: BigNumber
    }> {
      // There are TWO underlyings: source, target
      const {bm, sourceToken, targetToken, pools}
        = await BorrowManagerHelper.createBmTwoUnderlyings(signer, tt);

      console.log("Source amount:", getBigNumberFrom(sourceAmount, await sourceToken.decimals()).toString());
      const ret = await bm.findConverter({
        sourceToken: sourceToken.address,
        sourceAmount: getBigNumberFrom(sourceAmount, await sourceToken.decimals()),
        targetToken: targetToken.address,
        healthFactor2: healthFactor * 100,
        periodInBlocks: 1
      });
      const gas = estimateGas
        ? await bm.estimateGas.findConverter({
          sourceToken: sourceToken.address,
          sourceAmount: getBigNumberFrom(sourceAmount, await sourceToken.decimals()),
          targetToken: targetToken.address,
          healthFactor2: healthFactor * 100,
          periodInBlocks: 1
        })
        : undefined;
      return {
        outPoolIndex0: pools.findIndex(x => x.converter == ret.converter),
        outApr36: ret.aprForPeriod36,
        outMaxTargetAmount: ret.maxTargetAmount,
        outGas: gas
      }
    }
    describe("Good paths", () => {
      describe("Several pools", () => {
        describe("Example 1: Pool 1 has a lowest borrow rate", () => {
          it("should return Pool 1 and expected amount", async () => {
            const bestBorrowRate = 27;
            const sourceAmount = 100_000;
            const healthFactor = 4;
            const input: IBmInputParams = {
              collateralFactor: 0.8,
              priceSourceUSD: 0.1,
              priceTargetUSD: 4,
              sourceDecimals: 24,
              targetDecimals: 12,
              availablePools: [
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate],
                  availableLiquidityInTokens: [0, 100] //not enough money
                },
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate], //best rate
                  availableLiquidityInTokens: [0, 2000] //enough cash
                },
                {   // source, target   -   pool 2 is the best
                  borrowRateInTokens: [0, bestBorrowRate+1], //the rate is worse
                  availableLiquidityInTokens: [0, 2000000000] //a lot of cash
                },
              ]
            };

            const ret = await makeTestTwoUnderlying(input, sourceAmount, healthFactor);
            const sret = [
              ret.outPoolIndex0,
              ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
              ethers.utils.formatUnits(ret.outApr36.div(Misc.WEI), input.targetDecimals)
            ].join();

            const sexpected = [
              1, //best pool
              "500.0", // Use https://docs.google.com/spreadsheets/d/1oLeF7nlTefoN0_9RWCuNc62Y7W72-Yk7/edit?usp=sharing&ouid=116979561535348539867&rtpof=true&sd=true
                       // to calculate expected amounts
              ethers.utils.formatUnits(getBigNumberFrom(bestBorrowRate, input.targetDecimals), input.targetDecimals)
            ].join();

            expect(sret).equal(sexpected);
          });
        });
        describe("Example 4: Pool 3 has a lowest borrow rate", () => {
          it("should return Pool 3 and expected amount", async () => {
            const bestBorrowRate = 270;
            const sourceAmount = 1000;
            const healthFactor = 1.6;
            const input: IBmInputParams = {
              collateralFactor: 0.9,
              priceSourceUSD: 2,
              priceTargetUSD: 0.5,
              sourceDecimals: 6,
              targetDecimals: 6,
              availablePools: [
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate],
                  availableLiquidityInTokens: [0, 100] //not enough money
                },
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate * 5], //too high borrow rate
                  availableLiquidityInTokens: [0, 2000] //enough cash
                },
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate], //the rate is best
                  availableLiquidityInTokens: [0, 2000] //enough cash
                },
                {   // source, target
                  borrowRateInTokens: [0, bestBorrowRate], //the rate is best
                  availableLiquidityInTokens: [0, 2000000000] //even more cash than in prev.pool
                },
                {   // source, target   -   pool 2 is the best
                  borrowRateInTokens: [0, bestBorrowRate+1], //the rate is not best
                  availableLiquidityInTokens: [0, 2000000000] //a lot of cash
                },
              ]
            };

            const ret = await makeTestTwoUnderlying(input, sourceAmount, healthFactor);
            const sret = [
              ret.outPoolIndex0,
              ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
              ethers.utils.formatUnits(ret.outApr36.div(Misc.WEI), input.targetDecimals)
            ].join();

            const sexpected = [
              3, //best pool
              "2250.0", // Use https://docs.google.com/spreadsheets/d/1oLeF7nlTefoN0_9RWCuNc62Y7W72-Yk7/edit?usp=sharing&ouid=116979561535348539867&rtpof=true&sd=true
              // to calculate expected amounts
              ethers.utils.formatUnits(getBigNumberFrom(bestBorrowRate, input.targetDecimals), input.targetDecimals)
            ].join();

            expect(sret).equal(sexpected);
          });
        });
        describe("All pools has same borrow rate", () => {
          it("should return Pool 0", async () => {
            const bestBorrowRate = 7;
            const sourceAmount = 10000;
            const healthFactor = 2.0;
            const input: IBmInputParams = {
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
                  borrowRateInTokens: [0, bestBorrowRate], //the rate is worse than in the pool 2
                  availableLiquidityInTokens: [0, 20000]
                },
                {   // source, target   -   pool 2 is the best
                  borrowRateInTokens: [0, bestBorrowRate],
                  availableLiquidityInTokens: [0, 40000]
                },
              ]
            };

            const ret = await makeTestTwoUnderlying(input, sourceAmount, healthFactor);
            const sret = [
              ret.outPoolIndex0,
              ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
              ethers.utils.formatUnits(ret.outApr36.div(Misc.WEI), input.targetDecimals)
            ].join();

            const sexpected = [
              0, //best pool
              "6250.0", // Use https://docs.google.com/spreadsheets/d/1oLeF7nlTefoN0_9RWCuNc62Y7W72-Yk7/edit?usp=sharing&ouid=116979561535348539867&rtpof=true&sd=true
                        // to calculate expected amounts
              ethers.utils.formatUnits(getBigNumberFrom(bestBorrowRate, input.targetDecimals), input.targetDecimals)
            ].join();

            expect(sret).equal(sexpected);
          });
        });
        describe("10 pools, each next pool is better then previous, estimate gas @skip-on-coverage", () => {
          async function checkGas(countPools: number): Promise<BigNumber> {
            const bestBorrowRate = 270;
            const sourceAmount = 100_000;
            const healthFactor = 4;
            const input: IBmInputParams = {
              collateralFactor: 0.8,
              priceSourceUSD: 0.1,
              priceTargetUSD: 4,
              sourceDecimals: 24,
              targetDecimals: 12,
              availablePools: [...Array(countPools).keys()].map(
                x => ({   // source, target
                  borrowRateInTokens: [0, bestBorrowRate - x], // next pool is better then previous
                  availableLiquidityInTokens: [0, 2000000] //enough money
                }),
              )
            };

            const ret = await makeTestTwoUnderlying(input
              , sourceAmount
              , healthFactor
              , true // we need to estimate gas
            );
            const sret = [
              ret.outPoolIndex0,
            ].join();

            const sexpected = [
              countPools - 1 //best pool
            ].join();

            console.log(`findPools: estimated gas for ${countPools} pools`, ret.outGas);
            return ret.outGas!;
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
    describe("Bad paths", () => {
      describe("Example 2. Pools have not enough liquidity", () => {
        it("should return all 0", async () => {
          const bestBorrowRate = 7;
          const sourceAmount = 100_000;
          const healthFactor = 4;
          const input: IBmInputParams = {
            collateralFactor: 0.5,
            priceSourceUSD: 0.5,
            priceTargetUSD: 0.2,
            sourceDecimals: 18,
            targetDecimals: 6,
            availablePools: [
              {   // source, target
                borrowRateInTokens: [0, bestBorrowRate],
                availableLiquidityInTokens: [0, 6249]
              },
              {   // source, target
                borrowRateInTokens: [0, bestBorrowRate], //the rate is worse than in the pool 2
                availableLiquidityInTokens: [0, 0]
              },
              {   // source, target   -   pool 2 is the best
                borrowRateInTokens: [0, bestBorrowRate],
                availableLiquidityInTokens: [0, 100]
              },
            ]
          };

          const ret = await makeTestTwoUnderlying(input, sourceAmount, healthFactor);
          const sret = [
            ret.outPoolIndex0,
            ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
            ethers.utils.formatUnits(ret.outApr36, input.targetDecimals)
          ].join();

          const sexpected = [-1, "0.0", "0.0"].join();

          expect(sret).equal(sexpected);
        });
      });
      describe("Example 3. Pools don't have enough liquidity", () => {
        it("should return all 0", async () => {
          const bestBorrowRate = 7;
          const sourceAmount = 100_000;
          const healthFactor = 4;
          const input: IBmInputParams = {
            collateralFactor: 0.5,
            priceSourceUSD: 0.5,
            priceTargetUSD: 0.2,
            sourceDecimals: 18,
            targetDecimals: 6,
            availablePools: [
              {   // source, target
                borrowRateInTokens: [0, bestBorrowRate - 1],
                availableLiquidityInTokens: [0, 100] //not enough money
              },
              {   // source, target
                borrowRateInTokens: [0, bestBorrowRate + 1], //the rate is worse than in the pool 2
                availableLiquidityInTokens: [0, 2000]
              },
              {   // source, target   -   pool 2 is the best
                borrowRateInTokens: [0, bestBorrowRate],
                availableLiquidityInTokens: [0, 2000]
              },
            ]
          };

          const ret = await makeTestTwoUnderlying(input, sourceAmount, healthFactor);
          const sret = [
            ret.outPoolIndex0,
            ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
            ethers.utils.formatUnits(ret.outApr36, input.targetDecimals)
          ].join();
          const sexpected = [-1, "0.0", "0.0"].join();

          expect(sret).equal(sexpected);
        });
      });
      it("should revert", async () => {
        //expect.fail();
      });
    });
  });

  describe("registerPoolAdapter", () => {
    describe("Good paths", () => {
      describe("Single platformAdapter + templatePoolAdapter", () => {
        it("should create instance of the required template contract", async () => {
          // create borrow manager (BM) with single pool
          const tt = BorrowManagerHelper.getBmInputParamsSinglePool();
          const {bm, sourceToken, targetToken, pools}
            = await BorrowManagerHelper.createBmTwoUnderlyings(signer, tt);

          // register pool adapter
          const converter = pools[0].converter;
          const user = ethers.Wallet.createRandom().address;
          const collateral = sourceToken.address;

          await bm.registerPoolAdapter(converter, user, collateral, targetToken.address);
          const poolAdapter = await bm.getPoolAdapter(converter, user, collateral, targetToken.address);

          // get data from the pool adapter
          const pa: IPoolAdapter = IPoolAdapter__factory.connect(
            poolAdapter, await DeployerUtils.startImpersonate(user)
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
    });
    describe("Bad paths", () => {
      describe("Wrong pool address", () => {
        it("should revert with template contract not found", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("getPlatformAdapter", () => {
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

  describe("isPoolAdapter", () => {
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

  describe("getPoolAdapter", () => {
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

  describe("Access to arrays", () => {
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