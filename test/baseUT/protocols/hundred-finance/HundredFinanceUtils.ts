import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";

export class HundredFinanceUtils {
  static getCToken(asset: string) : string {
    switch (asset) {
      case MaticAddresses.USDC: return MaticAddresses.hUSDC;
      case MaticAddresses.USDT: return MaticAddresses.hUSDT;
      case MaticAddresses.DAI: return MaticAddresses.hDAI;
      case MaticAddresses.WETH: return MaticAddresses.hETH;
      case MaticAddresses.WBTC: return MaticAddresses.hWBTC;
      case MaticAddresses.CHAIN_LINK: return MaticAddresses.hLINK;
      case MaticAddresses.FRAX: return MaticAddresses.hFRAX;
      case MaticAddresses.WMATIC: return MaticAddresses.hMATIC;
    }
    throw Error(`Cannot find HundredFinance_XXX token for asset ${asset}`);
  }

  static getAllAssets(): string[] {
    return [
      MaticAddresses.DAI,
      MaticAddresses.WMATIC,
      MaticAddresses.USDC,
      MaticAddresses.WETH,
      MaticAddresses.USDT,
      MaticAddresses.WBTC
    ];
  }

  static getAllCTokens(): string[] {
    return [
      MaticAddresses.hDAI,
      MaticAddresses.hMATIC,
      MaticAddresses.hUSDC,
      MaticAddresses.hETH,
      MaticAddresses.hUSDT,
      MaticAddresses.hWBTC,
      // MaticAddresses.hFRAX,
      // MaticAddresses.hLINK,
    ]
  }
}