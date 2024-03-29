import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";

export class DForceUtils {
  static getCTokenAddressForAsset(asset: string) : string {
    switch (asset) {
      case MaticAddresses.USDC: return MaticAddresses.dForce_iUSDC;
      case MaticAddresses.USDT: return MaticAddresses.dForce_iUSDT;
      case MaticAddresses.dForce_USD: return MaticAddresses.dForce_iUSX;
      case MaticAddresses.DAI: return MaticAddresses.dForce_iDAI;
      case MaticAddresses.WETH: return MaticAddresses.dForce_iWETH;
      case MaticAddresses.WBTC: return MaticAddresses.dForce_iWBTC;
      case MaticAddresses.AaveToken: return MaticAddresses.dForce_iAAVE;
      case MaticAddresses.CRV: return MaticAddresses.dForce_iCRV;
      case MaticAddresses.WMATIC: return MaticAddresses.dForce_iMATIC;
    }
    throw Error(`Cannot find dForce_XXX token for asset ${asset}`);
  }

  static getAllCTokens(): string[] {
    return [
      MaticAddresses.dForce_iUSDC,
      MaticAddresses.dForce_iUSDT,
      MaticAddresses.dForce_iUSX,
      MaticAddresses.dForce_iDAI,
      MaticAddresses.dForce_iWETH,
      MaticAddresses.dForce_iWBTC,
      // MaticAddresses.dForce_iAAVE,
      MaticAddresses.dForce_iCRV,
      MaticAddresses.dForce_iMATIC
    ];
  }

  static getAllAssets(): string[] {
    return [
      MaticAddresses.USDC,
      MaticAddresses.USDT,
      MaticAddresses.dForce_USD,
      MaticAddresses.DAI,
      MaticAddresses.WETH,
      MaticAddresses.WBTC,
      MaticAddresses.CRV,
      MaticAddresses.WMATIC
    ];
  }
}