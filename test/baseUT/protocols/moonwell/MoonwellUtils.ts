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
}