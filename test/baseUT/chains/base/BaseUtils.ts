import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";

export class BaseUtils {
  static getAssetName(address: string): string {
    switch (address) {
      case BaseAddresses.USDC:
        return "usdc";
      case BaseAddresses.DAI:
        return "dai";
      case BaseAddresses.cbETH:
        return "cbETH"
      case BaseAddresses.WETH:
        return "weth";
      case BaseAddresses.USDbC:
        return "USDbC";
      default:
        return address;
    }
  }

  static getHolder(asset: string): string {
    switch (asset) {
      case BaseAddresses.USDC:
        return BaseAddresses.HOLDER_USDC;
      case BaseAddresses.DAI:
        return BaseAddresses.HOLDER_DAI;
      case BaseAddresses.cbETH:
        return BaseAddresses.HOLDER_CBETH;
      case BaseAddresses.WETH:
        return BaseAddresses.HOLDER_WETH;
      case BaseAddresses.USDbC:
        return BaseAddresses.HOLDER_USDBC;
      default:
        throw Error(`holder not found for ${asset}`);
    }
  }
}