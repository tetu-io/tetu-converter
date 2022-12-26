import {EmulateExecutor} from "../../../scripts/emulate/EmulateExecutor";
import {EmulateWork} from "../../../scripts/emulate/EmulateWork";
import {Borrower, Controller, IERC20Metadata, IERC20Metadata__factory} from "../../../typechain";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {ethers} from "hardhat";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";

describe("Run real work emulator", () => {
  const pathIn = "./scripts/emulate/data/ListCommands.csv";
  const pathOut = "./tmp/EmulationResults.csv";
  it("Run all commands", async () => {
    const signers = await ethers.getSigners();
    const deployer = signers[0];

    const controller = await TetuConverterApp.createController(
      deployer,
      {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
    );
    const users = [
      await MocksHelper.deployBorrower(deployer.address, controller, 1000),
      await MocksHelper.deployBorrower(deployer.address, controller, 1000),
      await MocksHelper.deployBorrower(deployer.address, controller, 1000),
    ];

    const emulator = new EmulateWork(
      controller,
      users,
      [
        IERC20Metadata__factory.connect(MaticAddresses.USDC, deployer),
        IERC20Metadata__factory.connect(MaticAddresses.USDT, deployer),
        IERC20Metadata__factory.connect(MaticAddresses.WETH, deployer),
        IERC20Metadata__factory.connect(MaticAddresses.DAI, deployer),
      ]
    );

    await EmulateExecutor.makeEmulation(
      emulator,
      pathIn,
      pathOut
    );
  });
});