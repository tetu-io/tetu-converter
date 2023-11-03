import { reset } from '@nomicfoundation/hardhat-network-helpers';
import hre from 'hardhat';
import {BigNumber, ContractTransaction} from "ethers";
import {EnvSetup} from "./EnvSetup";

export const HARDHAT_NETWORK_ID = 31337;
export const POLYGON_NETWORK_ID = 137;
export const BASE_NETWORK_ID = 8453;

export class HardhatUtils {

  static async switchToMostCurrentBlock() {
    await reset(EnvSetup.getEnv().maticRpcUrl);
  }

  static async switchToBlock(block: number) {
    await reset(EnvSetup.getEnv().maticRpcUrl, block);
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
    return "unknown chain";
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
