import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    BorrowManager__factory,
    ConverterController, ConverterController__factory,
    DebtMonitor__factory,
    Keeper__factory,
    PriceOracle, PriceOracleMoonwell,
    SwapManager__factory,
    TetuConverter__factory,
} from "../../../typechain";
import {BigNumber, ContractTransaction} from "ethers";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {COUNT_BLOCKS_PER_DAY} from "../utils/aprUtils";
import {parseUnits} from "ethers/lib/utils";
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

    const borrowManager = await fabrics.borrowManagerFabric.deploy();
    const keeper = await fabrics.keeperFabric.deploy();
    const swapManager = await fabrics.swapManagerFabric.deploy();
    const debtMonitor = await fabrics.debtMonitorFabric.deploy();
    const tetuConverter = await fabrics.tetuConverterFabric.deploy();

    await ConverterController__factory.connect(controller, deployer).init(
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
    if (fabrics.borrowManagerFabric.init) {
      await fabrics.borrowManagerFabric.init(controller, borrowManager);
    }
    if (fabrics.keeperFabric.init) {
      await fabrics.keeperFabric.init(controller, keeper);
    }
    if (fabrics.swapManagerFabric.init) {
      await fabrics.swapManagerFabric.init(controller, swapManager);
    }
    if (fabrics.debtMonitorFabric.init) {
      await fabrics.debtMonitorFabric.init(controller, debtMonitor);
    }
    if (fabrics.tetuConverterFabric.init) {
      await fabrics.tetuConverterFabric.init(controller, tetuConverter);
    }

    // change default values of controller to the required values
    const controllerAsGov = await ConverterController__factory.connect(controller, deployer);
    // maxHealthFactor2 was removed from initialize in ver.13
    await controllerAsGov.setMaxHealthFactor2(maxHealthFactor2);
    await controllerAsGov.setMinHealthFactor2(minHealthFactor2);
    await controllerAsGov.setTargetHealthFactor2(targetHealthFactor2);
    await controllerAsGov.setDebtGap(debtGap);

    return controllerAsGov;
  }

//region Deploy core contracts (no init calls)
  static async deployController(signer: SignerWithAddress): Promise<string> {
    return (ConverterController__factory.connect(await DeployUtils.deployProxy(signer, "ConverterController"), signer)).address;
  }
  public static async deployDebtMonitor(signer: SignerWithAddress): Promise<string> {
    return (DebtMonitor__factory.connect(await DeployUtils.deployProxy(signer, "DebtMonitor"), signer)).address;
  }

  public static async deployTetuConverter(signer: SignerWithAddress): Promise<string> {
    return (TetuConverter__factory.connect(await DeployUtils.deployProxy(signer, "TetuConverter"), signer)).address;
  }

  /** Create BorrowManager with mock as adapter */
  public static async deployBorrowManager(signer: SignerWithAddress): Promise<string> {
    return (BorrowManager__factory.connect(await DeployUtils.deployProxy(signer, "BorrowManager"), signer)).address;
  }

  /** Create SwapManager */
  public static async deploySwapManager(signer: SignerWithAddress): Promise<string> {
    return (SwapManager__factory.connect(await DeployUtils.deployProxy(signer, "SwapManager"), signer)).address;
  }

  public static async deployKeeper(signer: SignerWithAddress): Promise<string> {
    return (Keeper__factory.connect(await DeployUtils.deployProxy(signer,"Keeper"), signer)).address;
  }
//endregion Deploy core contracts (no init calls)

//region Initialize core contracts
  public static async initializeTetuConverter(signer: SignerWithAddress, controller: string, instance: string): Promise<ContractTransaction> {
    return TetuConverter__factory.connect(instance, signer).init(controller);
  }

  /** Create BorrowManager with mock as adapter */
  public static async initializeBorrowManager(
    signer: SignerWithAddress,
    controller: string,
    instance: string,
    rewardsFactor: BigNumber = parseUnits("0.9") // rewardsFactor must be less 1
  ): Promise<ContractTransaction> {
    return BorrowManager__factory.connect(instance, signer).init(controller, rewardsFactor);
  }

  public static async initializeDebtMonitor(signer: SignerWithAddress, controller: string, instance: string): Promise<ContractTransaction> {
    return DebtMonitor__factory.connect(instance, signer).init(controller);
  }

  public static async initializeKeeper(
    signer: SignerWithAddress,
    controller: string,
    instance: string,
    blocksPerDayAutoUpdatePeriodSec: number = 3 * 24 * 60 * 60 // 3 days by default
  ): Promise<ContractTransaction> {
    return Keeper__factory.connect(instance, signer).init(controller, blocksPerDayAutoUpdatePeriodSec);
  }

  public static async initializeSwapManager(signer: SignerWithAddress, controller: string, instance: string): Promise<ContractTransaction> {
    return SwapManager__factory.connect(instance, signer).init(controller);
  }
//endregion Initialize core contracts

//region Create core contracts

  public static async createPriceOracle(signer: SignerWithAddress, priceOracleAave3: string): Promise<PriceOracle> {
    return (await DeployUtils.deployContract(signer, "PriceOracle",priceOracleAave3)) as PriceOracle;
  }
  public static async createPriceOracleMoonwell(signer: SignerWithAddress, priceOracleMoonwell: string): Promise<PriceOracleMoonwell> {
      return (await DeployUtils.deployContract(signer, "PriceOracleMoonwell", priceOracleMoonwell)) as PriceOracleMoonwell;
  }
//endregion Create core contracts
}
