import {Misc} from "./Misc";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {BASE_NETWORK_ID} from "./HardhatUtils";
import {BaseAddresses} from "../addresses/BaseAddresses";

export class DeployerUtilsLocal {
  public static async getNetworkTokenAddress() {
    const chainId = Misc.getChainId();
    if (chainId === 137) {
      return MaticAddresses.WMATIC;
    } else if (chainId === BASE_NETWORK_ID) {
      return BaseAddresses.WETH;
    } else {
      throw Error('No config for ' + chainId);
    }
  }



}
