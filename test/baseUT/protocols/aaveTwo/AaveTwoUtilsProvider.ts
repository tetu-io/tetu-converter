import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";
import {PolygonUtils} from "../../chains/polygon/PolygonUtils";
import {AaveTwoUtils} from "./AaveTwoUtils";

export class AaveTwoUtilsProvider implements  IPlatformUtilsProvider {
  getPlatformName() {
    return "Aave2";
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
    return AaveTwoUtils.getAllAssets();
  }
}