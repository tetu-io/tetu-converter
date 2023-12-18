import {ZkevmAddresses} from "../../../../scripts/addresses/ZkevmAddresses";
import {IKeomCore} from "../../protocols/keom/IKeomCore";
import {ZKEVM_NETWORK_ID} from "../../../../scripts/utils/HardhatUtils";
import {KeomUtilsProviderPolygon} from "../../protocols/keom/KeomUtilsProviderPolygon";

export class ZkevmUtils {
  static getAssetName(address: string): string {
    switch (address) {
      case ZkevmAddresses.USDC:
        return "usdc";
      case ZkevmAddresses.DAI:
        return "dai";
      case ZkevmAddresses.USDT:
        return "usdt"
      case ZkevmAddresses.WETH:
        return "weth";
      case ZkevmAddresses.MATIC:
        return "matic";
      default:
        return address;
    }
  }

  static getCoreKeom(): IKeomCore {
    return {
      chain: ZKEVM_NETWORK_ID,
      nativeToken: ZkevmAddresses.MATIC,
      nativeCToken: ZkevmAddresses.KEOM_MATIC,

      comptroller: ZkevmAddresses.KEOM_COMPTROLLER,
      priceOracle: ZkevmAddresses.KEOM_PRICE_ORACLE,

      usdc: ZkevmAddresses.USDC,
      usdt: ZkevmAddresses.USDT,
      dai: ZkevmAddresses.DAI,
      wmatic: ZkevmAddresses.MATIC,
      weth: ZkevmAddresses.WETH,
      wbtc: ZkevmAddresses.WBTC,

      kUsdc: ZkevmAddresses.KEOM_USDC,
      kUsdt: ZkevmAddresses.KEOM_USDT,
      kDai: "todo",
      kMatic: ZkevmAddresses.KEOM_MATIC,
      kWeth: ZkevmAddresses.KEOM_WETH,
      kWbtc: "todo",

      utils: new KeomUtilsProviderPolygon()
    }
  }
}