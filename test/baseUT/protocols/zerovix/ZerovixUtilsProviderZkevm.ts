import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";
import {ZkevmUtils} from "../../chains/zkevm/ZkevmUtils";

export class ZerovixUtilsProviderZkevm implements  IPlatformUtilsProvider {
  getPlatformName() {
    return "0vix zkEVM";
  }

  getAssetName(asset: string): string {
    return ZkevmUtils.getAssetName(asset);
  }
  getAssetHolder(asset: string): string {
    return ZkevmUtils.getHolder(asset);
  }
  getAdditionalAssetHolders(asset: string): string[] {
    return ZkevmUtils.getAdditionalAssetHolders(asset);
  }

}