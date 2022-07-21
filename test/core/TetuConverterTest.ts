import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BorrowManager, MockERC20, TetuConverter} from "../../typechain";
import {IBmInputParams, BorrowManagerHelper, PoolInstanceInfo} from "../baseUT/BorrowManagerHelper";

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
    async function createTetuConverter(
        tt: IBmInputParams
    ) : Promise<{
        tetuConveter: TetuConverter,
        sourceToken: MockERC20,
        targetToken: MockERC20,
        borrowManager: BorrowManager,
        pools: PoolInstanceInfo[]
    }> {
        const {bm, sourceToken, targetToken, pools}
            = await BorrowManagerHelper.createBmTwoUnderlines(signer, tt);

        const tetuConveter = await DeployUtils.deployContract(signer
            , "TetuConverter", bm.address) as TetuConverter;

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
                        const input = BorrowManagerHelper.getBmInputParamsThreePools(bestBorrowRate);

                        const {tetuConveter, sourceToken, targetToken} = await createTetuConverter(input);

                        const ret = await tetuConveter.findBestConversionStrategy(
                            sourceToken.address,
                            sourceAmount,
                            targetToken.address,
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