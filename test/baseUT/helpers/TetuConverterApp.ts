import {
  Controller,
  IERC20,
  ITetuConverter,
} from "../../../typechain";
import {CoreContractsHelper} from "./CoreContractsHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {COUNT_BLOCKS_PER_DAY} from "../utils/aprUtils";
import {ILendingPlatformFabric} from "../fabrics/ILendingPlatformFabric";
import {ethers} from "ethers";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {MocksHelper} from "./MocksHelper";


export class TetuConverterApp {
  static async buildApp(
    deployer: SignerWithAddress,
    fabrics?: ILendingPlatformFabric[]
  ) : Promise<{tc: ITetuConverter, controller: Controller, pools: IERC20[]}> {
    const controller = (await DeployUtils.deployContract(deployer
      , "Controller"
      , COUNT_BLOCKS_PER_DAY
      , deployer.address
      , 101
      , 200
      , 400
    )) as Controller;

    const borrowManager = await CoreContractsHelper.createBorrowManager(deployer, controller);
    const tetuConverter: ITetuConverter = await CoreContractsHelper.createTetuConverter(deployer, controller);
    const debtMonitor = await CoreContractsHelper.createDebtMonitor(deployer, controller);

    const tetuLiquidatorAddress = MaticAddresses.TETU_LIQUIDATOR;
    const swapManager = await CoreContractsHelper.createSwapManager(deployer, controller);
    const keeperCaller = await MocksHelper.createKeeperCaller(deployer);

    const keeper = await CoreContractsHelper.createKeeper(
      deployer,
      controller,
      keeperCaller.address // gelato OpsReady
    );

    await controller.initialize(tetuConverter.address,
      borrowManager.address,
      debtMonitor.address,
      keeper.address,
      tetuLiquidatorAddress,
      swapManager.address
    );

    const pools: IERC20[] = [];
    if (fabrics) {
      for (const fabric of fabrics) {
        const pp = await fabric.createAndRegisterPools(deployer, controller);
        pools.push(...pp);
      }
    }

    return {tc: tetuConverter, controller, pools};
  }
}
