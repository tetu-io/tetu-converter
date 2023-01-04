import {DeploySolutionUtils} from "../../../scripts/deploy/DeploySolutionUtils";
import {ethers} from "hardhat";
import {IOps__factory} from "../../../typechain";

// depends on network
describe("Just run DeploySolution script under debugger", () => {
  it("should return expected values", async () => {
    console.log("gelato", await IOps__factory.connect(
      "0x527a819db1eb0e34426297b03bae11F2f8B3A19E",
      (await ethers.getSigners())[0]
    ).taskTreasury());

    await DeploySolutionUtils.runMain((await ethers.getSigners())[0]);
  });
});
