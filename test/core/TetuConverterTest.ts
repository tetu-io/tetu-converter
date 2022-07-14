import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {expect} from "chai";

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

//endregion Utils

//region Unit tests
    describe("findBestConversionStrategy", () => {
        describe("Good paths", () => {
            describe("Lending is more efficient", () => {

            });
            describe("Swap is more efficient", () => {
                it("TODO", async () => {
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