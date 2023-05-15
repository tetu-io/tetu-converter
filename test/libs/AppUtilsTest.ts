import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {AppUtilsFacade} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {parseUnits} from "ethers/lib/utils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {BalanceUtils} from "../baseUT/utils/BalanceUtils";
import {controlGasLimitsEx} from "../../scripts/utils/hardhatUtils";
import {
  GAS_APP_UTILS_SHRINK_AND_ORDER
} from "../baseUT/GasLimit";
import {Misc} from "../../scripts/utils/Misc";

describe.skip("AppUtils", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let facade: AppUtilsFacade;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    facade = await DeployUtils.deployContract(deployer, "AppUtilsFacade") as AppUtilsFacade;
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
  describe("toMantissa", () => {
    describe("Good paths", () => {
      it("should return expected values, decimals 10, 27", async () => {
        const ret = await facade.toMantissa(
          parseUnits("9", 18),
          10,
          27
        );
        expect(ret.eq(parseUnits("9", 35)));
      });
      it("should return expected values, decimals 0, 0", async () => {
        const ret = await facade.toMantissa(
          parseUnits("9", 18),
          0,
          0
        );
        expect(ret.eq(parseUnits("9", 18)));
      });
    });
  });

  describe("removeLastItems (address)", () => {
    it("remove 2 items - should return expected values", async () => {
      const src = [MaticAddresses.DAI, MaticAddresses.WMATIC, MaticAddresses.USDC];
      const expected = [MaticAddresses.DAI];
      const ret = await facade["removeLastItems(address[],uint256)"](src, 1);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove 1 item - should return expected values", async () => {
      const src = [MaticAddresses.DAI, MaticAddresses.WMATIC, MaticAddresses.USDC];
      const expected = [MaticAddresses.DAI, MaticAddresses.WMATIC];
      const ret = await facade["removeLastItems(address[],uint256)"](src, 2);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove 0 items - should return expected values", async () => {
      const src = [MaticAddresses.DAI, MaticAddresses.WMATIC, MaticAddresses.USDC];
      const expected = [MaticAddresses.DAI, MaticAddresses.WMATIC, MaticAddresses.USDC];
      const ret = await facade["removeLastItems(address[],uint256)"](src, 3);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove all items - should return empty array", async () => {
      const src = [MaticAddresses.DAI, MaticAddresses.WMATIC, MaticAddresses.USDC];
      const ret = await facade["removeLastItems(address[],uint256)"](src, 0);
      expect(ret.join().toLowerCase()).eq([].join().toLowerCase());
    });
  });

  describe("removeLastItems (uint)", () => {
    it("remove 2 items - should return expected values", async () => {
      const src = [1, 2, 3];
      const expected = [1];
      const ret = await facade["removeLastItems(uint256[],uint256)"](src, 1);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove 1 item - should return expected values", async () => {
      const src = [1, 2, 3];
      const expected = [1, 2];
      const ret = await facade["removeLastItems(uint256[],uint256)"](src, 2);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove 0 items - should return expected values", async () => {
      const src = [1, 2, 3];
      const expected = [1, 2, 3];
      const ret = await facade["removeLastItems(uint256[],uint256)"](src, 3);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove all items - should return empty array", async () => {
      const src = [1, 2, 3];
      const ret = await facade["removeLastItems(uint256[],uint256)"](src, 0);
      expect(ret.join().toLowerCase()).eq([].join().toLowerCase());
    });
  });

  describe("approxEqual", () => {
    it("should return true", async () => {
      const amount1 = parseUnits("1", 18).add(1e9);
      const amount2 = parseUnits("1", 18).add(2e9);
      console.log(amount1.toString(), amount2.toString());
      const ret = await facade.approxEqual(amount1, amount2, 1e10);
      expect(ret).eq(true);
    });
    it("should return false", async () => {
      const amount1 = parseUnits("1", 18).add(1e11);
      const amount2 = parseUnits("1", 18).add(2e11);
      console.log(amount1.toString(), amount2.toString());
      const ret = await facade.approxEqual(amount1, amount2, 1e10);
      expect(ret).eq(false);
    });
  });

  describe("shrinkAndOrder", () => {
    describe("Good paths", () => {
      describe("All items are not zero", () => {
        it("should return expected values, reverse ordering", async () => {
          const bb = [
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
          ];
          const cc = [1, 2, 3, 4, 5];
          const dd = [6, 7, 8, 9, 10];
          const aa = [51, 41, 31, 21, 11];
          const r = await facade.shrinkAndOrder(5, bb, cc, dd, aa);

          const ret = [
            r.bbOut.map(x => BalanceUtils.toString(x)).join(),
            r.ccOut.map(x => BalanceUtils.toString(x)).join(),
            r.ddOut.map(x => BalanceUtils.toString(x)).join(),
            r.aaOut.map(x => BalanceUtils.toString(x)).join(),
          ].join("\n");

          const expected = [
            [bb[4], bb[3], bb[2], bb[1], bb[0]].map(x => BalanceUtils.toString(x)).join(),
            [5, 4, 3, 2, 1].map(x => BalanceUtils.toString(x)).join(),
            [10, 9, 8, 7, 6].map(x => BalanceUtils.toString(x)).join(),
            [11, 21, 31, 41, 51].map(x => BalanceUtils.toString(x)).join(),
          ].join("\n");

          expect(ret).eq(expected);
        });
        it("should return expected values, random ordering", async () => {
          const bb = [
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
          ];
          const cc = [1, 2, 3, 4, 5];
          const dd = [6, 7, 8, 9, 10];
          const aa = [14, 65, 16, 31, 77];
          const r = await facade.shrinkAndOrder(5, bb, cc, dd, aa);

          const ret = [
            r.bbOut.map(x => BalanceUtils.toString(x)).join(),
            r.ccOut.map(x => BalanceUtils.toString(x)).join(),
            r.ddOut.map(x => BalanceUtils.toString(x)).join(),
            r.aaOut.map(x => BalanceUtils.toString(x)).join(),
          ].join("\n");

          const expected = [
            [bb[0], bb[2], bb[3], bb[1], bb[4]].map(x => BalanceUtils.toString(x)).join(),
            [cc[0], cc[2], cc[3], cc[1], cc[4]].map(x => BalanceUtils.toString(x)).join(),
            [dd[0], dd[2], dd[3], dd[1], dd[4]].map(x => BalanceUtils.toString(x)).join(),
            [14, 16, 31, 65, 77].map(x => BalanceUtils.toString(x)).join(),
          ].join("\n");

          expect(ret).eq(expected);
        });
      });
      describe("Some items are zero", () => {
        it("should return expected values, random ordering", async () => {
          const bb = [
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
            Misc.ZERO_ADDRESS,
            Misc.ZERO_ADDRESS,
            Misc.ZERO_ADDRESS
          ];
          const cc = [1, 2, 3, 4, 5, 6, 7, 8];
          const dd = [6, 7, 8, 9, 10, 11, 12, 13];
          const aa = [14, 65, 16, 31, 77, 80, 81, 82];
          const r = await facade.shrinkAndOrder(5, bb, cc, dd, aa);

          const ret = [
            r.bbOut.map(x => BalanceUtils.toString(x)).join(),
            r.ccOut.map(x => BalanceUtils.toString(x)).join(),
            r.ddOut.map(x => BalanceUtils.toString(x)).join(),
            r.aaOut.map(x => BalanceUtils.toString(x)).join(),
          ].join("\n");

          const expected = [
            [bb[0], bb[2], bb[3], bb[1], bb[4]].map(x => BalanceUtils.toString(x)).join(),
            [cc[0], cc[2], cc[3], cc[1], cc[4]].map(x => BalanceUtils.toString(x)).join(),
            [dd[0], dd[2], dd[3], dd[1], dd[4]].map(x => BalanceUtils.toString(x)).join(),
            [14, 16, 31, 65, 77].map(x => BalanceUtils.toString(x)).join(),
          ].join("\n");

          expect(ret).eq(expected);
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should return expected values", async () => {
        const bb = [
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address,
        ];
        const cc = [1, 2, 3, 4, 5];
        const dd = [6, 7, 8, 9, 10];
        const aa = [51, 41, 31, 21, 11];
        const gasUsed = await facade.estimateGas.shrinkAndOrder(5, bb, cc, dd, aa);

        controlGasLimitsEx(gasUsed, GAS_APP_UTILS_SHRINK_AND_ORDER, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });
//endregion Unit tests

});
