import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";

export class MoonwellUtils {
  static getCToken(asset: string) : string {
    switch (asset) {
      case BaseAddresses.USDC: return BaseAddresses.MOONWELL_USDC;
      case BaseAddresses.DAI: return BaseAddresses.MOONWELL_DAI;
      case BaseAddresses.cbETH: return BaseAddresses.MOONWELL_CBETH;
      case BaseAddresses.WETH: return BaseAddresses.MOONWELL_WETH;
      case BaseAddresses.USDbC: return BaseAddresses.MOONWELL_USDBC;
    }
    throw Error(`Cannot find moonwel MToken for the asset ${asset}`);
  }

  static getAllCTokens(): string[] {
    return [
      BaseAddresses.MOONWELL_USDC,
      BaseAddresses.MOONWELL_DAI,
      BaseAddresses.MOONWELL_CBETH,
      BaseAddresses.MOONWELL_WETH,
      BaseAddresses.MOONWELL_USDBC
    ]
  }

  static getAllAssets(): string[] {
    return [
      BaseAddresses.USDC,
      BaseAddresses.DAI,
      BaseAddresses.cbETH,
      BaseAddresses.WETH,
      BaseAddresses.USDbC
    ]
  }

  static getAssetName(address: string): string {
    switch (address) {
      case BaseAddresses.USDC: return "usdc";
      case BaseAddresses.DAI: return "dai";
      case BaseAddresses.cbETH: return "cbETH"
      case BaseAddresses.WETH: return "weth";
      case BaseAddresses.USDbC: return "USDbC";
      default: return address;
    }
  }

  static getHolder(asset: string): string {
    switch (asset) {
      case BaseAddresses.USDC: return BaseAddresses.HOLDER_USDC;
      case BaseAddresses.DAI: return BaseAddresses.HOLDER_DAI;
      case BaseAddresses.cbETH: return BaseAddresses.HOLDER_CBETH;
      case BaseAddresses.WETH: return BaseAddresses.HOLDER_WETH;
      case BaseAddresses.USDbC: return BaseAddresses.HOLDER_USDBC;
      default: throw Error(`holder not found for ${asset}`);
    }
  }
}