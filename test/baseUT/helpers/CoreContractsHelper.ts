import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowManager, Controller, DebtMonitor,
  IController, Keeper, PriceOracle, SwapManager, TetuConverter,
} from "../../../typechain";
import {BigNumber} from "ethers";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {COUNT_BLOCKS_PER_DAY} from "../utils/aprUtils";
import {parseUnits} from "ethers/lib/utils";

export class CoreContractsHelper {
  static async deployController(deployer: SignerWithAddress): Promise<Controller> {
    return (await DeployUtils.deployContract(deployer, "Controller")) as Controller;
  }
  static async createController(
    deployer: SignerWithAddress,
    tetuConverterFabric: (
      controller: Controller,
      borrowManager: string,
      debtMonitor: string,
      swapManager: string,
      keeper: string,
      priceOracle: string
    ) => Promise<string>,
    borrowManagerFabric: (controller: Controller) => Promise<string>,
    debtMonitorFabric: (
      controller: Controller,
      borrowManager: string
    ) => Promise<string>,
    keeperFabric: (controller: Controller) => Promise<string>,
    tetuLiquidatorFabric: () => Promise<string>,
    swapManagerFabric: (
      controller: Controller,
      tetuLiquidator: string,
      priceOracle: string
    ) => Promise<string>,
    priceOracleFabric: () => Promise<string>,
    minHealthFactor2: number = 101,
    targetHealthFactor2: number = 200,
    maxHealthFactor2: number = 400,
    countBlocksPerDay: number = COUNT_BLOCKS_PER_DAY
  ) : Promise<Controller>{
    const tetuLiquidator = await tetuLiquidatorFabric();
    const priceOracle = await priceOracleFabric();

    const controller = await this.deployController(deployer);
    const borrowManager = await borrowManagerFabric(controller);
    const keeper = await keeperFabric(controller);

    const swapManager = await swapManagerFabric(controller, tetuLiquidator, priceOracle);
    const debtMonitor = await debtMonitorFabric(controller, borrowManager);

    const tetuConverter = await tetuConverterFabric(
      controller,
      borrowManager,
      debtMonitor,
      swapManager,
      keeper,
      priceOracle
    );

    await controller.initialize(
      deployer.address,
      countBlocksPerDay,
      minHealthFactor2,
      targetHealthFactor2,
      maxHealthFactor2,
      tetuConverter,
      borrowManager,
      debtMonitor,
      keeper,
      tetuLiquidator,
      swapManager,
      priceOracle
    );
    return controller;
  }

  public static async createDebtMonitor(
    signer: SignerWithAddress,
    controllerAddress: string,
    borrowManager: string
    // thresholdAPR: number = 0,
    // thresholdCountBlocks: number = 0
  ): Promise<DebtMonitor> {
    return (await DeployUtils.deployContract(
      signer,
      "DebtMonitor",
      controllerAddress,
      borrowManager,
      // thresholdAPR,
      // thresholdCountBlocks
    )) as DebtMonitor;
  }

  public static async createTetuConverter(
    signer: SignerWithAddress,
    controller: string,
    borrowManager: string,
    debtMonitor: string,
    swapManager: string,
    keeper: string,
    priceOracle: string
  ): Promise<TetuConverter> {
    return (await DeployUtils.deployContract(
      signer,
      "TetuConverter",
      controller,
      borrowManager,
      debtMonitor,
      swapManager,
      keeper,
      priceOracle
    )) as TetuConverter;
  }

  /** Create BorrowManager with mock as adapter */
  public static async createBorrowManager (
    signer: SignerWithAddress,
    controller: string,
    rewardsFactor: BigNumber = parseUnits("0.9") // rewardsFactor must be less 1
  ) : Promise<BorrowManager> {
    return (await DeployUtils.deployContract(
      signer,
      "BorrowManager",
      controller,
      rewardsFactor
    )) as BorrowManager;
  }

  /** Create SwapManager */
  public static async createSwapManager (
    signer: SignerWithAddress,
    controller: string,
    tetuLiquidator: string,
    priceOracle: string
  ) : Promise<SwapManager> {
    return (await DeployUtils.deployContract(
      signer,
      "SwapManager",
      controller,
      tetuLiquidator,
      priceOracle
    )) as SwapManager;
  }

  public static async createKeeper(
    signer: SignerWithAddress,
    controller: string,
    gelatoOpsAddress: string,
    blocksPerDayAutoUpdatePeriodSecs: number = 2 * 7 * 24 * 60 * 60 // 2 weeks by default
  ) : Promise<Keeper>{
    return (await DeployUtils.deployContract(
      signer,
      "Keeper",
      controller,
      gelatoOpsAddress,
      blocksPerDayAutoUpdatePeriodSecs
    )) as Keeper;
  }

  public static async createPriceOracle (
    signer: SignerWithAddress,
  ) : Promise<PriceOracle> {
    return (await DeployUtils.deployContract(
      signer,
      "PriceOracle"
    )) as PriceOracle;
  }
}
