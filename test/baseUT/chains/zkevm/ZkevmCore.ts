import {IKeomCore} from "../../protocols/keom/IKeomCore";
import {ZkevmAddresses} from "../../../../scripts/addresses/ZkevmAddresses";
import {KeomUtilsProviderZkevm} from "../../protocols/keom/KeomUtilsProviderZkevm";
import {ZKEVM_NETWORK_ID} from "../../../../scripts/utils/HardhatUtils";

export class ZkevmCore {
  static getCoreKeom(): IKeomCore {
    return {
      chain: ZKEVM_NETWORK_ID,
      nativeToken: ZkevmAddresses.WETH,
      nativeCToken: ZkevmAddresses.KEOM_NATIVE,

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
      kWeth: ZkevmAddresses.KEOM_NATIVE,
      kWbtc: ZkevmAddresses.KEOM_WBTC,

      utils: new KeomUtilsProviderZkevm()
    }
  }
}