import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowManager, BorrowManager__factory,
  Controller, DebtMonitor,
  IController, LendingPlatformMock,
  MockERC20, PoolStub,
  PriceOracleMock, TetuConverter
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
    deployer: SignerWithAddress
  ) : Promise<Controller>{
    const controller = (await DeployUtils.deployContract(deployer
      , "Controller"
      , COUNT_BLOCKS_PER_DAY
      , 101
      , deployer.address
    )) as Controller;
    await controller.initialize(
      ethers.Wallet.createRandom().address
      , ethers.Wallet.createRandom().address
      , ethers.Wallet.createRandom().address
      , ethers.Wallet.createRandom().address
    );
    return controller;
  }

  public static async createDebtMonitor(
    signer: SignerWithAddress,
    controller: IController,
    thresholdAPR: number = 0,
    thresholdCountBlocks: number = 0
  ): Promise<DebtMonitor> {
    return (await DeployUtils.deployContract(
      signer,
      "DebtMonitor",
      controller.address,
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
  ) : Promise<BorrowManager> {
    return (await DeployUtils.deployContract(
      signer,
      "BorrowManager",
      controller.address,
      Misc.WEI // by default, set rewardsFactor = 1
    )) as BorrowManager;
  }

}