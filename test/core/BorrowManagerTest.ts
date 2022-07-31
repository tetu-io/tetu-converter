import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BorrowManager, Controller, MockERC20, PriceOracleMock} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {controlGasLimitsEx} from "../../scripts/utils/hardhatUtils";
import {
    GAS_LIMIT_BM_FIND_POOL_1,
    GAS_LIMIT_BM_FIND_POOL_10,
    GAS_LIMIT_BM_FIND_POOL_100, GAS_LIMIT_BM_FIND_POOL_5
} from "../baseUT/GasLimit";
import {IBmInputParams, BorrowManagerHelper} from "../baseUT/BorrowManagerHelper";
import {MocksHelper} from "../baseUT/MocksHelper";

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

//region Unit tests
    describe("addPool", () => {
        describe("Good paths", () => {
            describe("Create a pool with tree assets", () => {
                it("should register 3 asset pairs", async () => {
                    const controller = (await DeployUtils.deployContract(signer, "Controller")) as Controller;
                    const priceOracle = (await DeployUtils.deployContract(signer, "PriceOracleMock"
                        , [], [])) as PriceOracleMock;
                    const bm = (await DeployUtils.deployContract(signer
                        , "BorrowManager"
                        , controller.address
                    )) as BorrowManager;
                    const poolMock = await MocksHelper.createPoolMock(signer, []);
                    await controller.initialize(
                        [await controller.priceOracleKey(), await controller.borrowManagerKey()],
                        [priceOracle.address, bm.address]
                    );

                    const converter = ethers.Wallet.createRandom().address;
                    const platformAdapter = await MocksHelper.createPlatformAdapterMock(signer
                        , poolMock
                        , controller.address
                        , converter
                        , [], [], [], []
                    );

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

                    await bm.addPool(platformAdapter.address, poolAssets);

                    const ret = [
                        await bm.platformAdaptersLength()
                        , await bm.platformAdapters(0)
                        , await bm.platformAdaptersRegistered(platformAdapter.address)
                        , await bm.pairsList(asset1, asset2, 0)
                        , await bm.pairsList(asset1, asset3, 0)
                        , await bm.pairsList(asset2, asset3, 0)
                        , await bm.pairsListRegistered(asset1, asset2, platformAdapter.address)
                        , await bm.pairsListRegistered(asset1, asset3, platformAdapter.address)
                        , await bm.pairsListRegistered(asset2, asset3, platformAdapter.address)
                        , await bm.pairsListLength(asset1, asset2)
                        , await bm.pairsListLength(asset1, asset3)
                        , await bm.pairsListLength(asset2, asset3)
                    ].join();

                    const expected = [
                        1
                        , platformAdapter.address
                        , true
                        , platformAdapter.address, platformAdapter.address, platformAdapter.address
                        , true, true, true
                        , 1, 1, 1
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

    describe("setHealthFactor", () => {
        async function makeEmptyBM() : Promise<BorrowManager> {
            const controller = (await DeployUtils.deployContract(signer, "Controller")) as Controller;
            const priceOracle = (await DeployUtils.deployContract(signer, "PriceOracleMock"
                , [], [])) as PriceOracleMock;
            await controller.initialize([await controller.priceOracleKey()], [priceOracle.address]);

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
                    const value = 1000;
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
        async function makeTestTwoUnderlines(
            tt: IBmInputParams,
            sourceAmount: number,
            healthFactor: number,
            estimateGas: boolean = false
        ) : Promise<{
            outPoolIndex0: number;
            outApr: BigNumber;
            outMaxTargetAmount: BigNumber;
            outGas?: BigNumber
        }> {
            // There are TWO underlines: source, target
            const {bm, sourceToken, targetToken, pools}
                = await BorrowManagerHelper.createBmTwoUnderlines(signer, tt);

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
                outApr: ret.apr,
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
                            targetCollateralFactor: 0.8,
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

                        const ret = await makeTestTwoUnderlines(input, sourceAmount, healthFactor);
                        const sret = [
                            ret.outPoolIndex0,
                            ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
                            ethers.utils.formatUnits(ret.outApr, input.targetDecimals)
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
                            targetCollateralFactor: 0.9,
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

                        const ret = await makeTestTwoUnderlines(input, sourceAmount, healthFactor);
                        const sret = [
                            ret.outPoolIndex0,
                            ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
                            ethers.utils.formatUnits(ret.outApr, input.targetDecimals)
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
                            targetCollateralFactor: 0.5,
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

                        const ret = await makeTestTwoUnderlines(input, sourceAmount, healthFactor);
                        const sret = [
                            ret.outPoolIndex0,
                            ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
                            ethers.utils.formatUnits(ret.outApr, input.targetDecimals)
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
                            targetCollateralFactor: 0.8,
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

                        const ret = await makeTestTwoUnderlines(input
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
                        targetCollateralFactor: 0.5,
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

                    const ret = await makeTestTwoUnderlines(input, sourceAmount, healthFactor);
                    const sret = [
                        ret.outPoolIndex0,
                        ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
                        ethers.utils.formatUnits(ret.outApr, input.targetDecimals)
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
                        targetCollateralFactor: 0.5,
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

                    const ret = await makeTestTwoUnderlines(input, sourceAmount, healthFactor);
                    const sret = [
                        ret.outPoolIndex0,
                        ethers.utils.formatUnits(ret.outMaxTargetAmount, input.targetDecimals),
                        ethers.utils.formatUnits(ret.outApr, input.targetDecimals)
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