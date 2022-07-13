import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BorrowManager, MockERC20, PriceOracleMock, PriceOracleMock__factory} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {Misc} from "../../scripts/utils/Misc";
import {BigNumber} from "ethers";
import {BorrowManagerUtils} from "../baseUT/BorrowManagerUtils";
import {sign} from "crypto";
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
    describe("addPlatform", () => {
        describe("Good paths", () => {
            describe("Create two platforms", () => {
                it("should create two platforms with expected data", async () => {
                    const platformTitle1 = "market XYZ";
                    const platformTitle2 = "aave";
                    const decorator1 = ethers.Wallet.createRandom().address;
                    const decorator2 = ethers.Wallet.createRandom().address;

                    const bm = (await DeployUtils.deployContract(signer, "BorrowManager")) as BorrowManager;
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

                    const bm = (await DeployUtils.deployContract(signer, "BorrowManager")) as BorrowManager;
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
                        , await bm.poolsForAssets(asset2, asset1, 0)
                        , await bm.poolsForAssets(asset3, asset1, 0)
                        , await bm.poolsForAssets(asset3, asset2, 0)
                        , await bm.assignedPoolsForAssets(asset2, asset1, poolAddress)
                        , await bm.assignedPoolsForAssets(asset3, asset1, poolAddress)
                        , await bm.assignedPoolsForAssets(asset3, asset2, poolAddress)
                        , await bm.poolsForAssetsLength(asset2, asset1)
                        , await bm.poolsForAssetsLength(asset3, asset1)
                        , await bm.poolsForAssetsLength(asset3, asset2)
                    ].join();

                    const expected = [
                        platformUid
                        , poolAssets, poolAssets, poolAssets
                        , true, true, true
                        , 1, 1, 1
                        , "", "", ""
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
        async function initialize(
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
                pricesUSD.map(x => BigNumber.from(x))
            );

            return {poolAssets: underlines, pool: pool.address, bm};
        }
        describe("Good paths", () => {

            it("should be ok", async () => {
                // source, target
                const underlineDecimals = [18, 6];
                const poolDecimals = [18, 6];
                const collateralFactors = [0.6, 0.8];
                const pricesUSD = [5, 2];

                const {poolAssets, pool, bm} = await initialize(
                    collateralFactors,
                    pricesUSD,
                    underlineDecimals,
                    poolDecimals
                );

                console.log("bm is initialized");

                const sourceToken = poolAssets[0];
                const targetToken = poolAssets[1];
                const targetAmount = 100;
                const healthFactor = 2.0;

                const retSourceAmount = await bm.estimateSourceAmount(
                    pool
                    , sourceToken.address
                    , targetToken.address
                    , getBigNumberFrom(targetAmount, await targetToken.decimals())
                    , healthFactor
                );

                // Use 2022-07-13 Conversion modes.xlsx to calculate results
                const expectedSourceAmount = 625;
                expect(retSourceAmount).equal(expectedSourceAmount);
            });
        });
        describe("Bad paths", () => {
            it("should revert", async () => {
                expect.fail();
            });
        });

    });
});