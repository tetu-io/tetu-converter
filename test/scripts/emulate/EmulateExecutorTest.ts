import {EmulateExecutor} from "../../../scripts/emulate/EmulateExecutor";

describe("Run real work emulator", () => {
  const pathIn = "./scripts/emulate/data/ListCommands.csv";
  const pathOut = "./tmp/EmulationResults.csv";
  it("Run all commands", async () => {
    await EmulateExecutor.makeEmulation(pathIn, pathOut);
  });
});