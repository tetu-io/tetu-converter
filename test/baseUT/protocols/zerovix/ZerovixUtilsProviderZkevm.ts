import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";
import {ZkevmUtils} from "../../chains/zkevm/ZkevmUtils";
import {ZerovixUtilsZkevm} from "./ZerovixUtilsZkevm";

export class ZerovixUtilsProviderZkevm implements  IPlatformUtilsProvider {
  getPlatformName() {
    return "0vix zkEVM";
  }

  getAssetName(asset: string): string {
    return ZkevmUtils.getAssetName(asset);
  }
  getCToken(asset: string) : string {
    return ZerovixUtilsZkevm.getCToken(asset);
  }
  getAllCTokens(): string[] {
    return ZerovixUtilsZkevm.getAllCTokens();
  }
  getAllAssets(): string[] {
    return ZerovixUtilsZkevm.getAllAssets();
  }

}