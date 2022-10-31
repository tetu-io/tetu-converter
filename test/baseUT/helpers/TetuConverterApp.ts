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

    const bm = await CoreContractsHelper.createBorrowManager(deployer, controller);
    const tc: ITetuConverter = await CoreContractsHelper.createTetuConverter(deployer, controller);
    const dm = await CoreContractsHelper.createDebtMonitor(deployer, controller);

    const tetuLiquidatorAddress = MaticAddresses.TETU_LIQUIDATOR;
    const swapManager = await CoreContractsHelper.createSwapManager(deployer, controller);

    await controller.initialize(tc.address,
      bm.address,
      dm.address,
      ethers.Wallet.createRandom().address, // keeper
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

    return {tc, controller, pools};
  }
}
