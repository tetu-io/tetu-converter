import {MaticDeploySolutionUtils} from "../../../scripts/chains/polygon/deploy/MaticDeploySolutionUtils";
import {ethers} from "hardhat";
import {IOps__factory} from "../../../typechain";
import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BaseDeploySolutionUtils} from "../../../scripts/chains/base/deploy/BaseDeploySolutionUtils";

// depends on network
describe("Run DeploySolution script under debugger @skip-on-coverage", () => {
  let signer: SignerWithAddress;
  before(async function () {
    signer = (await ethers.getSigners())[0];
  });

  describe("Polygon chain", () => {
    before(async function () {
      await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    });

    it("should return expected values", async () => {
      const gelato = "0x527a819db1eb0e34426297b03bae11F2f8B3A19E";
      const proxyUpdater = "0x33b27e0a2506a4a2fbc213a01c51d0451745343a"; // tetu-contracts-v2 controller

      console.log("gelato", await IOps__factory.connect(gelato, signer).taskTreasury());

      const r = await MaticDeploySolutionUtils.runMain((await ethers.getSigners())[0], gelato, proxyUpdater);
      console.log(r);
    });
  });

  describe("Base chain", () => {
    before(async function () {
      await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
    });

    it("should return expected values", async () => {
      const proxyUpdater = signer.address;

      const r = await BaseDeploySolutionUtils.runMain((await ethers.getSigners())[0], proxyUpdater);
      console.log(r);
    });
  });
});
