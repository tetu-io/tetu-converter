import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";
import {PolygonUtils} from "../../chains/polygon/PolygonUtils";

export class Compound3UtilsProvider implements  IPlatformUtilsProvider {
  getPlatformName() {
    return "Compound3";
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