import {IPlatformUtilsProvider} from "../../../types/IPlatformUtilsProvider";
import {Aave3Utils} from "../Aave3Utils";

export class Aave3UtilsProviderBase implements  IPlatformUtilsProvider {
  getPlatformName() {
    return "Aave3";
  }

  getAssetName(asset: string): string {
    return Aave3Utils.getAssetNameBase(asset);
  }
  getCToken(asset: string) : string {
    throw Error("not implemented");
  }
  getAllCTokens(): string[] {
    throw Error("not implemented");
  }
  getAllAssets(): string[] {
    return Aave3Utils.getAllAssetsBase();
  }
}