import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";

export class KeomUtilsPolygon {
  static getCToken(asset: string) : string {
    switch (asset) {
      case MaticAddresses.USDC: return MaticAddresses.KEOM_USDC;
      case MaticAddresses.USDT: return MaticAddresses.KEOM_USDT;
      case MaticAddresses.DAI: return MaticAddresses.KEOM_DAI;
      case MaticAddresses.WETH: return MaticAddresses.KEOM_WETH;
      case MaticAddresses.WMATIC: return MaticAddresses.KEOM_MATIC;
      case MaticAddresses.WBTC: return MaticAddresses.KEOM_WBTC;
    }
    throw Error(`Cannot find zerovix OToken for the asset ${asset}`);
  }

  static getAllCTokens(): string[] {
    return [
      MaticAddresses.KEOM_USDC,
      MaticAddresses.KEOM_USDT,
      MaticAddresses.KEOM_DAI,
      MaticAddresses.KEOM_WETH,
      MaticAddresses.KEOM_MATIC,
      MaticAddresses.KEOM_WBTC,
    ]
  }

  static getAllAssets(): string[] {
    return [
      MaticAddresses.USDC,
      MaticAddresses.USDT,
      MaticAddresses.DAI,
      MaticAddresses.WETH,
      MaticAddresses.WMATIC,
      MaticAddresses.WBTC,
    ]
  }
}