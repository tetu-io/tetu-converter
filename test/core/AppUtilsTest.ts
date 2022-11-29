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

//endregion Unit tests

});
