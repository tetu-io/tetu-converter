import {ethers} from "hardhat";
import {
  BorrowManager__factory,
  ConverterController__factory, DebtMonitor__factory, IControllerV2__factory,
  TetuConverter__factory
} from "../../typechain";
import {Misc} from "../../scripts/utils/Misc";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {parseUnits} from "ethers/lib/utils";
import {DForceChangePriceUtils} from "../baseUT/protocols/dforce/DForceChangePriceUtils";

describe("study, SCB708 - update several core contracts", () => {
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);

    // We need to replace DForce price oracle by custom one
    // because when we run all tests
    // DForce-prices deprecate before DForce tests are run
    // and we have TC-4 (zero price) error in DForce-tests
    await DForceChangePriceUtils.setupPriceOracleMock((await ethers.getSigners())[0]);
  });

  it("should return expected values", async () => {
    const converterControllerV14 = "0x2df21e2a115fcB3d850Fbc67237571bBfB566e99";
    const signer = (await ethers.getSigners())[0];
    const converterController = ConverterController__factory.connect(converterControllerV14, signer);
    const debtMonitor = DebtMonitor__factory.connect(await converterController.debtMonitor(), signer);
    const tetuConverter = TetuConverter__factory.connect(await converterController.tetuConverter(), signer);
    const borrowManager = BorrowManager__factory.connect(await converterController.borrowManager(), signer);
    const proxyUpdater = await converterController.proxyUpdater();

    // display current versions
    console.log("tetuConverter version", await tetuConverter.TETU_CONVERTER_VERSION());
    console.log("converterController version", await converterController.CONVERTER_CONTROLLER_VERSION());
    console.log("debtMonitor version", await debtMonitor.DEBT_MONITOR_VERSION());
    console.log("borrowManager version", await borrowManager.BORROW_MANAGER_VERSION());

    // upgrade core contracts to new version
    const controller = IControllerV2__factory.connect(proxyUpdater, signer);
    const controllerAsGov = controller.connect(await Misc.impersonate(await controller.governance()));

    const converterLogic = await DeployUtils.deployContract(signer, "TetuConverter");
    const debtMonitorLogic = await DeployUtils.deployContract(signer, "DebtMonitor");
    const borrowManagerLogic = await DeployUtils.deployContract(signer, "BorrowManager");
    const converterControllerLogic = await DeployUtils.deployContract(signer, "ConverterController");

    await controllerAsGov.announceProxyUpgrade(
      [tetuConverter.address, debtMonitor.address, borrowManager.address, converterController.address],
      [converterLogic.address, debtMonitorLogic.address, borrowManagerLogic.address, converterControllerLogic.address]
    );
    await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);
    await controllerAsGov.upgradeProxy(
      [tetuConverter.address, debtMonitor.address, borrowManager.address, converterController.address]
    );

    // display updated versions
    console.log("tetuConverter version", await tetuConverter.TETU_CONVERTER_VERSION());
    console.log("converterController version", await converterController.CONVERTER_CONTROLLER_VERSION());
    console.log("debtMonitor version", await debtMonitor.DEBT_MONITOR_VERSION());
    console.log("borrowManager version", await borrowManager.BORROW_MANAGER_VERSION());

    // try to set up controller
    const converterControllerAsGov = converterController.connect(
      await Misc.impersonate(await converterController.governance())
    );

    await converterControllerAsGov.setRebalanceOnBorrowEnabled(true);

    const plan = await borrowManager.findConverter(
      "0x",
      ethers.Wallet.createRandom().address,
      MaticAddresses.USDC,
      MaticAddresses.USDT,
      parseUnits("1", 6),
      1
    );

    console.log("plan", plan);
  });
});
