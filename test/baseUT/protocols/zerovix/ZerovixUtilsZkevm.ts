import {ZkevmAddresses} from "../../../../scripts/addresses/ZkevmAddresses";

export class ZerovixUtilsZkevm {
  static getCToken(asset: string) : string {
    switch (asset) {
      case ZkevmAddresses.USDC: return ZkevmAddresses.oUSDC;
      case ZkevmAddresses.USDT: return ZkevmAddresses.oUSDT;
      case ZkevmAddresses.WETH: return ZkevmAddresses.oWETH;
      case ZkevmAddresses.MATIC: return ZkevmAddresses.oMatic;
      case ZkevmAddresses.WBTC: return ZkevmAddresses.oWBTC;
    }
    throw Error(`Cannot find zerovix OToken for the asset ${asset}`);
  }

  static getAllCTokens(): string[] {
    return [
      ZkevmAddresses.oUSDC,
      ZkevmAddresses.oUSDT,
      ZkevmAddresses.oWETH,
      ZkevmAddresses.oMatic,
      ZkevmAddresses.oWBTC,
    ]
  }

  static getAllAssets(): string[] {
    return [
      ZkevmAddresses.USDC,
      ZkevmAddresses.USDT,
      ZkevmAddresses.WETH,
      ZkevmAddresses.MATIC,
      ZkevmAddresses.WBTC,
    ]
  }
}