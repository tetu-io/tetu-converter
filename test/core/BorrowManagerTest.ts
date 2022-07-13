import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BorrowManager, MockERC20, PriceOracleMock} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {BorrowManagerUtils} from "../baseUT/BorrowManagerUtils";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";

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
    async function initializeBorrowManager(
        collateralFactors: number[],
        pricesUSD: number[],
        underlineDecimals: number[],
        poolDecimals: number[]
    ) : Promise<{
        poolAssets: MockERC20[],
        pool: string,
        bm: BorrowManager
    }> {
        const underlines = await BorrowManagerUtils.generateAssets(underlineDecimals);
        const cTokens = await BorrowManagerUtils.generateCTokens(signer, poolDecimals, underlines.map(x => x.address));
        const pool = await BorrowManagerUtils.generatePool(signer, cTokens);
        console.log("underlines", underlines.map(x => x.address));
        console.log("cTokens", cTokens.map(x => x.address));
        console.log("pool", pool.address);

        const borrowRateInTokens = 1;
        const availableLiquidityInTokens = 10_000;

        const borrowRates = underlines.map(
            (token, index) => getBigNumberFrom(borrowRateInTokens, underlineDecimals[index])
        );
        const availableLiquidities = underlines.map(
            (token, index) => getBigNumberFrom(availableLiquidityInTokens, underlineDecimals[index])
        );

        const bm = await BorrowManagerUtils.createBorrowManagerWithMockDecorator(
            signer,
            pool,
            underlines,
            poolAddress => BorrowManagerUtils.generateDecorator(
                signer,
                pool,
                underlines.map(x => x.address),
                borrowRates,
                collateralFactors,
                availableLiquidities
            ),
            pricesUSD.map(x => BigNumber.from(10).pow(16).mul(x * 100))
        );

        return {poolAssets: underlines, pool: pool.address, bm};
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

    describe("estimateSourceAmount", () => {
        describe("Good paths", () => {
            interface TestTask {
                targetCollateralFactor: number;
                priceSourceUSD: number;
                priceTargetUSD: number;
                targetAmount: number;
                healthFactor: number;
                expectedSourceAmount: number;
                sourceDecimals?: number;
                targetDecimals?: number;
            }
            async function makeTest(tt: TestTask) : Promise<{ret: string, expected: string}> {
                const sourceDecimals = tt.sourceDecimals || 18;
                const targetDecimals = tt.targetDecimals || 6;

                // source, target
                const underlineDecimals = [sourceDecimals, targetDecimals];
                const poolDecimals = [sourceDecimals, targetDecimals];
                const collateralFactors = [0.6, tt.targetCollateralFactor];
                const pricesUSD = [tt.priceSourceUSD, tt.priceTargetUSD];

                const {poolAssets, pool, bm} = await initializeBorrowManager(
                    collateralFactors,
                    pricesUSD,
                    underlineDecimals,
                    poolDecimals
                );

                console.log("bm is initialized");

                const sourceToken = poolAssets[0];
                const targetToken = poolAssets[1];

                const retSourceAmount = await bm.estimateSourceAmount(
                    pool
                    , sourceToken.address
                    , targetToken.address
                    , getBigNumberFrom(tt.targetAmount, await targetToken.decimals())
                    , BigNumber.from(10).pow(16).mul(tt.healthFactor * 100)
                );
                const sRetSourceAmount = ethers.utils.formatUnits(retSourceAmount, sourceDecimals);

                const expectedSourceAmountCalc = tt.healthFactor * tt.targetAmount * tt.priceTargetUSD
                    / (tt.targetCollateralFactor * tt.priceSourceUSD);

                const ret = [sRetSourceAmount, sRetSourceAmount].join();
                const expected = [
                    ethers.utils.formatUnits(getBigNumberFrom(tt.expectedSourceAmount, sourceDecimals), sourceDecimals),
                    ethers.utils.formatUnits(getBigNumberFrom(expectedSourceAmountCalc, sourceDecimals), sourceDecimals)
                ].join();

                return {ret, expected};
            }
            describe("assets are more expensive then USD", () => {
                it("should return expected source amount", async () => {
                    const {ret, expected} = await makeTest({
                        targetCollateralFactor: 0.8,
                        priceSourceUSD: 5,
                        priceTargetUSD: 2,
                        sourceDecimals: 18,
                        targetDecimals: 6,
                        targetAmount: 100,
                        healthFactor: 1.5,
                        expectedSourceAmount: 75 // [SA]
                    });

                    expect(ret).equal(expected);
                });
            });
            describe("assets are less expensive then USD", () => {
                it("should return expected source amount", async () => {
                    const {ret, expected} = await makeTest({
                        targetCollateralFactor: 0.5,
                        priceSourceUSD: 0.5,
                        priceTargetUSD: 0.2,
                        sourceDecimals: 12,
                        targetDecimals: 24,
                        targetAmount: 100,
                        healthFactor: 3.5,
                        expectedSourceAmount: 280 // [SA]
                    });

                    expect(ret).equal(expected);
                });
            });
        });
        describe("Bad paths", () => {
            it("should revert", async () => {
                expect.fail();
            });
        });
    });

    describe("estimateTargetAmount", () => {
        describe("Good paths", () => {
            interface TestTask {
                targetCollateralFactor: number;
                priceSourceUSD: number;
                sourceAmount: number;
                priceTargetUSD: number;
                healthFactor: number;
                expectedTargetAmount: number;
                sourceDecimals?: number;
                targetDecimals?: number;
            }
            async function makeTest(tt: TestTask) : Promise<{ret: string, expected: string}> {
                const sourceDecimals = tt.sourceDecimals || 18;
                const targetDecimals = tt.targetDecimals || 6;

                // source, target
                // source, target
                const underlineDecimals = [sourceDecimals, targetDecimals];
                const poolDecimals = [sourceDecimals, targetDecimals];
                const collateralFactors = [0.6, tt.targetCollateralFactor];
                const pricesUSD = [tt.priceSourceUSD, tt.priceTargetUSD];

                const {poolAssets, pool, bm} = await initializeBorrowManager(
                    collateralFactors,
                    pricesUSD,
                    underlineDecimals,
                    poolDecimals
                );

                console.log("bm is initialized");

                const sourceToken = poolAssets[0];
                const targetToken = poolAssets[1];

                const retTargetAmount = await bm.estimateTargetAmount(
                    pool
                    , sourceToken.address
                    , getBigNumberFrom(tt.sourceAmount, await sourceToken.decimals())
                    , targetToken.address
                    , BigNumber.from(10).pow(16).mul(tt.healthFactor * 100)
                );
                const sRetTargetAmount = ethers.utils.formatUnits(retTargetAmount, targetDecimals);

                const expectedTargetAmountCalc = tt.targetCollateralFactor * tt.sourceAmount * tt.priceSourceUSD
                    / (tt.healthFactor * tt.priceTargetUSD);

                const ret = [sRetTargetAmount, sRetTargetAmount].join();
                const expected = [
                    ethers.utils.formatUnits(getBigNumberFrom(tt.expectedTargetAmount, targetDecimals), targetDecimals),
                    ethers.utils.formatUnits(getBigNumberFrom(expectedTargetAmountCalc, targetDecimals), targetDecimals)
                ].join();

                return {ret, expected};
            }
            describe("assets are more expensive then USD", () => {
                it("should return expected target amount", async () => {
                    const {ret, expected} = await makeTest({
                        targetCollateralFactor: 0.8,
                        priceSourceUSD: 5,
                        sourceAmount: 1000, // [SA]
                        priceTargetUSD: 2,
                        sourceDecimals: 18,
                        targetDecimals: 6,
                        healthFactor: 2.5,
                        expectedTargetAmount: 800 // [SA]
                    });

                    expect(ret).equal(expected);
                });
            });
            describe("target asset is less expensive than USD", () => {
                it("should return expected target amount", async () => {
                    const {ret, expected} = await makeTest({
                        targetCollateralFactor: 0.8,
                        priceSourceUSD: 5,
                        sourceAmount: 1000, // [SA]
                        priceTargetUSD: 0.2,
                        sourceDecimals: 24,
                        targetDecimals: 22,
                        healthFactor: 2.5,
                        expectedTargetAmount: 8000 // [SA]
                    });

                    expect(ret).equal(expected);
                });
            });
        });
        describe("Bad paths", () => {
            it("should revert", async () => {
                expect.fail();
            });
        });
    });

    describe("estimateHealthFactor", () => {
        describe("Good paths", () => {
            interface TestTask {
                targetCollateralFactor: number;
                priceSourceUSD: number;
                sourceAmount: number;
                priceTargetUSD: number;
                targetAmount: number;
                expectedHealthFactor: number;
                sourceDecimals?: number;
                targetDecimals?: number;
            }
            async function makeTest(tt: TestTask) : Promise<{ret: string, expected: string}> {
                const sourceDecimals = tt.sourceDecimals || 18;
                const targetDecimals = tt.targetDecimals || 6;

                // source, target
                // source, target
                const underlineDecimals = [sourceDecimals, targetDecimals];
                const poolDecimals = [sourceDecimals, targetDecimals];
                const collateralFactors = [0.6, tt.targetCollateralFactor];
                const pricesUSD = [tt.priceSourceUSD, tt.priceTargetUSD];

                const {poolAssets, pool, bm} = await initializeBorrowManager(
                    collateralFactors,
                    pricesUSD,
                    underlineDecimals,
                    poolDecimals
                );

                console.log("bm is initialized");

                const sourceToken = poolAssets[0];
                const targetToken = poolAssets[1];

                const retHealthFactor = await bm.estimateHealthFactor(
                    pool
                    , sourceToken.address
                    , getBigNumberFrom(tt.sourceAmount, await sourceToken.decimals())
                    , targetToken.address
                    , getBigNumberFrom(tt.targetAmount, await targetToken.decimals())
                );
                const sRetHealthFactor = ethers.utils.formatUnits(retHealthFactor, 18);

                const expectedHealthFactorCalc = tt.targetCollateralFactor * tt.sourceAmount * tt.priceSourceUSD
                    / (tt.targetAmount * tt.priceTargetUSD);

                const ret = [sRetHealthFactor, sRetHealthFactor].join();
                const expected = [
                    ethers.utils.formatUnits(getBigNumberFrom(tt.expectedHealthFactor, 18), 18),
                    ethers.utils.formatUnits(getBigNumberFrom(expectedHealthFactorCalc, 18), 18)
                ].join();

                return {ret, expected};
            }
            describe("assets are more expensive then USD", () => {
                it("should return expected target amount", async () => {
                    const {ret, expected} = await makeTest({
                        targetCollateralFactor: 0.8,
                        priceSourceUSD: 5,
                        sourceAmount: 3000, // [SA]
                        targetAmount: 2000, // [TA]
                        priceTargetUSD: 2,
                        sourceDecimals: 18,
                        targetDecimals: 6,
                        expectedHealthFactor: 3 // [SA]
                    });

                    expect(ret).equal(expected);
                });
            });
            describe("assets are less expensive than USD", () => {
                it("should return expected target amount", async () => {
                    const {ret, expected} = await makeTest({
                        targetCollateralFactor: 0.8,
                        priceSourceUSD: 0.5,
                        sourceAmount: 3000, // [SA]
                        priceTargetUSD: 0.2,
                        targetAmount: 2000, // [TA]
                        sourceDecimals: 24,
                        targetDecimals: 22,
                        expectedHealthFactor: 3 // [SA]
                    });

                    expect(ret).equal(expected);
                });
            });
        });
        describe("Bad paths", () => {
            it("should revert", async () => {
                expect.fail();
            });
        });
    });
});