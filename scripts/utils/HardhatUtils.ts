import { reset } from '@nomicfoundation/hardhat-network-helpers';
import hre from 'hardhat';
import {BigNumber, ContractTransaction} from "ethers";
import {EnvSetup} from "./EnvSetup";

export const HARDHAT_NETWORK_ID = 31337;
export const POLYGON_NETWORK_ID = 137;
export const BASE_NETWORK_ID = 8453;
export const ZKEVM_NETWORK_ID = 1101;

interface IEnvData {
  rpcUrl: string;
  forkBlock: number;
}

export class HardhatUtils {

  static async switchToMostCurrentBlock() {
    await reset(EnvSetup.getEnv().maticRpcUrl);
  }

  static async switchToBlock(block: number, chain: number = POLYGON_NETWORK_ID) {
    const envData = this.getEnvData(chain);
    if (envData) {
      await reset(envData.rpcUrl, block === -1 ? undefined : block);
    } else {
      await reset();
    }
  }

  static async restoreBlockFromEnv() {
    await reset(EnvSetup.getEnv().maticRpcUrl, EnvSetup.getEnv().maticForkBlock);
  }

  public static async setupBeforeTest(chainId: number = HARDHAT_NETWORK_ID, block?: number) {
    const env = EnvSetup.getEnv();
    hre.config.networks.hardhat.chainId = chainId;
    // setup fresh hardhat fork with given chain id
    if (chainId === HARDHAT_NETWORK_ID) {
      await reset();
    } else if (chainId === POLYGON_NETWORK_ID) {
      await reset(env.maticRpcUrl, block ? block === -1 ? undefined : block : env.maticForkBlock);
    } else if (chainId === BASE_NETWORK_ID) {
      await reset(env.baseRpcUrl, block ? block === -1 ? undefined : block : env.baseForkBlock);
    } else if (chainId === ZKEVM_NETWORK_ID) {
      await reset(env.zkevmRpcUrl, block ? block === -1 ? undefined : block : env.zkevmForkBlock);
    } else {
      throw new Error('Unknown chain id ' + chainId);
    }
  }

  static async getGasUsed(p: Promise<ContractTransaction>): Promise<BigNumber> {
    const tx = await p;
    const rec = await tx.wait();
    console.log("Gas used: ", rec.gasUsed.toNumber());
    return rec.gasUsed;
  }

  static getNetworkName(chainId: number): string {
    if (chainId === HARDHAT_NETWORK_ID) return "hardhat";
    if (chainId === POLYGON_NETWORK_ID) return "polygon";
    if (chainId === BASE_NETWORK_ID) return "base";
    if (chainId === ZKEVM_NETWORK_ID) return "zkevm";
    return "unknown chain";
  }

  public static getEnvData(chainId: number) : IEnvData | undefined {
    const env = EnvSetup.getEnv();
    if (chainId === HARDHAT_NETWORK_ID) {
      return undefined;
    } else if (chainId === POLYGON_NETWORK_ID) {
      return {rpcUrl: env.maticRpcUrl, forkBlock: env.maticForkBlock};
    } else if (chainId === BASE_NETWORK_ID) {
      return {rpcUrl: env.baseRpcUrl, forkBlock: env.baseForkBlock};
    } else if (chainId === ZKEVM_NETWORK_ID) {
      return {rpcUrl: env.zkevmRpcUrl, forkBlock: env.zkevmForkBlock};
    }
  }
}

export function controlGasLimitsEx2(
  gasUsed: BigNumber,
  gasLimit: number,
  f: (gasUsed: BigNumber, gasLimit: number) => void
) {
  f(gasUsed, gasLimit);
  console.log(`Limit - used = ${gasLimit - gasUsed.toNumber()}, used=${gasUsed.toNumber()}`);
}
