import {
  ConverterController,
  ITetuConverter, TetuConverter__factory,
} from "../../../typechain";
import {CoreContractsHelper} from "./CoreContractsHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {COUNT_BLOCKS_PER_DAY} from "../utils/aprUtils";
import {MocksHelper} from "./MocksHelper";
import {ethers} from "hardhat";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {ILendingPlatformFabric, ILendingPlatformPoolInfo} from "../logic/fabrics/ILendingPlatformFabric";
import {
  BASE_NETWORK_ID,
  HARDHAT_NETWORK_ID,
  POLYGON_NETWORK_ID,
  ZKEVM_NETWORK_ID
} from "../../../scripts/utils/HardhatUtils";
import {BaseAddresses} from "../../../scripts/addresses/BaseAddresses";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";

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
  bookkeeperFabric: IDeployInitFabricsSet;
}

export interface ICreateControllerParams {
  /** see HardhatUtils.XXX_NETWORK_ID */
  networkId: number;

  tetuConverterFabric?: IDeployInitFabricsSet;
  borrowManagerFabric?: IDeployInitFabricsSet;
  debtMonitorFabric?: IDeployInitFabricsSet;
  keeperFabric?: IDeployInitFabricsSet;
  swapManagerFabric?: IDeployInitFabricsSet;
  bookkeeperFabric?: IDeployInitFabricsSet;
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
  static async createController(deployer: SignerWithAddress, p: ICreateControllerParams) : Promise<ConverterController> {
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
          p?.blocksPerDayAutoUpdatePeriodSec
        )}
      };

    const swapManagerFabric = p?.swapManagerFabric
      || {
        deploy: async () => (CoreContractsHelper.deploySwapManager(deployer)),
        init: async (controller, instance) => {await CoreContractsHelper.initializeSwapManager(deployer, controller, instance)}
      };

    const bookkeeperFabric = p?.bookkeeperFabric
      || {
        deploy: async () => CoreContractsHelper.deployBookkeeper(deployer),
        init: async (controller, instance) => {
          await CoreContractsHelper.initializeBookkeeper(deployer, controller, instance)
        }
      };

    const tetuLiquidatorFabric = async () => p?.tetuLiquidatorAddress
        || (await MocksHelper.createTetuLiquidatorMock(deployer, [], [])).address;
    const priceOracleFabric = p?.priceOracleFabric
        || (async () => this.getPriceOracleForNetwork(deployer, p?.networkId ?? HARDHAT_NETWORK_ID)
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
        priceOracleFabric,
        bookkeeperFabric
      },
      p?.minHealthFactor2 || 101,
      p?.targetHealthFactor2 || 200,
      p?.maxHealthFactor2 || 400,
      p?.countBlocksPerDay || COUNT_BLOCKS_PER_DAY,
      p?.debtGap || 1_000
    );
  }

  static async getPriceOracleForNetwork(deployer: SignerWithAddress, networkId: number): Promise<string> {
    switch (networkId) {
      case HARDHAT_NETWORK_ID:
        return (await MocksHelper.getPriceOracleMock(deployer, [], [])).address;
      case POLYGON_NETWORK_ID:
        return (await CoreContractsHelper.createPriceOracle(deployer, MaticAddresses.AAVE_V3_PRICE_ORACLE)).address;
      case BASE_NETWORK_ID:
        return (await CoreContractsHelper.createPriceOracleMoonwell(deployer, BaseAddresses.MOONWELL_CHAINLINK_ORACLE)).address
      case ZKEVM_NETWORK_ID:
        return (await CoreContractsHelper.createPriceOracleKeomZkevm(deployer, ZkevmAddresses.KEOM_PRICE_ORACLE)).address
      default:
        throw Error(`Price oracle for network ${networkId} was not found`);
    }
  }

  static async buildApp(deployer: SignerWithAddress, p: ICreateControllerParams, fabrics?: ILendingPlatformFabric[]) : Promise<IBuildAppResults> {
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
