import {IPlatformUtilsProvider} from "../../../types/IPlatformUtilsProvider";
import {Aave3Utils} from "../Aave3Utils";

export class Aave3UtilsProviderBase implements  IPlatformUtilsProvider {
  getPlatformName() {
    return "Aave3";
  }

  getAssetName(asset: string): string {
    return Aave3Utils.getAssetNameBase(asset);
  }
  getAssetHolder(asset: string): string {
    return Aave3Utils.getHolderBase(asset);
  }
  getAdditionalAssetHolders(asset: string): string[] {
    return Aave3Utils.getAdditionalAssetHoldersBase(asset);
}
}