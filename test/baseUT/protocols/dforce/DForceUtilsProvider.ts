import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";
import {PolygonUtils} from "../../chains/polygon/PolygonUtils";

export class DForceUtilsProvider implements  IPlatformUtilsProvider {
  getPlatformName() {
    return "DForce";
  }

  getAssetName(asset: string): string {
    return PolygonUtils.getAssetName(asset);
  }
  getAssetHolder(asset: string): string {
    return PolygonUtils.getHolder(asset);
  }
  getAdditionalAssetHolders(asset: string): string[] {
    return PolygonUtils.getAdditionalAssetHolders(asset);
  }
}