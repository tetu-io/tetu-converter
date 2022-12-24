import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";

export class HundredFinanceUtils {
  static getCTokenAddressForAsset(asset: string) : string {
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
    throw `Cannot find HundredFinance_XXX token for asset ${asset}`;
  }
}