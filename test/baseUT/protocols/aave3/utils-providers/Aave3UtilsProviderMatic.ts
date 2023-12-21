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
  getCToken(asset: string) : string {
    throw Error("not implemented");
  }
  getAllCTokens(): string[] {
    throw Error("not implemented");
  }
  getAllAssets(): string[] {
    return Aave3Utils.getAllAssetsMatic();
  }
}

