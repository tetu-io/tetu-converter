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
}