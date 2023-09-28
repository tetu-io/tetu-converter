import {EmulateExecutor} from "../../../scripts/emulate/EmulateExecutor";
import {EmulateWork} from "../../../scripts/emulate/EmulateWork";
import {IERC20Metadata__factory} from "../../../typechain";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {ethers} from "hardhat";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {Aave3PlatformFabric} from "../../baseUT/parts/fabrics/Aave3PlatformFabric";
import {AaveTwoPlatformFabric} from "../../baseUT/parts/fabrics/AaveTwoPlatformFabric";
import {DForcePlatformFabric} from "../../baseUT/parts/fabrics/DForcePlatformFabric";
import {Aave3ChangePricesUtils} from "../../baseUT/protocols/aave3/Aave3ChangePricesUtils";
import {AaveTwoChangePricesUtils} from "../../baseUT/protocols/aaveTwo/AaveTwoChangePricesUtils";
import {DForceChangePriceUtils} from "../../baseUT/protocols/dforce/DForceChangePriceUtils";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {MaticCore} from "../../baseUT/cores/maticCore";

describe.skip("Run real work emulator @skip-on-coverage", () => {
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
  });

  const pathIn = "./scripts/emulate/data/ListCommands.csv";
  const pathOut = "./tmp/EmulationResults.csv";

  it("Run all commands", async () => {
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const core = MaticCore.getCoreAave3();

    // attach custom price oracles to be able to manipulate with the prices
    const priceOracleAave3 = await Aave3ChangePricesUtils.setupPriceOracleMock(deployer, core);
    const priceOracleAaveTwo = await AaveTwoChangePricesUtils.setupPriceOracleMock(deployer);
    const priceOracleDForce = await DForceChangePriceUtils.setupPriceOracleMock(deployer);
    // const priceOracleHundredFinance = await HundredFinanceChangePriceUtils.setupPriceOracleMock(deployer);

    const {controller, pools} = await TetuConverterApp.buildApp(
      deployer,
    [
        new Aave3PlatformFabric(),
        new AaveTwoPlatformFabric(),
        new DForcePlatformFabric(),
        //new HundredFinancePlatformFabric(),
      ],
      {
        tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR,
        priceOracleFabric: async () => priceOracleAave3.address
      }
    );
    const contractAddresses = new Map<string, string>([
      ["aave3:platformAdapter", pools[0].platformAdapter],
      ["aave2:platformAdapter", pools[1].platformAdapter],
      ["dforce:platformAdapter", pools[2].platformAdapter],
      //["hf:platformAdapter", pools[3].platformAdapter],

      ["aave3:priceOracle", priceOracleAave3.address],
      ["aave2:priceOracle", priceOracleAaveTwo.address],
      ["dforce:priceOracle", priceOracleDForce.address],
      //["hf:priceOracle", priceOracleHundredFinance.address],
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