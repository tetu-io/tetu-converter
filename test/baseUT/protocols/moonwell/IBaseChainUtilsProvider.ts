import {IChainUtilsProvider} from "../../types/IChainUtilsProvider";
import {MoonwellUtils} from "./MoonwellUtils";

export class BaseChainUtilsProvider implements  IChainUtilsProvider {
  getAssetName(asset: string): string {
    return MoonwellUtils.getAssetName(asset);
  }
  getAssetHolder(asset: string): string {
    return MoonwellUtils.getHolder(asset);
  }

}