
export class MoonwellUtils {
  static getCToken(asset: string) : string {
    switch (asset) {
      case BaseAddresses.USDC: return BaseAddresses.MOONWELL_USDC;
      case BaseAddresses.DAI: return BaseAddresses.MOONWELL_DAI;
      case BaseAddresses.cbETH: return BaseAddresses.MOONWELL_CBETH;
      case BaseAddresses.WETH: return BaseAddresses.MOONWELL_WETH;
    }
    throw Error(`Cannot find moonwel MToken for the asset ${asset}`);
  }
}