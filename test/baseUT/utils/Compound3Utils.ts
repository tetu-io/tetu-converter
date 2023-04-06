import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";

export class Compound3Utils {
  static getCometAddressForAsset(asset: string) : string {
    switch (asset) {
      case MaticAddresses.USDC: return MaticAddresses.COMPOUND3_COMET_USDC;
    }
    throw new Error(`Cannot find Compound3 comet token for asset ${asset}`);
  }
}