import {ZkevmAddresses} from "../../../../scripts/addresses/ZkevmAddresses";

export class ZkevmUtils {
  static getAssetName(address: string): string {
    switch (address) {
      case ZkevmAddresses.USDC:
        return "usdc";
      case ZkevmAddresses.DAI:
        return "dai";
      case ZkevmAddresses.USDT:
        return "usdt"
      case ZkevmAddresses.WETH:
        return "weth";
      case ZkevmAddresses.MATIC:
        return "matic";
      default:
        return address;
    }
  }

  static getHolder(asset: string): string {
    throw Error(`holder not found for ${asset}`); // todo - remove function
  }

  static getAdditionalAssetHolders(asset: string): string[] {
    throw Error(`holder not found for ${asset}`); // todo - remove function
  }
}