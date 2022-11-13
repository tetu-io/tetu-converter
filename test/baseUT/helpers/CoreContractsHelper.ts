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

export class CoreContractsHelper {
  static async createController(
    deployer: SignerWithAddress,
    minHealthFactor2: number = 101,
    targetHealthFactor2: number = 200,
    maxHealthFactor2: number = 400,
    countBlocksPerDay: number = COUNT_BLOCKS_PER_DAY,
    initializeByEmptyAddresses: boolean = true
  ) : Promise<Controller>{
    const controller = (await DeployUtils.deployContract(deployer
      , "Controller"
      , countBlocksPerDay
      , deployer.address
      , minHealthFactor2
      , targetHealthFactor2
      , maxHealthFactor2
    )) as Controller;
    if (initializeByEmptyAddresses) {
      await controller.initialize(
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
      );
    }
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
    controller: IController,
    rewardsFactor: BigNumber = Misc.WEI // by default, set rewardsFactor = 1
  ) : Promise<BorrowManager> {
    return (await DeployUtils.deployContract(
      signer,
      "BorrowManager",
      controller.address,
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
