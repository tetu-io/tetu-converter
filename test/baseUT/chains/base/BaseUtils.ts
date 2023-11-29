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

  static getAdditionalAssetHolders(asset: string): string[] {
    switch (asset) {
      case BaseAddresses.USDC:
        return [BaseAddresses.HOLDER_USDC_1, BaseAddresses.HOLDER_USDC_2];
      case BaseAddresses.DAI:
        return [BaseAddresses.HOLDER_DAI_1, BaseAddresses.HOLDER_DAI_2, BaseAddresses.HOLDER_DAI_3];
      case BaseAddresses.cbETH:
        return [BaseAddresses.HOLDER_CBETH_1, BaseAddresses.HOLDER_CBETH_2];
      case BaseAddresses.WETH:
        return [BaseAddresses.HOLDER_WETH_1, BaseAddresses.HOLDER_WETH_2];
      case BaseAddresses.USDbC:
        return [BaseAddresses.HOLDER_USDBC_1, BaseAddresses.HOLDER_USDBC_2];
      default:
        throw Error(`holder not found for ${asset}`);
    }
  }
}