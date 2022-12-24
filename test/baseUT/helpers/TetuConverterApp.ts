import {
  Controller,
  IERC20,
  ITetuConverter, KeeperCaller, TetuConverter__factory,
} from "../../../typechain";
import {CoreContractsHelper} from "./CoreContractsHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {COUNT_BLOCKS_PER_DAY} from "../utils/aprUtils";
import {ILendingPlatformFabric} from "../fabrics/ILendingPlatformFabric";
import {ethers} from "ethers";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {MocksHelper} from "./MocksHelper";

export interface ICreateControllerParams {
  tetuConverterFabric?: (controller: Controller) => Promise<string>;
  borrowManagerFabric?: (controller: Controller) => Promise<string>;
  debtMonitorFabric?: (controller: Controller) => Promise<string>;
  keeperFabric?: (controller: Controller) => Promise<string>;
  swapManagerFabric?: (controller: Controller) => Promise<string>;
  priceOracleFabric?: (controller: Controller) => Promise<string>;
  minHealthFactor2?: number;
  targetHealthFactor2?: number;
  maxHealthFactor2?: number;
  countBlocksPerDay?: number;
  tetuLiquidatorAddress?: string;
  blocksPerDayAutoUpdatePeriodSecs?: number;
}

export class TetuConverterApp {
  static async createController(
    deployer: SignerWithAddress,
    p?: ICreateControllerParams
  ) : Promise<Controller> {
    return CoreContractsHelper.createController(
      deployer,
      p?.tetuConverterFabric
        || (async c => (await CoreContractsHelper.createTetuConverter(deployer, c.address)).address),
      p?.borrowManagerFabric
        || (async c => (await CoreContractsHelper.createBorrowManager(deployer, c.address)).address),
      p?.debtMonitorFabric
        || (async c => (await CoreContractsHelper.createDebtMonitor(deployer, c.address)).address),
      p?.keeperFabric || (async c => (await CoreContractsHelper.createKeeper(
        deployer,
        c.address,
        (await MocksHelper.createKeeperCaller(deployer)).address, // default keeper caller
        p?.blocksPerDayAutoUpdatePeriodSecs
      )).address),
      async () => p?.tetuLiquidatorAddress
        || (await MocksHelper.createTetuLiquidatorMock(deployer, [], [])).address,
      p?.swapManagerFabric
        || (async c => (await CoreContractsHelper.createSwapManager(deployer, c.address)).address),
      p?.priceOracleFabric
        || (async c => (await CoreContractsHelper.createPriceOracle(deployer, c.address)).address),
      p?.minHealthFactor2 || 101,
      p?.targetHealthFactor2 || 200,
      p?.maxHealthFactor2 || 400,
      p?.countBlocksPerDay || COUNT_BLOCKS_PER_DAY,
    );
  }

  static async buildApp(
    deployer: SignerWithAddress,
    fabrics?: ILendingPlatformFabric[],
    p?: ICreateControllerParams
  ) : Promise<{tc: ITetuConverter, controller: Controller, pools: IERC20[]}> {
    const controller = await this.createController(deployer, p);

    const pools: IERC20[] = [];
    if (fabrics) {
      for (const fabric of fabrics) {
        const pp = await fabric.createAndRegisterPools(deployer, controller);
        pools.push(...pp);
      }
    }

    return {
      tc: await TetuConverter__factory.connect(await controller.tetuConverter(), deployer),
      controller,
      pools
    };
  }
}
