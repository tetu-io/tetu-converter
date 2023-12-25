import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";
import {KeomUtilsPolygon} from "./KeomUtilsPolygon";
import {ZkevmUtils} from "../../chains/zkevm/ZkevmUtils";

export class KeomUtilsProviderPolygon implements IPlatformUtilsProvider {
  getPlatformName() {
    return "Keom-matic";
  }

  getAssetName(asset: string): string {
    return ZkevmUtils.getAssetName(asset);
  }
  getCToken(asset: string) : string {
    return KeomUtilsPolygon.getCToken(asset);
  }
  getAllCTokens(): string[] {
    return KeomUtilsPolygon.getAllCTokens();
  }
  getAllAssets(): string[] {
    return KeomUtilsPolygon.getAllAssets();
  }

}