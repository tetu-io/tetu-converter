import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BorrowManager, MockERC20, PriceOracleMock} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {BorrowManagerUtils} from "../baseUT/BorrowManagerUtils";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {controlGasLimitsEx} from "../../scripts/utils/hardhatUtils";
import {
    GAS_LIMIT_BM_FIND_POOL_1,
    GAS_LIMIT_BM_FIND_POOL_10,
    GAS_LIMIT_BM_FIND_POOL_100, GAS_LIMIT_BM_FIND_POOL_5
} from "../baseUT/GasLimit";

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
    interface IPoolInfo {
        /** The length of array should be equal to the count of underlines */
        borrowRateInTokens: number[],
        /** The length of array should be equal to the count of underlines */
        availableLiquidityInTokens: number[]
    }
    /**
     * Generate N pools with same set of underlines.
     * Create new BorrowManager and add each pool as a separate platform
     */
    async function initializeBorrowManager(
        poolsInfo: IPoolInfo[],
        collateralFactors: number[],
        pricesUSD: number[],
        underlineDecimals: number[],
        cTokenDecimals: number[]
    ) : Promise<{
        poolAssets: MockERC20[],
        pools: string[],
        bm: BorrowManager
    }> {
        const underlines = await BorrowManagerUtils.generateAssets(underlineDecimals);
        const bm = await BorrowManagerUtils.createBorrowManager(
            signer,
            underlines,
            pricesUSD.map(x => BigNumber.from(10).pow(16).mul(x * 100))
        );
        const pools: string[] = [];

        for (let i = 0; i < poolsInfo.length; ++i) {
            const cTokens = await BorrowManagerUtils.generateCTokens(signer, cTokenDecimals, underlines.map(x => x.address));
            const pool = await BorrowManagerUtils.generatePool(signer, cTokens);
            console.log("underlines", underlines.map(x => x.address));
            console.log("cTokens", cTokens.map(x => x.address));
            console.log("pool", pool.address);

            const borrowRateInTokens = 1;
            const availableLiquidityInTokens = 10_000;

            const borrowRates = underlines.map(
                (token, index) => getBigNumberFrom(poolsInfo[i].borrowRateInTokens[index], underlineDecimals[index])
            );
            const availableLiquidities = underlines.map(
                (token, index) => getBigNumberFrom(poolsInfo[i].availableLiquidityInTokens[index], underlineDecimals[index])
            );

            const decorator = await BorrowManagerUtils.generateDecorator(
                signer,
                pool,
                underlines.map(x => x.address),
                borrowRates,
                collateralFactors,
                availableLiquidities
            );

            await bm.addPlatform(`Pool-${i + 1}`, decorator.address);
            const platformUid = await bm.platformsCount();

            console.log("platformUid", platformUid);

            await bm.addPool(platformUid, pool.address, underlines.map(x => x.address));

            pools.push(pool.address);
        }

        return {poolAssets: underlines, pools, bm};
    }

//endregion Utils
    describe("addPlatform", () => {
        describe("Good paths", () => {
            describe("Create two platforms", () => {
                it("should create two platforms with expected data", async () => {
                    const platformTitle1 = "market XYZ";
                    const platformTitle2 = "aave";
                    const decorator1 = ethers.Wallet.createRandom().address;
                    const decorator2 = ethers.Wallet.createRandom().address;

                    const priceOracle = (await DeployUtils.deployContract(signer
                        , "PriceOracleMock"
                        , []
                        , []
                    )) as PriceOracleMock;

                    const bm = (await DeployUtils.deployContract(signer
                        , "BorrowManager"
                        , priceOracle.address
                    )) as BorrowManager;
                    await bm.addPlatform(platformTitle1, decorator1);
                    await bm.addPlatform(platformTitle2, decorator2);

                    const countPlatforms = await bm.platformsCount();
                    const platform1 = (await bm.platforms(1));
                    const platform2 = (await bm.platforms(2));

                    const ret = [
                        await bm.platformsCount()
                        , platform1.title, platform1.decorator
                        , platform2.title, platform2.decorator
                    ].join();

                    const expected = [
                        2
                        , platformTitle1, decorator1
                        , platformTitle2, decorator2
                    ].join();

                    expect(ret).equal(expected);
                });
            });
        });
        describe("Bad paths", () => {
            describe("Not governance", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });
            describe("Add already registered platform", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });
            describe("Empty name", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });
            describe("Too long name", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });
        });
    });

    describe("addPool", () => {
        describe("Good paths", () => {
            describe("Create a pool with tree assets", () => {
                it("should register 3 asset pairs", async () => {
                    const platformTitle = "market XYZ";
                    const decorator = ethers.Wallet.createRandom().address;
                    const poolAddress = ethers.Wallet.createRandom().address;
                    const poolAssets = [
                        ethers.Wallet.createRandom().address
                        , ethers.Wallet.createRandom().address
                        , ethers.Wallet.createRandom().address
                    ];
                    poolAssets.sort((x, y) => x.localeCompare(y));
                    const asset1 = poolAssets[0];
                    const asset2 = poolAssets[1];
                    const asset3 = poolAssets[2];

                    const priceOracle = (await DeployUtils.deployContract(signer
                        , "PriceOracleMock"
                        , []
                        , []
                    )) as PriceOracleMock;

                    const bm = (await DeployUtils.deployContract(signer
                        , "BorrowManager"
                        , priceOracle.address
                    )) as BorrowManager;

                    await bm.addPlatform(platformTitle, decorator);
                    const platformUid = await bm.platformsCount();

                    await bm.addPool(platformUid, poolAddress, poolAssets);

                    const ret = [
                        await bm.poolToPlatform(poolAddress)
                        , await bm.poolsForAssets(asset1, asset2, 0)
                        , await bm.poolsForAssets(asset1, asset3, 0)
                        , await bm.poolsForAssets(asset2, asset3, 0)
                        , await bm.assignedPoolsForAssets(asset1, asset2, poolAddress)
                        , await bm.assignedPoolsForAssets(asset1, asset3, poolAddress)
                        , await bm.assignedPoolsForAssets(asset2, asset3, poolAddress)
                        , await bm.poolsForAssetsLength(asset1, asset2)
                        , await bm.poolsForAssetsLength(asset1, asset3)
                        , await bm.poolsForAssetsLength(asset2, asset3)
                        , await bm.assignedPoolsForAssets(asset2, asset1, poolAddress)
                        , await bm.assignedPoolsForAssets(asset3, asset1, poolAddress)
                        , await bm.assignedPoolsForAssets(asset3, asset2, poolAddress)
                        , await bm.poolsForAssetsLength(asset2, asset1)
                        , await bm.poolsForAssetsLength(asset3, asset1)
                        , await bm.poolsForAssetsLength(asset3, asset2)
                    ].join();

                    const expected = [
                        platformUid
                        , poolAddress, poolAddress, poolAddress
                        , true, true, true
                        , 1, 1, 1
                        , false, false, false
                        , 0, 0, 0
                    ].join();

                    expect(ret).equal(expected);
                });
            });
            describe("Create two pools", () => {
                it("should set expected values to poolsForAssets and assignedPoolsForAssets", async () => {
                    expect.fail();
                });
            });
        });
        describe("Bad paths", () => {
            describe("Not governance", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });
            describe("Pool is already registered", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });
            describe("Unknown platform", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });
            describe("Pool has no assets", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });
            describe("An asset is repeated", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });

        });
    });

    describe("findPool", () => {
        interface TestTask {
            availablePools: IPoolInfo[],
            targetCollateralFactor: number;
            priceSourceUSD: number;
            priceTargetUSD: number;
            sourceAmount: number;
            targetAmount: number;
            healthFactor: number;
            sourceDecimals?: number;
            targetDecimals?: number;
        }
        async function makeTestTwoUnderlines(
            tt: TestTask,
            estimateGas: boolean = false
        ) : Promise<{
            outPoolIndex0: number;
            outBorrowRate: BigNumber;
            outMaxTargetAmount: BigNumber;
            outGas?: BigNumber
        }> {
            const sourceDecimals = tt.sourceDecimals || 18;
            const targetDecimals = tt.targetDecimals || 6;

            // There are TWO underlines: source, target
            const underlineDecimals = [sourceDecimals, targetDecimals];
            const poolDecimals = [sourceDecimals, targetDecimals];
            const collateralFactors = [0.6, tt.targetCollateralFactor];
            const pricesUSD = [tt.priceSourceUSD, tt.priceTargetUSD];

            const {poolAssets, pools, bm} = await initializeBorrowManager(
                tt.availablePools,
                collateralFactors,
                pricesUSD,
                underlineDecimals,
                poolDecimals
            );

            console.log("bm is initialized");

            const sourceToken = poolAssets[0];
            const targetToken = poolAssets[1];

            console.log("Source amount:", getBigNumberFrom(tt.sourceAmount, await sourceToken.decimals()).toString());
            const ret = await bm.findPool(
                sourceToken.address
                , getBigNumberFrom(tt.sourceAmount, await sourceToken.decimals())
                , targetToken.address
                , getBigNumberFrom(tt.targetAmount, await targetToken.decimals())
                , BigNumber.from(10).pow(16).mul(tt.healthFactor * 100)
            );
            const gas = estimateGas
                ? await bm.estimateGas.findPool(
                    sourceToken.address
                    , getBigNumberFrom(tt.sourceAmount, await sourceToken.decimals())
                    , targetToken.address
                    , getBigNumberFrom(tt.targetAmount, await targetToken.decimals())
                    , BigNumber.from(10).pow(16).mul(tt.healthFactor * 100)
                )
                : undefined;
            return {
                outPoolIndex0: pools.findIndex(x => x == ret.outPool),
                outBorrowRate: ret.outBorrowRate,
                outMaxTargetAmount: ret.outMaxTargetAmount,
                outGas: gas
            }
        }
        describe("Good paths", () => {
            describe("Several pools", () => {
                describe("Example 1: Pool 1 has a lowest borrow rate", () => {
                    it("should return Pool 1 and expected amount", async () => {
                        const bestBorrowRate = 27;
                        const input = {
                            targetCollateralFactor: 0.8,
                            priceSourceUSD: 0.1,
                            priceTargetUSD: 4,
                            sourceDecimals: 24,
                            targetDecimals: 12,
                            targetAmount: 300,
                            sourceAmount: 100_000,
                            healthFactor: 4,
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

                        const ret = await makeTestTwoUnderlines(input);
                        const sret = [
                            ret.outPoolIndex0,
                            ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
                            ethers.utils.formatUnits(ret.outBorrowRate, input.targetDecimals)
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
                        const input = {
                            targetCollateralFactor: 0.9,
                            priceSourceUSD: 2,
                            priceTargetUSD: 0.5,
                            sourceDecimals: 6,
                            targetDecimals: 6,
                            targetAmount: 400,
                            sourceAmount: 1000,
                            healthFactor: 1.6,
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

                        const ret = await makeTestTwoUnderlines(input);
                        const sret = [
                            ret.outPoolIndex0,
                            ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
                            ethers.utils.formatUnits(ret.outBorrowRate, input.targetDecimals)
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
                        const input = {
                            targetCollateralFactor: 0.5,
                            priceSourceUSD: 0.5,
                            priceTargetUSD: 0.2,
                            sourceDecimals: 18,
                            targetDecimals: 6,
                            targetAmount: 5000,
                            sourceAmount: 10000,
                            healthFactor: 2.0,
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

                        const ret = await makeTestTwoUnderlines(input);
                        const sret = [
                            ret.outPoolIndex0,
                            ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
                            ethers.utils.formatUnits(ret.outBorrowRate, input.targetDecimals)
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
                        const input = {
                            targetCollateralFactor: 0.8,
                            priceSourceUSD: 0.1,
                            priceTargetUSD: 4,
                            sourceDecimals: 24,
                            targetDecimals: 12,
                            targetAmount: 300,
                            sourceAmount: 100_000,
                            healthFactor: 4,
                            availablePools: [...Array(countPools).keys()].map(
                                x => ({   // source, target
                                    borrowRateInTokens: [0, bestBorrowRate - x], // next pool is better then previous
                                    availableLiquidityInTokens: [0, 2000000] //enough money
                                }),
                            )
                        };

                        const ret = await makeTestTwoUnderlines(input
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
                    const input = {
                        targetCollateralFactor: 0.5,
                        priceSourceUSD: 0.5,
                        priceTargetUSD: 0.2,
                        sourceDecimals: 18,
                        targetDecimals: 6,
                        targetAmount: 5000,
                        sourceAmount: 10000,
                        healthFactor: 2.0,
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

                    const ret = await makeTestTwoUnderlines(input);
                    const sret = [
                        ret.outPoolIndex0,
                        ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
                        ethers.utils.formatUnits(ret.outBorrowRate, input.targetDecimals)
                    ].join();

                    const sexpected = [-1, "0.0", "0.0"].join();

                    expect(sret).equal(sexpected);
                });
            });
            describe("Example 3. User asks too much money", () => {
                it("should return all 0", async () => {
                    const bestBorrowRate = 7;
                    const input = {
                        targetCollateralFactor: 0.5,
                        priceSourceUSD: 0.5,
                        priceTargetUSD: 0.2,
                        sourceDecimals: 18,
                        targetDecimals: 6,
                        targetAmount: 7000,
                        sourceAmount: 10000,
                        healthFactor: 2.0,
                        availablePools: [
                            {   // source, target
                                borrowRateInTokens: [0, bestBorrowRate - 1],
                                availableLiquidityInTokens: [0, 100] //not enough money
                            },
                            {   // source, target
                                borrowRateInTokens: [0, bestBorrowRate + 1], //the rate is worse than in the pool 2
                                availableLiquidityInTokens: [0, 20000]
                            },
                            {   // source, target   -   pool 2 is the best
                                borrowRateInTokens: [0, bestBorrowRate],
                                availableLiquidityInTokens: [0, 20000]
                            },
                        ]
                    };

                    const ret = await makeTestTwoUnderlines(input);
                    const sret = [
                        ret.outPoolIndex0,
                        ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
                        ethers.utils.formatUnits(ret.outBorrowRate, input.targetDecimals)
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
});