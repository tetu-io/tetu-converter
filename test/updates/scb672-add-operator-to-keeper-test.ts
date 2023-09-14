import {ethers} from "hardhat";
import {
  ConverterController__factory, DebtMonitor__factory,
  IPoolAdapter__factory,
  Keeper__factory,
  ProxyControlled__factory
} from "../../typechain";
import {Misc} from "../../scripts/utils/Misc";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {PriceOracleManagerUtils} from "../baseUT/utils/PriceOracleManagerUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {DForceChangePriceUtils} from "../baseUT/protocols/dforce/DForceChangePriceUtils";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../scripts/utils/HardhatUtils";

describe.skip("study, SCB672 - update keeper, check fixHealth", () => {
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
  });

  it("should return expected values", async () => {
    const converterControllerV14 = "0x2df21e2a115fcB3d850Fbc67237571bBfB566e99";
    const signer = (await ethers.getSigners())[0];
    const controller = ConverterController__factory.connect(converterControllerV14, signer);
    const debtMonitor = DebtMonitor__factory.connect(await controller.debtMonitor(), signer);

    const governance = await controller.governance();
    const proxyUpdater = await controller.proxyUpdater();

    // upgrade Keeper to new version
    const keeperProxy = ProxyControlled__factory.connect(await controller.keeper(), await Misc.impersonate(proxyUpdater));
    const keeperNewImplementation = (await DeployUtils.deployContract(signer, "Keeper")).address;
    await keeperProxy.upgrade(keeperNewImplementation);

    // inject debug version of the TetuConverter
    // const tetuConverterProxy = ProxyControlled__factory.connect(await controller.tetuConverter(), await Misc.impersonate(proxyUpdater));
    // const tetuConverterNewImplementation = (await DeployUtils.deployContract(signer, "TetuConverter")).address;
    // await tetuConverterProxy.upgrade(tetuConverterNewImplementation);

    // deploy test keeper-caller and register it as an operator
    const keeperCaller = await MocksHelper.createKeeperCaller(signer);
    await keeperCaller.setupKeeper(keeperProxy.address, keeperProxy.address);

    // get all opened positions
    const countPositions = (await debtMonitor.getCountPositions()).toNumber();
    const borrows = [];
    for (let i = 0; i < countPositions; i++) {
      const borrow = await debtMonitor.positions(i);
      borrows.push(borrow);
      console.log("Pool adapter with opened borrow", borrow);
    }

    // register keeper-caller as operator
    const keeper = Keeper__factory.connect(keeperProxy.address, await Misc.impersonate(governance));
    await keeper.changeOperatorStatus(keeperCaller.address, true);

    // get current statuses
    const priceManager = await PriceOracleManagerUtils.build(signer, await controller.tetuConverter());
    const dForcePriceOracle = await DForceChangePriceUtils.setupPriceOracleMock(signer, true);

    const before = await keeper.checker();
    console.log("Before change price", before);

    for (const b of borrows) {
      const status = await IPoolAdapter__factory.connect(b, signer).getStatus();
      const config = await IPoolAdapter__factory.connect(b, signer).getConfig();
      console.log("Status initial", status, config);
    }

    // change prices to force call of fixHealth
    await priceManager.decPrice(MaticAddresses.USDC, 5);
    await priceManager.incPrice(MaticAddresses.USDT, 5);

    await dForcePriceOracle.changePrice(MaticAddresses.dForce_iUSDC, 95);
    await dForcePriceOracle.changePrice(MaticAddresses.dForce_iUSDT, 105);

    // get prices after changing of the prices
    for (const b of borrows) {
      const status = await IPoolAdapter__factory.connect(b, signer).getStatus();
      console.log("Status with changed prices", status);
    }

    const after = await keeper.checker();
    console.log("After change price", after);

    await keeperCaller.callChecker();

    for (const b of borrows) {
      const status = await IPoolAdapter__factory.connect(b, signer).getStatus();
      console.log("Status after fixHealth", status);
    }

    // nothing to check, it's study test
  });
});
