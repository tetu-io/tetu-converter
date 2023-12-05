import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";
import {PolygonUtils} from "../../chains/polygon/PolygonUtils";
import {DForceUtils} from "./DForceUtils";

export class DForceUtilsProvider implements  IPlatformUtilsProvider {
  getPlatformName() {
    return "DForce";
  }

  getAssetName(asset: string): string {
    return PolygonUtils.getAssetName(asset);
  }
  getCToken(asset: string) : string {
    return DForceUtils.getCTokenAddressForAsset(asset);
  }
  getAllCTokens(): string[] {
    return DForceUtils.getAllCTokens();
  }
  getAllAssets(): string[] {
    return DForceUtils.getAllAssets();
  }
}