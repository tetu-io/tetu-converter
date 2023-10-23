import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";
import {MoonwellUtils} from "./MoonwellUtils";
import {BaseUtils} from "../../chains/base/BaseUtils";

export class MoonwellUtilsProvider implements  IPlatformUtilsProvider {
  getPlatformName() {
    return "Moonwell";
  }

  getAssetName(asset: string): string {
    return BaseUtils.getAssetName(asset);
  }
  getAssetHolder(asset: string): string {
    return BaseUtils.getHolder(asset);
  }

}