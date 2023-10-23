import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";

export class PolygonUtils {
  static getAssetName(asset: string): string {
    switch (asset) {
      case MaticAddresses.USDC:
        return "USDC";
      case MaticAddresses.USDT:
        return "USDT";
      case MaticAddresses.DAI:
        return "DAI";
      case MaticAddresses.WETH:
        return "WETH";
      case MaticAddresses.WBTC:
        return "WBTC";
      case MaticAddresses.WMATIC:
        return "WMATIC";
      case MaticAddresses.BALANCER:
        return "BALANCER";
      case MaticAddresses.miMATIC:
        return "miMATIC";
      case MaticAddresses.stMATIC:
        return "stMATIC";
      case MaticAddresses.MaticX:
        return "MaticX";
      case MaticAddresses.wstETH:
        return "wstETH";
      default:
        throw Error(`No asset name found for asset ${asset}`);
    }
  }

  static getHolder(asset: string): string {
    switch (asset) {
      case MaticAddresses.USDC:
        return MaticAddresses.HOLDER_USDC;
      case MaticAddresses.USDT:
        return MaticAddresses.HOLDER_USDT;
      case MaticAddresses.DAI:
        return MaticAddresses.HOLDER_DAI;
      case MaticAddresses.WETH:
        return MaticAddresses.HOLDER_WETH;
      case MaticAddresses.WBTC:
        return MaticAddresses.HOLDER_WBTC;
      case MaticAddresses.WMATIC:
        return MaticAddresses.HOLDER_WMATIC;
      case MaticAddresses.BALANCER:
        return MaticAddresses.HOLDER_BALANCER;
      case MaticAddresses.miMATIC:
        return MaticAddresses.HOLDER_MI_MATIC;
      case MaticAddresses.stMATIC:
        return MaticAddresses.HOLDER_ST_MATIC;
      case MaticAddresses.MaticX:
        return MaticAddresses.HOLDER_MATIC_X;
      case MaticAddresses.wstETH:
        return MaticAddresses.HOLDER_WST_ETH;
      default:
        throw Error(`No holder found for asset ${asset}`);
    }
  }
}