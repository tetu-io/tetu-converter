import {DeploySolutionUtils} from "../../../../scripts/deploy/DeploySolutionUtils";

describe("Just run DeploySolution script under debugger", () => {
  it("should return expected values", async () => {
    await DeploySolutionUtils.runMain();
  });
});