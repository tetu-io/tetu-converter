import {MaticDeploySolutionUtils} from "../../../scripts/chains/polygon/deploy/MaticDeploySolutionUtils";
import {ethers} from "hardhat";
import {IOps__factory} from "../../../typechain";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";

// depends on network
describe("Run DeploySolution script under debugger @skip-on-coverage", () => {
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
  });

  it("should return expected values", async () => {
    const gelato = "0x527a819db1eb0e34426297b03bae11F2f8B3A19E";
    const proxyUpdater = "0x33b27e0a2506a4a2fbc213a01c51d0451745343a"; // tetu-contracts-v2 controller

    console.log("gelato", await IOps__factory.connect(
      gelato,
      (await ethers.getSigners())[0]
    ).taskTreasury());

    const r = await MaticDeploySolutionUtils.runMain((await ethers.getSigners())[0], gelato, proxyUpdater);
    console.log(r);
  });
});
