import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {expect} from "chai";

describe("Keeper test", () => {
//region Global vars for all tests
    let snapshot: string;
    let snapshotForEach: string;
    let deployer: SignerWithAddress;
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
        deployer = signers[0];
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

//region Tests implementations

//endregion Tests implementations

//region Unit tests
    describe("Health checking", async () => {
        describe("Good paths", () => {
            describe("Single borrow, single instant complete repay", () => {
                it("", async() => {
                   expect.fail("TODO");
                });
            });
        });
    });

    describe("Better converting way checking", async () => {
        describe("Good paths", () => {
            describe("Single borrow, single instant complete repay", () => {
                it("", async() => {
                    expect.fail("TODO");
                });
            });
        });
    });

//endregion Unit tests
});