import {ethers} from "hardhat";
import axios from "axios";
import {config as dotEnvConfig} from "dotenv";
import logSettings from "../../log_settings";
import {Logger} from "tslog";
import {EnvSetup} from "./EnvSetup";
import {Misc} from "./Misc";

// tslint:disable-next-line:no-var-requires
const hre = require("hardhat");
const log: Logger<unknown> = new Logger(logSettings);

export class VerifyUtils {
  public static async verify(address: string) {
    try {
      await hre.run("verify:verify", {
        address
      })
    } catch (e) {
      log.info('error verify ' + e);
    }
  }

  // tslint:disable-next-line:no-any
  public static async verifyWithArgs(address: string, args: any[]) {
    try {
      await hre.run("verify:verify", {
        address, constructorArguments: args
      })
    } catch (e) {
      log.info('error verify ' + e);
    }
  }

  // tslint:disable-next-line:no-any
  public static async verifyWithContractName(address: string, contractPath: string, args?: any[]) {
    try {
      await hre.run("verify:verify", {
        address, contract: contractPath, constructorArguments: args
      })
    } catch (e) {
      log.info('error verify ' + e);
    }
  }

  // tslint:disable-next-line:no-any
  public static async verifyWithArgsAndContractName(address: string, args: any[], contractPath: string) {
    try {
      await hre.run("verify:verify", {
        address, constructorArguments: args, contract: contractPath
      })
    } catch (e) {
      log.info('error verify ' + e);
    }
  }

  public static async verifyProxy(adr: string) {
    try {
      const env = EnvSetup.getEnv();
      const resp =
        await axios.post(
          (await VerifyUtils.getNetworkScanUrl()) +
          `?module=contract&action=verifyproxycontract&apikey=${env.networkScanKey}`,
          `address=${adr}`);
      // log.info("proxy verify resp", resp.data);
    } catch (e) {
      log.info('error proxy verify ' + adr + e);
    }
  }

  public static async getNetworkScanUrl(): Promise<string> {
    const chainName = Misc.getChainName();
    const chainId = Misc.getChainId();
    const net = (await ethers.provider.getNetwork());
    if (chainId === 'ropsten') {
      return 'https://api-ropsten.etherscan.io/api';
    } else if (chainName === 'kovan') {
      return 'https://api-kovan.etherscan.io/api';
    } else if (chainName === 'rinkeby') {
      return 'https://api-rinkeby.etherscan.io/api';
    } else if (chainName === 'ethereum') {
      return 'https://api.etherscan.io/api';
    } else if (chainName === 'matic') {
      return 'https://api.polygonscan.com/api'
    } else if (chainId === 80001) {
      return 'https://api-testnet.polygonscan.com/api'
    } else if (chainId === 250) {
      return 'https://api.ftmscan.com//api'
    } else {
      throw Error('network not found ' + net);
    }
  }

}
