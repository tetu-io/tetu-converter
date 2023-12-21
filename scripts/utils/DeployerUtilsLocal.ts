import {Misc} from "./Misc";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {BASE_NETWORK_ID, ZKEVM_NETWORK_ID} from "./HardhatUtils";
import {BaseAddresses} from "../addresses/BaseAddresses";
import {ZkevmAddresses} from "../addresses/ZkevmAddresses";

export class DeployerUtilsLocal {
  public static async getNetworkTokenAddress() {
    const chainId = Misc.getChainId();
    if (chainId === 137) {
      return MaticAddresses.WMATIC;
    } else if (chainId === BASE_NETWORK_ID) {
      return BaseAddresses.WETH;
    } else if (chainId === ZKEVM_NETWORK_ID) {
      return ZkevmAddresses.MATIC; // todo
    } else {
      throw Error('No config for ' + chainId);
    }
  }



}
