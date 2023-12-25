import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";

export interface IKeomCore {
  chain: number;
  nativeToken: string;
  nativeCToken: string;

  comptroller: string;
  priceOracle: string;

  usdc: string;
  usdt: string;
  dai: string;
  wmatic: string;
  weth: string;
  wbtc: string;

  kUsdc: string;
  kUsdt: string;
  kDai: string;
  kMatic: string;
  kWeth: string;
  kWbtc: string;

  utils: IPlatformUtilsProvider;
}