import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BorrowManager, MockERC20, PriceOracleMock} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {BorrowManagerUtils, IPoolInfo} from "../baseUT/BorrowManagerUtils";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {controlGasLimitsEx} from "../../scripts/utils/hardhatUtils";
import {
    GAS_LIMIT_BM_FIND_POOL_1,
    GAS_LIMIT_BM_FIND_POOL_10,
    GAS_LIMIT_BM_FIND_POOL_100, GAS_LIMIT_BM_FIND_POOL_5
} from "../baseUT/GasLimit";

describe("BorrowManagerBase (IPoolAdaptersManager)", () => {
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
    describe("registerPoolAdapter", () => {
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

    describe("getInfo", () => {
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