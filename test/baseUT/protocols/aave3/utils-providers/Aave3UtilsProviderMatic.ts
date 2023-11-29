import {IPlatformUtilsProvider} from "../../../types/IPlatformUtilsProvider";
import {Aave3Utils} from "../Aave3Utils";
import {PolygonUtils} from "../../../chains/polygon/PolygonUtils";

export class Aave3UtilsProviderMatic implements  IPlatformUtilsProvider {
  getPlatformName() {
    return "Aave3";
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

