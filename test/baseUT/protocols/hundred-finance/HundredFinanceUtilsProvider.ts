import {PolygonUtils} from "../../chains/polygon/PolygonUtils";
import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";
import {HundredFinanceUtils} from "./HundredFinanceUtils";

export class HundredFinanceUtilsProvider implements IPlatformUtilsProvider {
  getPlatformName() {
    return "Hundred finance";
  }

  getAssetName(asset: string): string {
    return PolygonUtils.getAssetName(asset);
  }
  getCToken(asset: string) : string {
    return HundredFinanceUtils.getCToken(asset);
  }
  getAllCTokens(): string[] {
    return HundredFinanceUtils.getAllCTokens();
  }
  getAllAssets(): string[] {
    return HundredFinanceUtils.getAllAssets();
  }
}

