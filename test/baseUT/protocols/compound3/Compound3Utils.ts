import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {getAddress} from "ethers/lib/utils";

export class Compound3Utils {
  static getCometAddressForAsset(asset: string) : string {
    switch (getAddress(asset)) {
      case getAddress(MaticAddresses.USDC): return MaticAddresses.COMPOUND3_COMET_USDC;
    }
    throw new Error(`Cannot find Compound3 comet token for asset ${asset}`);
  }

  static getAllAssets(): string[] {
    return [
      MaticAddresses.USDC,
      MaticAddresses.WMATIC,
      MaticAddresses.WETH,
      MaticAddresses.WBTC,
    ];
  }
}