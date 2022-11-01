import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {expect} from "chai";


describe("KeeperTest", () => {

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

//region Unit tests
  describe("checker", () => {
    describe("Good paths", () => {
      describe("All positions are healthy", () => {
        describe("nextIndexToCheck0 is not changed", () => {
          it("should not call fixHealth", async () => {
            expect.fail("TODO");
          });
        });
        describe("nextIndexToCheck0 is changed", () => {
          it("should call fixHealth", async () => {
            expect.fail("TODO");
          });
        });
      });

      describe("There is single unhealthy position", () => {
        describe("Current nextIndexToCheck0 is less than the position index", () => {
          it("should call requireRepay for the unhealthy position with expected params", async () => {
            expect.fail("TODO");
          });
          it("should set nextIndexToCheck0 = position + 1", async () => {
            expect.fail("TODO");
          });
        });
        describe("Current nextIndexToCheck0 is equal to the position index", () => {
          it("should call requireRepay for the unhealthy position with expected params", async () => {
            expect.fail("TODO");
          });
          it("should set nextIndexToCheck0 = position + 1", async () => {
            expect.fail("TODO");
          });
        });
        describe("Current nextIndexToCheck0 is greater than the position index", () => {
          it("should not call fixHealth", async () => {
            expect.fail("TODO");
          });
          it("should set nextIndexToCheck0 to 0", async () => {
            expect.fail("TODO");
          });
        });
      });

      describe("There are two unhealthy positions", () => {
        it("should call requireRepay for the unhealthy position with expected params", async () => {
          expect.fail("TODO");
        });
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("fixHealth", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("Called by not Gelato", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
      describe("Wrong lengths", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });
//endregion Unit tests
});