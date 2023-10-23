import {PolygonUtils} from "../../chains/polygon/PolygonUtils";
import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";

export class HundredFinanceUtilsProvider implements IPlatformUtilsProvider {
  getPlatformName() {
    return "Hundred finance";
  }

  getAssetName(asset: string): string {
    return PolygonUtils.getAssetName(asset);
  }
  getAssetHolder(asset: string): string {
    return PolygonUtils.getHolder(asset);
  }
}

