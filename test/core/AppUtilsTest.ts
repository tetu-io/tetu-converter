import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {AppUtilsFacade, Controller, Controller__factory, IController__factory} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {controlGasLimitsEx, getGasUsed} from "../../scripts/utils/hardhatUtils";
import {GAS_LIMIT_CONTROLLER_INITIALIZE, GAS_LIMIT_CONTROLLER_SET_XXX} from "../baseUT/GasLimit";
import {Misc} from "../../scripts/utils/Misc";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {randomInt} from "crypto";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {parseUnits} from "ethers/lib/utils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";

describe("AppUtils", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let libFacade: AppUtilsFacade;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    libFacade = await DeployUtils.deployContract(deployer, "AppUtilsFacade") as AppUtilsFacade;
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
      it("should return expected values", async () => {
        const ret = await libFacade.toMantissa(
          parseUnits("9", 18),
          10,
          27
        );
        expect(ret.eq(parseUnits("9", 35)));
      });
      it("should return expected values", async () => {
        const ret = await libFacade.toMantissa(
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
      const ret = await libFacade["removeLastItems(address[],uint256)"](src, 1);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove 1 item - should return expected values", async () => {
      const src = [MaticAddresses.DAI, MaticAddresses.WMATIC, MaticAddresses.USDC];
      const expected = [MaticAddresses.DAI, MaticAddresses.WMATIC];
      const ret = await libFacade["removeLastItems(address[],uint256)"](src, 2);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove 0 items - should return expected values", async () => {
      const src = [MaticAddresses.DAI, MaticAddresses.WMATIC, MaticAddresses.USDC];
      const expected = [MaticAddresses.DAI, MaticAddresses.WMATIC, MaticAddresses.USDC];
      const ret = await libFacade["removeLastItems(address[],uint256)"](src, 3);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove all items - should return empty array", async () => {
      const src = [MaticAddresses.DAI, MaticAddresses.WMATIC, MaticAddresses.USDC];
      const expected: string[] = [];
      const ret = await libFacade["removeLastItems(address[],uint256)"](src, 0);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
  });

  describe("removeLastItems (uint)", () => {
    it("remove 2 items - should return expected values", async () => {
      const src = [1, 2, 3];
      const expected = [1];
      const ret = await libFacade["removeLastItems(uint256[],uint256)"](src, 1);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove 1 item - should return expected values", async () => {
      const src = [1, 2, 3];
      const expected = [1, 2];
      const ret = await libFacade["removeLastItems(uint256[],uint256)"](src, 2);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove 0 items - should return expected values", async () => {
      const src = [1, 2, 3];
      const expected = [1, 2, 3];
      const ret = await libFacade["removeLastItems(uint256[],uint256)"](src, 3);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove all items - should return empty array", async () => {
      const src = [1, 2, 3];
      const expected: number[] = [];
      const ret = await libFacade["removeLastItems(uint256[],uint256)"](src, 0);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
  });

  describe("approxEqual", () => {
    it("should return true", async () => {
      const amount1 = parseUnits("1", 18).add(1e9);
      const amount2 = parseUnits("1", 18).add(2e9);
      console.log(amount1.toString(), amount2.toString());
      const ret = await libFacade.approxEqual(amount1, amount2, 1e10);
      expect(ret).eq(true);
    });
    it("should return false", async () => {
      const amount1 = parseUnits("1", 18).add(1e11);
      const amount2 = parseUnits("1", 18).add(2e11);
      console.log(amount1.toString(), amount2.toString());
      const ret = await libFacade.approxEqual(amount1, amount2, 1e10);
      expect(ret).eq(false);
    });
  });
//endregion Unit tests

});
