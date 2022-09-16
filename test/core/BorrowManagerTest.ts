import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BorrowManager, PlatformAdapterStub, PriceOracleMock} from "../../typechain";
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
import {generateAssetPairs, IAssetPair} from "../baseUT/utils/AssetPairUtils";
import {Misc} from "../../scripts/utils/Misc";

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
    bm: BorrowManager,
    platformAdapter: PlatformAdapterStub
  }>{
    const controller = await CoreContractsHelper.createController(signer);
    const bm = await CoreContractsHelper.createBorrowManager(signer, controller);
    const dm = await MocksHelper.createDebtsMonitorStub(signer, false);
    await controller.setBorrowManager(bm.address);
    await controller.setDebtMonitor(dm.address);

    const platformAdapter = await MocksHelper.createPlatformAdapterStub(signer, converters);

    // generate all possible pairs of underlying
    await bm.addAssetPairs(
      platformAdapter.address
      , pairs.map(x => x.smallerAddress)
      , pairs.map(x => x.biggerAddress)
    );

    return {bm, platformAdapter};
  }
//endregion Utils

//region Unit tests
  describe("addAssetPairs", () => {
    describe("Good paths", () => {
      describe("Register single pool", () => {
        it("should set BM to expected state", async () => {
          const converters: string[] = [
            ethers.Wallet.createRandom().address
            , ethers.Wallet.createRandom().address
          ];
          const underlying = [
            ethers.Wallet.createRandom().address
            , ethers.Wallet.createRandom().address
            , ethers.Wallet.createRandom().address
            , ethers.Wallet.createRandom().address
          ];
          const pairs = generateAssetPairs(underlying).sort(
            (x, y) => (x.smallerAddress + x.biggerAddress).localeCompare(y.smallerAddress + y.biggerAddress)
          );
          const {bm, platformAdapter} = await initializeAssetPairs(converters, pairs);
          const registeredPairs = await getAllRegisteredPairs(bm, platformAdapter.address);
          const lenPlatformAdapters = (await bm.platformAdaptersLength()).toNumber()

          const ret = [
            lenPlatformAdapters,
            lenPlatformAdapters == 0 ? "" : await bm.platformAdaptersAt(0),

            registeredPairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),

            (await getPairsList(bm, pairs)).join(";")
          ].join("\n");

          const expected = [
            1,
            platformAdapter.address,

            pairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),

            [...Array(pairs.length).keys()].map(x => platformAdapter.address).join(";")
          ].join("\n");

          expect(ret).equal(expected);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Wrong lengths", () => {
        it("should revert with WRONG_LENGTHS", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("removeAssetPairs", () => {
    describe("Good paths", () => {
      describe("Register single pool", () => {
        describe("Remove all asset pairs", () => {
          it("should completely remove pool from BM", async () => {
            const converters: string[] = [
              ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
            ];
            const underlying = [
              ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
            ];
            const pairs = generateAssetPairs(underlying).sort(
              (x, y) => (x.smallerAddress + x.biggerAddress).localeCompare(y.smallerAddress + y.biggerAddress)
            );
            const {bm, platformAdapter} = await initializeAssetPairs(converters, pairs);

            await bm.removeAssetPairs(
              platformAdapter.address
              , pairs.map(x => x.smallerAddress)
              , pairs.map(x => x.biggerAddress)
            );

            const registeredPairs = await getAllRegisteredPairs(bm, platformAdapter.address);
            const foundPlatformAdapters = await getPairsList(bm, pairs);
            const lenPlatformAdapters = (await bm.platformAdaptersLength()).toNumber()

            const ret = [
              lenPlatformAdapters,

              registeredPairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),

              (await getPairsList(bm, pairs)).join(";")
            ].join("\n");

            const expected = [
              0,
              "",
              "",
            ].join("\n");

            expect(ret).equal(expected);
          });
        });
        describe("Remove single asset pair", () => {
          it("should set BM to expected state", async () => {
            const converters: string[] = [
              ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
            ];
            const underlying = [
              ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
            ];
            const pairs = generateAssetPairs(underlying).sort(
              (x, y) => (x.smallerAddress + x.biggerAddress).localeCompare(y.smallerAddress + y.biggerAddress)
            );
            const {bm, platformAdapter} = await initializeAssetPairs(converters, pairs);

            // remove last pair only
            const pairToRemove = pairs.pop();
            if (pairToRemove) {
              await bm.removeAssetPairs(
                platformAdapter.address
                , [pairToRemove.smallerAddress]
                , [pairToRemove.biggerAddress]
              );
            }

            const registeredPairs = await getAllRegisteredPairs(bm, platformAdapter.address);
            const lenPlatformAdapters = (await bm.platformAdaptersLength()).toNumber();

            const ret = [
              !!pairToRemove,

              lenPlatformAdapters,
              lenPlatformAdapters == 0 ? "" : await bm.platformAdaptersAt(0),

              registeredPairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),

              (await getPairsList(bm, pairs)).join(";")
            ].join("\n");

            const expected = [
              true,

              1,
              platformAdapter.address,

              pairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),

              [...Array(pairs.length).keys()].map(x => platformAdapter.address).join(";")
            ].join("\n");

            expect(ret).equal(expected);
          });
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

  describe("setHealthFactor", () => {
    async function makeEmptyBM() : Promise<BorrowManager> {
      const controller = await CoreContractsHelper.createController(signer);
      const priceOracle = (await DeployUtils.deployContract(signer, "PriceOracleMock"
        , [], [])) as PriceOracleMock;

      return (await DeployUtils.deployContract(signer
        , "BorrowManager"
        , controller.address
      )) as BorrowManager;
    }
    describe("Good paths", () => {
      describe("Asset is not registered in BM", () => {
        it("should save specified value to defaultHealthFactors", async () => {
          const asset = ethers.Wallet.createRandom().address;
          const value = 2000;

          const bm = await makeEmptyBM();

          const before = await bm.defaultHealthFactors2(asset);
          await bm.setHealthFactor(asset, value);
          const after = await bm.defaultHealthFactors2(asset);

          const ret = [
            ethers.utils.formatUnits(before),
            ethers.utils.formatUnits(after)
          ].join();

          const expected = [
            ethers.utils.formatUnits(0),
            ethers.utils.formatUnits(value)
          ].join();

          expect(ret).equal(expected);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Health factor is equal to 1e18", () => {
        it("should revert", async () => {
          const asset = ethers.Wallet.createRandom().address;
          const value = 100;
          console.log(value);

          const bm = await makeEmptyBM();

          await expect(
            bm.setHealthFactor(asset, value)
          ).revertedWith("3");
        });
      });
      describe("Health factor is less then 1e18", () => {
        it("should revert", async () => {
          const asset = ethers.Wallet.createRandom().address;
          const value = 10;

          const bm = await makeEmptyBM();

          await expect(
            bm.setHealthFactor(asset, value)
          ).revertedWith("3");
        });
      });
    });

  });

  describe("findPool", () => {
    async function makeTestTwoUnderlyings(
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

            const ret = await makeTestTwoUnderlyings(input, sourceAmount, healthFactor);
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

            const ret = await makeTestTwoUnderlyings(input, sourceAmount, healthFactor);
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

            const ret = await makeTestTwoUnderlyings(input, sourceAmount, healthFactor);
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

            const ret = await makeTestTwoUnderlyings(input
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

          const ret = await makeTestTwoUnderlyings(input, sourceAmount, healthFactor);
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

          const ret = await makeTestTwoUnderlyings(input, sourceAmount, healthFactor);
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
//endregion Unit tests

});