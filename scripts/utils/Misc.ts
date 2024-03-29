import {ethers} from "hardhat";
import {Logger} from "tslog";
import logSettings from "../../log_settings";
import {BigNumber, ContractTransaction} from "ethers";
import Common from 'ethereumjs-common';

// tslint:disable-next-line:no-var-requires
const hre = require("hardhat");
const log: Logger<unknown> = new Logger(logSettings);

const MATIC_CHAIN = Common.forCustomChain(
  'mainnet', {
    name: 'matic',
    networkId: 137,
    chainId: 137,
  },
  'petersburg',
);

const FANTOM_CHAIN = Common.forCustomChain(
  'mainnet', {
    name: 'fantom',
    networkId: 250,
    chainId: 250,
  },
  'petersburg',
);

const BASE_CHAIN = Common.forCustomChain(
  'mainnet', {
    name: 'base-mainnet',
    networkId: 8453,
    chainId: 8453,
  },
  'petersburg',
);

export class Misc {
  public static readonly MAX_UINT = BigNumber.from('115792089237316195423570985008687907853269984665640564039457584007913129639935');  // BigNumber.from(2).pow(256).sub(1), // === type(uint).max
  public static readonly HUGE_UINT = BigNumber.from(2).pow(255); // 2 ** 255 is more gas efficient then type(uint).max
  public static readonly SECONDS_OF_DAY = 60 * 60 * 24;
  public static readonly SECONDS_OF_YEAR = Misc.SECONDS_OF_DAY * 365;
  public static readonly ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  /** 1e18 */
  public static readonly WEI = BigNumber.from('1000000000000000000');
  /** 1e36 */
  public static readonly WEI_DOUBLE = BigNumber.from('1000000000000000000000000000000000000');
  /** 1e27 */
  public static readonly RAYS = BigNumber.from('1000000000000000000000000000');

  public static printDuration(text: string, start: number) {
    log.info('>>>' + text, ((Date.now() - start) / 1000).toFixed(1), 'sec');
  }

  public static getChainId() {
    return hre.network.config.chainId ?? 0;
  }

  public static getChainName() {
    return hre.network.name;
  }

  public static async getChainConfig() {
    const chainId = Misc.getChainId();
    switch (chainId) {
      case 137:
        return MATIC_CHAIN;
      case 250:
        return FANTOM_CHAIN;
      case 8453:
        return BASE_CHAIN;
      default:
        throw new Error('Unknown net ' + chainId);
    }
  }

  public static async impersonate(address: string) {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [address],
    });

    await hre.network.provider.request({
      method: "hardhat_setBalance",
      params: [address, "0x1431E0FAE6D7217CAA0000000"],
    });
    console.log('address impersonated', address);
    return ethers.getSigner(address);
  }


  // ****************** WAIT ******************

  public static async delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public static async wait(blocks: number) {
    if (hre.network.name === 'hardhat' || blocks === 0) {
      return;
    }
    const start = ethers.provider.blockNumber;
    while (true) {
      log.info('wait 10sec');
      await Misc.delay(10000);
      if (ethers.provider.blockNumber >= start + blocks) {
        break;
      }
    }
  }

}

export type Attributes = [
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber,
  BigNumber
] & {
  strength: BigNumber;
  dexterity: BigNumber;
  vitality: BigNumber;
  energy: BigNumber;
  damageMin: BigNumber;
  damageMax: BigNumber;
  attackRating: BigNumber;
  defense: BigNumber;
  blockRating: BigNumber;
  life: BigNumber;
  mana: BigNumber;
  fireResistance: BigNumber;
  coldResistance: BigNumber;
  lightningResistance: BigNumber;
};

export type Stats = [BigNumber, BigNumber, BigNumber, BigNumber] & {
  level: BigNumber;
  experience: BigNumber;
  life: BigNumber;
  mana: BigNumber;
};

