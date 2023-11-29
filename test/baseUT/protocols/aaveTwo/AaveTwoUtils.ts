import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";

export class AaveTwoUtils {
  static getAllAssets(): string[] {
    return [
      MaticAddresses.USDC,
      MaticAddresses.USDT,
      MaticAddresses.DAI,
      MaticAddresses.WETH,
      MaticAddresses.WBTC,
      MaticAddresses.WMATIC,
      MaticAddresses.BALANCER,
      MaticAddresses.CRV,
      MaticAddresses.SUSHI,
      MaticAddresses.CHAIN_LINK,
      MaticAddresses.AavegotchiGHST,
      MaticAddresses.DefiPulseToken,
    ];
  }
}