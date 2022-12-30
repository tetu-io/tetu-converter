import {EmulateExecutor} from "../../../scripts/emulate/EmulateExecutor";
import {EmulateWork} from "../../../scripts/emulate/EmulateWork";
import {IERC20Metadata__factory} from "../../../typechain";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {ethers} from "hardhat";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {Aave3PlatformFabric} from "../../baseUT/fabrics/Aave3PlatformFabric";
import {AaveTwoPlatformFabric} from "../../baseUT/fabrics/AaveTwoPlatformFabric";
import {DForcePlatformFabric} from "../../baseUT/fabrics/DForcePlatformFabric";
import {HundredFinancePlatformFabric} from "../../baseUT/fabrics/HundredFinancePlatformFabric";
import {Aave3ChangePricesUtils} from "../../baseUT/protocols/aave3/Aave3ChangePricesUtils";
import {AaveTwoChangePricesUtils} from "../../baseUT/protocols/aaveTwo/AaveTwoChangePricesUtils";
import {DForceChangePriceUtils} from "../../baseUT/protocols/dforce/DForceChangePriceUtils";
import {HundredFinanceChangePriceUtils} from "../../baseUT/protocols/hundred-finance/HundredFinanceChangePriceUtils";

describe.skip("Run real work emulator", () => {
  const pathIn = "./scripts/emulate/data/ListCommands.csv";
  const pathOut = "./tmp/EmulationResults.csv";

  it("Run all commands", async () => {
    const signers = await ethers.getSigners();
    const deployer = signers[0];

    // attach custom price oracles to be able to manipulate with the prices
    const priceOracleAave3 = await Aave3ChangePricesUtils.setupPriceOracleMock(deployer);
    const priceOracleAaveTwo = await AaveTwoChangePricesUtils.setupPriceOracleMock(deployer);
    const priceOracleDForce = await DForceChangePriceUtils.setupPriceOracleMock(deployer);
    const priceOracleHundredFinance = await HundredFinanceChangePriceUtils.setupPriceOracleMock(deployer);

    const {controller, pools} = await TetuConverterApp.buildApp(
      deployer,
    [
        new Aave3PlatformFabric(),
        new AaveTwoPlatformFabric(),
        new DForcePlatformFabric(),
        new HundredFinancePlatformFabric(),
      ],
      {
        tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR,
        priceOracleFabric: () => priceOracleAave3.address
      }
    );
    const contractAddresses = new Map<string, string>([
      ["aave3:platformAdapter", pools[0].platformAdapter],
      ["aave2:platformAdapter", pools[1].platformAdapter],
      ["dforce:platformAdapter", pools[2].platformAdapter],
      ["hundredfinance:platformAdapter", pools[3].platformAdapter],

      ["aave3:priceOracle", priceOracleAave3.address],
      ["aave2:priceOracle", priceOracleAaveTwo.address],
      ["dforce:priceOracle", priceOracleDForce.address],
      ["hundredfinance:priceOracle", priceOracleHundredFinance.address],
    ]);
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
        IERC20Metadata__factory.connect(MaticAddresses.WMATIC, deployer),
        IERC20Metadata__factory.connect(MaticAddresses.DAI, deployer),
      ],
      contractAddresses
    );

    await EmulateExecutor.makeEmulation(
      emulator,
      pathIn,
      pathOut
    );
  });
});