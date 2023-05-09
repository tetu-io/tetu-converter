import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowManager, BorrowManager__factory,
  ConverterController, ConverterController__factory,
  DebtMonitor, DebtMonitor__factory, IDebtMonitor__factory,
  Keeper, Keeper__factory,
  PriceOracle,
  SwapManager, SwapManager__factory,
  TetuConverter, TetuConverter__factory,
} from "../../../typechain";
import {BigNumber} from "ethers";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {COUNT_BLOCKS_PER_DAY} from "../utils/aprUtils";
import {parseUnits} from "ethers/lib/utils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {Misc} from "../../../scripts/utils/Misc";
import {ICoreContractFabrics} from "./TetuConverterApp";

export class CoreContractsHelper {
  static async createController(
    deployer: SignerWithAddress,
    proxyUpdater: string,
    fabrics: ICoreContractFabrics,
    minHealthFactor2: number = 101,
    targetHealthFactor2: number = 200,
    maxHealthFactor2: number = 400,
    countBlocksPerDay: number = COUNT_BLOCKS_PER_DAY,
    debtGap: number = 1_000
  ): Promise<ConverterController> {
    const tetuLiquidator = await fabrics.tetuLiquidatorFabric();
    const priceOracle = await fabrics.priceOracleFabric();

    // deploy contracts but don't initialize them - we need to set up governance in controller at first
    const controller = await this.deployController(deployer);

    const borrowManager = await fabrics.borrowManagerFabric.deploy(controller);
    const keeper = await fabrics.keeperFabric.deploy(controller);
    const swapManager = await fabrics.swapManagerFabric.deploy(controller);
    const debtMonitor = await fabrics.debtMonitorFabric.deploy(controller);
    const tetuConverter = await fabrics.tetuConverterFabric.deploy(controller);

    await controller.init(
      proxyUpdater,
      deployer.address,
      tetuConverter,
      borrowManager,
      debtMonitor,
      keeper,
      swapManager,
      priceOracle,
      tetuLiquidator,
      countBlocksPerDay
    );

    // initialize all core contracts
    await fabrics.borrowManagerFabric.init(borrowManager);
    await fabrics.keeperFabric.init(keeper);
    await fabrics.swapManagerFabric.init(swapManager);
    await fabrics.debtMonitorFabric.init(debtMonitor);
    await fabrics.tetuConverterFabric.init(tetuConverter);

    // change default values of controller to the required values
    const controllerAsGov = await controller.connect(await Misc.impersonate(await controller.governance()));
    // maxHealthFactor2 was removed from initialize in ver.13
    await controllerAsGov.setMaxHealthFactor2(maxHealthFactor2);
    await controllerAsGov.setMinHealthFactor2(minHealthFactor2);
    await controllerAsGov.setTargetHealthFactor2(targetHealthFactor2);
    await controllerAsGov.setDebtGap(debtGap);

    return controller;
  }

//region Deploy core contracts (no init calls)
  static async deployController(signer: SignerWithAddress): Promise<ConverterController> {
    return ConverterController__factory.connect(await DeployUtils.deployProxy(signer, "ConverterController"), signer);
  }
  public static async deployDebtMonitor(signer: SignerWithAddress): Promise<DebtMonitor> {
    return DebtMonitor__factory.connect(await DeployUtils.deployProxy(signer, "DebtMonitor"), signer);
  }

  public static async deployTetuConverter(signer: SignerWithAddress): Promise<TetuConverter> {
    return TetuConverter__factory.connect(await DeployUtils.deployProxy(signer, "TetuConverter"), signer);
  }

  /** Create BorrowManager with mock as adapter */
  public static async deployBorrowManager(signer: SignerWithAddress): Promise<BorrowManager> {
    return BorrowManager__factory.connect(await DeployUtils.deployProxy(signer, "BorrowManager"), signer);
  }

  /** Create SwapManager */
  public static async deploySwapManager(signer: SignerWithAddress): Promise<SwapManager> {
    return SwapManager__factory.connect(await DeployUtils.deployProxy(signer, "SwapManager"), signer);
  }

  public static async deployKeeper(signer: SignerWithAddress): Promise<Keeper> {
    return Keeper__factory.connect(await DeployUtils.deployProxy(signer,"Keeper"), signer);
  }
//endregion Deploy core contracts (no init calls)

//region Create core contracts
  public static async createTetuConverter(signer: SignerWithAddress, controller: string): Promise<TetuConverter> {
    const tetuConverter = await this.deployTetuConverter(signer);
    await tetuConverter.init(controller);
    return tetuConverter;
  }

  /** Create BorrowManager with mock as adapter */
  public static async createBorrowManager(
    signer: SignerWithAddress,
    controller: string,
    rewardsFactor: BigNumber = parseUnits("0.9") // rewardsFactor must be less 1
  ): Promise<BorrowManager> {
    const borrowManager = await this.deployBorrowManager(signer);
    await borrowManager.init(controller, rewardsFactor);
    return borrowManager;
  }

  public static async createDebtMonitor(signer: SignerWithAddress, controllerAddress: string): Promise<DebtMonitor> {
    const debtMonitor= await this.deployDebtMonitor(signer);
    await debtMonitor.init(controllerAddress);
    return debtMonitor;
  }

  public static async createKeeper(
    signer: SignerWithAddress,
    controller: string,
    gelatoOpsAddress: string,
    blocksPerDayAutoUpdatePeriodSecs: number = 3 * 24 * 60 * 60 // 3 days by default
  ): Promise<Keeper> {
    const keeper = await this.deployKeeper(signer);
    await keeper.init(controller, gelatoOpsAddress, blocksPerDayAutoUpdatePeriodSecs);
    return keeper;
  }

  public static async createSwapManager(signer: SignerWithAddress, controller: string): Promise<SwapManager> {
    const swapManager = await this.deploySwapManager(signer);
    await swapManager.init(controller);
    return swapManager;
  }

  public static async createPriceOracle(signer: SignerWithAddress, priceOracleAave3?: string): Promise<PriceOracle> {
    return (await DeployUtils.deployContract(
      signer,
      "PriceOracle",
      priceOracleAave3 || MaticAddresses.AAVE_V3_PRICE_ORACLE
    )) as PriceOracle;
  }
//endregion Create core contracts
}
