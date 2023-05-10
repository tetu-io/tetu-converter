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
  deploy: () => Promise<string>,
  init?: (controller: string, deployedInstance: string) => Promise<void>,
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
  blocksPerDayAutoUpdatePeriodSec?: number;
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
      || {
      deploy: async () => CoreContractsHelper.deployTetuConverter(deployer),
      init: async (controller, instance) => {await CoreContractsHelper.initializeTetuConverter(deployer, controller, instance)}
      };

    const borrowManagerFabric = p?.borrowManagerFabric
        || {
        deploy: async () => CoreContractsHelper.deployBorrowManager(deployer),
        init: async (controller, instance) => {await CoreContractsHelper.initializeBorrowManager(deployer, controller, instance)}
      };

    const debtMonitorFabric = p?.debtMonitorFabric
      || {
        deploy: async () => CoreContractsHelper.deployDebtMonitor(deployer),
        init: async (controller, instance) => {await CoreContractsHelper.initializeDebtMonitor(deployer, controller, instance)}
      };

    const keeperFabric = p?.keeperFabric
      || {
        deploy: async () => CoreContractsHelper.deployKeeper(deployer),
        init: async (controller, instance) => {await CoreContractsHelper.initializeKeeper(
          deployer,
          controller,
          instance,
          (await MocksHelper.createKeeperCaller(deployer)).address, // default keeper caller
          p?.blocksPerDayAutoUpdatePeriodSec
        )}
      };

    const swapManagerFabric = p?.swapManagerFabric
      || {
        deploy: async () => (CoreContractsHelper.deploySwapManager(deployer)),
        init: async (controller, instance) => {await CoreContractsHelper.initializeSwapManager(deployer, controller, instance)}
      };

    const tetuLiquidatorFabric = async () => p?.tetuLiquidatorAddress
        || (await MocksHelper.createTetuLiquidatorMock(deployer, [], [])).address;
    const priceOracleFabric = p?.priceOracleFabric
        || (async () => (await CoreContractsHelper.createPriceOracle(deployer)).address
      );

    return CoreContractsHelper.createController(
      deployer,
      p?.proxyUpdater || ethers.Wallet.createRandom().address,
      {
        tetuConverterFabric,
        borrowManagerFabric,
        debtMonitorFabric,
        keeperFabric,
        tetuLiquidatorFabric,
        swapManagerFabric,
        priceOracleFabric
      },
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

  static getRandomSet(): IDeployInitFabricsSet {
    return {
      deploy: async () => ethers.Wallet.createRandom().address,
      init: async (controller: string, instance: string) => {}
    }
  }
}
