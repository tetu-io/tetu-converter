import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";
import {ZkevmUtils} from "../../chains/zkevm/ZkevmUtils";
import {KeomUtilsZkevm} from "./KeomUtilsZkevm";

export class KeomUtilsProviderZkevm implements IPlatformUtilsProvider {
  getPlatformName() {
    return "Keom-zkevm";
  }

  getAssetName(asset: string): string {
    return ZkevmUtils.getAssetName(asset);
  }
  getCToken(asset: string) : string {
    return KeomUtilsZkevm.getCToken(asset);
  }
  getAllCTokens(): string[] {
    return KeomUtilsZkevm.getAllCTokens();
  }
  getAllAssets(): string[] {
    return KeomUtilsZkevm.getAllAssets();
  }

}