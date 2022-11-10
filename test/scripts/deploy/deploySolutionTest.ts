import {DeploySolutionUtils} from "../../../scripts/deploy/DeploySolutionUtils";
import {ethers} from "hardhat";

describe.skip("Just run DeploySolution script under debugger", () => {
  it("should return expected values", async () => {
    await DeploySolutionUtils.runMain((await ethers.getSigners())[0]);
  });
});