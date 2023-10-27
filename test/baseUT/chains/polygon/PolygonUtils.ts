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
        return MaticAddresses.HOLDER_WSTETH;
      default:
        throw Error(`No holder found for asset ${asset}`);
    }
  }

  static getAdditionalAssetHolders(asset: string): string[] {
    switch (asset) {
      case MaticAddresses.USDC:
        return [MaticAddresses.HOLDER_USDC_2, MaticAddresses.HOLDER_USDC_3];
      case MaticAddresses.USDT:
        return [MaticAddresses.HOLDER_USDT_1, MaticAddresses.HOLDER_USDT_2, MaticAddresses.HOLDER_USDT_3];
      case MaticAddresses.DAI:
        return [MaticAddresses.HOLDER_DAI_2, MaticAddresses.HOLDER_DAI_3, MaticAddresses.HOLDER_DAI_4, MaticAddresses.HOLDER_DAI_5, MaticAddresses.HOLDER_DAI_6];
      case MaticAddresses.WETH:
        return [MaticAddresses.HOLDER_WETH_2, MaticAddresses.HOLDER_WETH_3, MaticAddresses.HOLDER_WETH_4, MaticAddresses.HOLDER_WETH_5, MaticAddresses.HOLDER_WETH_6];
      case MaticAddresses.WBTC:
        return [MaticAddresses.HOLDER_WBTC_2, MaticAddresses.HOLDER_WBTC_3];
      case MaticAddresses.WMATIC:
        return [MaticAddresses.HOLDER_WMATIC_2, MaticAddresses.HOLDER_WMATIC_3, MaticAddresses.HOLDER_WMATIC_4, MaticAddresses.HOLDER_WMATIC_5, MaticAddresses.HOLDER_WMATIC_6];
      case MaticAddresses.BALANCER:
        return [MaticAddresses.HOLDER_BALANCER_1, MaticAddresses.HOLDER_BALANCER_2, MaticAddresses.HOLDER_BALANCER_3, MaticAddresses.HOLDER_BALANCER_4];
      case MaticAddresses.miMATIC:
        return [];
      case MaticAddresses.stMATIC:
        return [];
      case MaticAddresses.MaticX:
        return [];
      case MaticAddresses.wstETH:
        return [MaticAddresses.HOLDER_WSTETH_1, MaticAddresses.HOLDER_WSTETH_2];
      default:
        throw Error(`No holder found for asset ${asset}`);
    }
  }
}