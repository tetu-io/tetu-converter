import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowManager, BorrowManager__factory,
  Controller, DebtMonitor,
  IController, Keeper, LendingPlatformMock,
  MockERC20, PoolStub,
  PriceOracleMock, SwapManager, TetuConverter,
} from "../../../typechain";
import {BigNumber, ethers} from "ethers";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {MocksHelper} from "./MocksHelper";
import {IPoolInfo} from "./BorrowManagerHelper";
import {COUNT_BLOCKS_PER_DAY} from "../utils/aprUtils";
import {Misc} from "../../../scripts/utils/Misc";
import {tetu} from "../../../typechain/contracts/integrations";
import {TetuConverterApp} from "./TetuConverterApp";
import {parseUnits} from "ethers/lib/utils";

export class CoreContractsHelper {
  static async deployController(deployer: SignerWithAddress): Promise<Controller> {
    return (await DeployUtils.deployContract(deployer, "Controller")) as Controller;
  }
  static async createController(
    deployer: SignerWithAddress,
    tetuConverterFabric: (controller: Controller) => Promise<string>,
    borrowManagerFabric: (controller: Controller) => Promise<string>,
    debtMonitorFabric: (controller: Controller) => Promise<string>,
    keeperFabric: (controller: Controller) => Promise<string>,
    tetuLiquidatorFabric: (controller: Controller) => Promise<string>,
    swapManagerFabric: (controller: Controller) => Promise<string>,
    minHealthFactor2: number = 101,
    targetHealthFactor2: number = 200,
    maxHealthFactor2: number = 400,
    countBlocksPerDay: number = COUNT_BLOCKS_PER_DAY
  ) : Promise<Controller>{
    const controller = await this.deployController(deployer);
    await controller.initialize(
      deployer.address,
      countBlocksPerDay,
      minHealthFactor2,
      targetHealthFactor2,
      maxHealthFactor2,
      await tetuConverterFabric(controller),
      await borrowManagerFabric(controller),
      await debtMonitorFabric(controller),
      await keeperFabric(controller),
      await tetuLiquidatorFabric(controller),
      await swapManagerFabric(controller)
    );
    return controller;
  }

  public static async createDebtMonitor(
    signer: SignerWithAddress,
    controllerAddress: string,
    thresholdAPR: number = 0,
    thresholdCountBlocks: number = 0
  ): Promise<DebtMonitor> {
    return (await DeployUtils.deployContract(
      signer,
      "DebtMonitor",
      controllerAddress,
      thresholdAPR,
      thresholdCountBlocks
    )) as DebtMonitor;
  }

  public static async createTetuConverter(
    signer: SignerWithAddress,
    controller: Controller,
  ): Promise<TetuConverter> {
    return (await DeployUtils.deployContract(
      signer,
      "TetuConverter",
      controller.address
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
    controller: IController,
  ) : Promise<SwapManager> {
    return (await DeployUtils.deployContract(
      signer,
      "SwapManager",
      controller.address,
    )) as SwapManager;
  }

  public static async createKeeper(
    signer: SignerWithAddress,
    controller: IController,
    gelatoOpsAddress: string
  ) : Promise<Keeper>{
    return (await DeployUtils.deployContract(
      signer,
      "Keeper",
      controller.address,
      gelatoOpsAddress
    )) as Keeper;
  }
}
