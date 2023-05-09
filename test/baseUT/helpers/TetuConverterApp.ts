import {
  ConverterController,
  ITetuConverter, TetuConverter__factory,
} from "../../../typechain";
import {CoreContractsHelper} from "./CoreContractsHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {COUNT_BLOCKS_PER_DAY} from "../utils/aprUtils";
import {ILendingPlatformFabric, ILendingPlatformPoolInfo} from "../fabrics/ILendingPlatformFabric";
import {MocksHelper} from "./MocksHelper";
import {ethers} from "hardhat";

export interface IDeployInitFabricsSet {
  deploy: (controller: ConverterController) => Promise<string>,
  init: (deployedInstance: string) => Promise<void>,
}

export interface ICoreContractFabrics {
  tetuConverterFabric: IDeployInitFabricsSet;
  borrowManagerFabric: IDeployInitFabricsSet;
  debtMonitorFabric: IDeployInitFabricsSet;
  keeperFabric: IDeployInitFabricsSet;
  swapManagerFabric: IDeployInitFabricsSet;
  priceOracleFabric: () => Promise<string>;
  tetuLiquidatorFabric: () => Promise<string>;
}

export interface ICreateControllerParams {
  tetuConverterFabric?: IDeployInitFabricsSet;
  borrowManagerFabric?: IDeployInitFabricsSet;
  debtMonitorFabric?: IDeployInitFabricsSet;
  keeperFabric?: IDeployInitFabricsSet;
  swapManagerFabric?: IDeployInitFabricsSet;
  priceOracleFabric?: () => Promise<string>;

  minHealthFactor2?: number;
  targetHealthFactor2?: number;
  maxHealthFactor2?: number;
  countBlocksPerDay?: number;
  tetuLiquidatorAddress?: string;
  blocksPerDayAutoUpdatePeriodSecs?: number;
  debtGap?: number;
  proxyUpdater?: string;
}

export interface IBuildAppResults {
  tc: ITetuConverter;
  controller: ConverterController;
  pools: ILendingPlatformPoolInfo[]
}

export class TetuConverterApp {
  static async createController(deployer: SignerWithAddress, p?: ICreateControllerParams) : Promise<ConverterController> {
    const tetuConverterFabric = p?.tetuConverterFabric
      || (async (c) => (
          await CoreContractsHelper.createTetuConverter(deployer, c.address)).address
      );
    const borrowManagerFabric = p?.borrowManagerFabric
        || (async c => (await CoreContractsHelper.createBorrowManager(deployer, c.address)).address);
    const debtMonitorFabric = p?.debtMonitorFabric
      || (async (c) => (
          await CoreContractsHelper.createDebtMonitor(deployer, c.address)).address
      );
    const keeperFabric = p?.keeperFabric
      || (async c => (await CoreContractsHelper.createKeeper(
          deployer,
          c.address,
          (await MocksHelper.createKeeperCaller(deployer)).address, // default keeper caller
          p?.blocksPerDayAutoUpdatePeriodSecs
        )).address
      );
    const tetuLiquidatorFabric = async () => p?.tetuLiquidatorAddress
        || (await MocksHelper.createTetuLiquidatorMock(deployer, [], [])).address;
    const swapManagerFabric = p?.swapManagerFabric
      || (async (c, tetuLiquidator) => (
          await CoreContractsHelper.createSwapManager(deployer, c.address, tetuLiquidator)).address
      );
    const priceOracleFabric = p?.priceOracleFabric
        || (async () => (await CoreContractsHelper.createPriceOracle(deployer)).address
      );

    return CoreContractsHelper.createController(
      deployer,
      p?.proxyUpdater || ethers.Wallet.createRandom().address,
      tetuConverterFabric,
      borrowManagerFabric,
      debtMonitorFabric,
      keeperFabric,
      tetuLiquidatorFabric,
      swapManagerFabric,
      priceOracleFabric,
      p?.minHealthFactor2 || 101,
      p?.targetHealthFactor2 || 200,
      p?.maxHealthFactor2 || 400,
      p?.countBlocksPerDay || COUNT_BLOCKS_PER_DAY,
      p?.debtGap || 1_000
    );
  }

  static async buildApp(
    deployer: SignerWithAddress,
    fabrics?: ILendingPlatformFabric[],
    p?: ICreateControllerParams
  ) : Promise<IBuildAppResults> {
    const controller = await this.createController(deployer, p);

    const pools: ILendingPlatformPoolInfo[] = [];
    if (fabrics) {
      for (const fabric of fabrics) {
        const poolInfo: ILendingPlatformPoolInfo = await fabric.createAndRegisterPools(deployer, controller);
        pools.push(poolInfo);
      }
    }

    return {
      tc: await TetuConverter__factory.connect(await controller.tetuConverter(), deployer),
      controller,
      pools
    };
  }
}
