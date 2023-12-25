import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";
import {PolygonUtils} from "../../chains/polygon/PolygonUtils";
import {Compound3Utils} from "./Compound3Utils";

export class Compound3UtilsProvider implements  IPlatformUtilsProvider {
  getPlatformName() {
    return "Compound3";
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
    return Compound3Utils.getAllAssets();
  }
}