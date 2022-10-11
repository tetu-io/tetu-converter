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


export class TetuConverterApp {
  static async buildApp(
    deployer: SignerWithAddress,
    fabrics: ILendingPlatformFabric[]
  ) : Promise<{tc: ITetuConverter, controller: Controller, pools: IERC20[]}> {
    const controller = (await DeployUtils.deployContract(deployer
      , "Controller"
      , COUNT_BLOCKS_PER_DAY
      , 101
      , deployer.address
    )) as Controller;

    const bm = await CoreContractsHelper.createBorrowManager(deployer, controller);
    const tc = await CoreContractsHelper.createTetuConverter(deployer, controller);
    const dm = await CoreContractsHelper.createDebtMonitor(deployer, controller);

    const tetuLiquidatorAddress = '0x67e14A8Ebe89639945e4209CE3fE19e721633AC3';
    const swapManager = await CoreContractsHelper.createSwapManager(deployer, controller, tetuLiquidatorAddress);

    await controller.initialize(tc.address, bm.address, dm.address, ethers.Wallet.createRandom().address, tetuLiquidatorAddress, swapManager.address);

    const pools: IERC20[] = [];
    for (const fabric of fabrics) {
      const pp = await fabric.createAndRegisterPools(deployer, controller);
      pools.push(...pp);
    }

    return {tc, controller, pools};
  }
}
