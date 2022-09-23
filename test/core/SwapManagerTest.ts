import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  ITetuLiquidator,
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BorrowManagerHelper} from "../baseUT/helpers/BorrowManagerHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";

describe("SwapManager", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];
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
      describe("Single platformAdapter + templatePoolAdapter", () => {
        it("should create instance of the required template contract", async () => {

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
