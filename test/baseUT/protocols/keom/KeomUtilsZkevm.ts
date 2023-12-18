import {ZkevmAddresses} from "../../../../scripts/addresses/ZkevmAddresses";

export class KeomUtilsZkevm {
  static getCToken(asset: string) : string {
    switch (asset) {
      case ZkevmAddresses.USDC: return ZkevmAddresses.KEOM_USDC;
      case ZkevmAddresses.USDT: return ZkevmAddresses.KEOM_USDT;
      case ZkevmAddresses.WETH: return ZkevmAddresses.KEOM_WETH;
      case ZkevmAddresses.MATIC: return ZkevmAddresses.KEOM_MATIC;
    }
    throw Error(`Cannot find zerovix OToken for the asset ${asset}`);
  }

  static getAllCTokens(): string[] {
    return [
      ZkevmAddresses.KEOM_USDC,
      ZkevmAddresses.KEOM_USDT,
      ZkevmAddresses.KEOM_WETH,
      ZkevmAddresses.KEOM_MATIC,
    ]
  }

  static getAllAssets(): string[] {
    return [
      ZkevmAddresses.USDC,
      ZkevmAddresses.USDT,
      ZkevmAddresses.WETH,
      ZkevmAddresses.WBTC,
    ]
  }
}