import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";
import {PolygonUtils} from "../../chains/polygon/PolygonUtils";
import {KeomUtilsPolygon} from "./KeomUtilsPolygon";

export class KeomUtilsProviderPolygon implements IPlatformUtilsProvider {
  getPlatformName() {
    return "Keom-matic";
  }

  getAssetName(asset: string): string {
    return PolygonUtils.getAssetName(asset);
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