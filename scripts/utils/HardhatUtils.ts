import { reset } from '@nomicfoundation/hardhat-network-helpers';
import hre from 'hardhat';
import {BigNumber, ContractTransaction} from "ethers";
import {EnvSetup} from "./EnvSetup";

export const HARDHAT_NETWORK_ID = 31337;
export const POLYGON_NETWORK_ID = 137;

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
}

/**
 * @deprecated Check gas in separate it() and use @skip-on-coverage to skip such it() on coverage
 */
export function controlGasLimitsEx(
  gasUsed: BigNumber,
  gasLimit: number,
  f: (gasUsed: BigNumber, gasLimit: number) => void
) {
  const env = EnvSetup.getEnv();
  if (env.disableGasLimitControl === 1) {
    console.log(`Gas control is skipped: used=${gasUsed.toNumber()} limit=${gasLimit}}`);
  } else {
    f(gasUsed, gasLimit);
    console.log(`Limit - used = ${gasLimit - gasUsed.toNumber()}, used=${gasUsed.toNumber()}`);
  }
}
