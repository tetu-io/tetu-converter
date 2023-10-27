import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";
import {PolygonUtils} from "../../chains/polygon/PolygonUtils";

export class AaveTwoUtilsProvider implements  IPlatformUtilsProvider {
  getPlatformName() {
    return "Aave2";
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