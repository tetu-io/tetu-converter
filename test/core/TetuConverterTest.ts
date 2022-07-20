import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {BorrowManagerUtils, IPoolInfo} from "../baseUT/BorrowManagerUtils";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BorrowManager, TetuConverter} from "../../typechain";

describe("BorrowManager", () => {
//region Constants
    const BLOCKS_PER_DAY = 6456;
//endregion Constants

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
    interface TestTask {
        availablePools: IPoolInfo[],
        targetCollateralFactor: number;
        /** How much 1 source token costs in USD */
        priceSourceUSD: number;
        /** How much 1 target token costs in USD */
        priceTargetUSD: number;
        sourceAmount: number;
        healthFactor: number;
        sourceDecimals?: number;
        targetDecimals?: number;
    }

    async function createTetuConverter(
        tt: TestTask
    ) : Promise<{
        tetuConveter: TetuConverter,
        sourceToken: string,
        targetToken: string,
        borrowManager: BorrowManager,
        pools: string[]
    }> {
        const sourceDecimals = tt.sourceDecimals || 18;
        const targetDecimals = tt.targetDecimals || 6;

        // There are TWO underlines: source, target
        const underlineDecimals = [sourceDecimals, targetDecimals];
        const poolDecimals = [sourceDecimals, targetDecimals];
        const collateralFactors = [0.6, tt.targetCollateralFactor];
        const pricesUSD = [tt.priceSourceUSD, tt.priceTargetUSD];

        const {poolAssets, pools, bm} = await BorrowManagerUtils.initializeBorrowManager(
            signer,
            tt.availablePools,
            collateralFactors,
            pricesUSD,
            underlineDecimals,
            poolDecimals
        );

        console.log("bm is initialized");

        const sourceToken = poolAssets[0].address;
        const targetToken = poolAssets[1].address;

        const tetuConveter = await DeployUtils.deployContract(signer, "TetuConverter", bm.address) as TetuConverter;

        return {tetuConveter, sourceToken, targetToken, borrowManager: bm, pools};
    }
//endregion Utils

//region Unit tests
    describe("findBestConversionStrategy", () => {
        describe("Good paths", () => {
            describe("Lending is more efficient", () => {
                describe("Single suitable lending pool", () => {
                    it("should return expected data", async () => {
                        const bestBorrowRate = 27;
                        const period = BLOCKS_PER_DAY * 31;

                        const sourceAmount = 100_000;

                        const healthFactor = 2;
                        const input = {
                            targetCollateralFactor: 0.8,
                            priceSourceUSD: 0.1,
                            priceTargetUSD: 4,
                            sourceDecimals: 24,
                            targetDecimals: 12,
                            sourceAmount: sourceAmount,
                            healthFactor: 2,
                            availablePools: [
                                {   // source, target
                                    borrowRateInTokens: [0, bestBorrowRate],
                                    availableLiquidityInTokens: [0, 100] //not enough money
                                },
                                {   // source, target
                                    borrowRateInTokens: [0, bestBorrowRate], //best rate
                                    availableLiquidityInTokens: [0, 200_000] //enough cash
                                },
                                {   // source, target   -   pool 2 is the best
                                    borrowRateInTokens: [0, bestBorrowRate+1], //the rate is worse
                                    availableLiquidityInTokens: [0, 2000000000] //a lot of cash
                                },
                            ]
                        };

                        const {tetuConveter, sourceToken, targetToken} = await createTetuConverter(input);

                        const ret = await tetuConveter.findBestConversionStrategy(
                            sourceToken,
                            sourceAmount,
                            targetToken,
                            getBigNumberFrom(healthFactor, 18),
                            period
                        );

                        const sret = [
                            ret.outPool,
                            ret.outAdapter,
                            ret.outMaxTargetAmount,
                            ret.outInterest
                        ].join();



                        const sexpected = [
                            "",
                            "",
                            0,
                            0
                        ].join();

                        expect(sret).equal(sexpected);
                    });
                });
            });
            describe("Swap is more efficient", () => {
                it("TODO", async () => {
                    expect.fail();
                });
            });
        });
        describe("Bad paths", () => {
            describe("Unsupported source asset", () => {
                it("should return 0", async () => {
                    expect.fail();
                });
            });
            describe("Pool don't have enough liquidity", () => {
                it("should return 0", async () => {
                    expect.fail();
                });
            });
        });
    });

    describe("borrow", () => {
        describe("Good paths", () => {
            describe("Use matic as collateral, borrow USDC", () => {
                it("should update balance in proper way", async () => {
                    // register MarketXYZ's pools in BorrowManager

                    // find a pool

                    // borrow USDC

                    // check balances of USDC, Matic and cMatic


                    expect.fail();
                });
            });
            describe("Use USDC as collateral, borrow matic", () => {
                it("should update balance in proper way", async () => {
                    expect.fail();
                });
            });
            describe("Use USDC as collateral, borrow USDT", () => {
                it("should update balance in proper way", async () => {
                    expect.fail();
                });
            });
        });

        describe("Bad paths", () => {
            describe("Unsupported source asset", () => {
                it("TODO", async () => {
                    expect.fail();
                });
            });
        });
    });
//endregion Unit tests
});