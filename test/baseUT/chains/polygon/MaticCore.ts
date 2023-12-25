import {ICoreAave3} from "../../protocols/aave3/Aave3DataTypes";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {IKeomCore} from "../../protocols/keom/IKeomCore";
import {KeomUtilsProviderPolygon} from "../../protocols/keom/KeomUtilsProviderPolygon";
import {POLYGON_NETWORK_ID} from "../../../../scripts/utils/HardhatUtils";

export class MaticCore {
  static getCoreAave3() : ICoreAave3 {
    return {
      pool: MaticAddresses.AAVE_V3_POOL,
      poolOwner: MaticAddresses.AAVE_V3_POOL_OWNER,
      emergencyAdmin: MaticAddresses.AAVE_V3_EMERGENCY_ADMIN,
      priceOracle: MaticAddresses.AAVE_V3_PRICE_ORACLE
    }
  }

  static getCoreKeom(): IKeomCore {
    return {
      chain: POLYGON_NETWORK_ID,
      nativeToken: MaticAddresses.WMATIC,
      nativeCToken: MaticAddresses.KEOM_MATIC,

      comptroller: MaticAddresses.KEOM_COMPTROLLER,
      priceOracle: MaticAddresses.KEOM_PRICE_ORACLE,

      usdc: MaticAddresses.USDC,
      usdt: MaticAddresses.USDT,
      dai: MaticAddresses.DAI,
      wmatic: MaticAddresses.WMATIC,
      weth: MaticAddresses.WETH,
      wbtc: MaticAddresses.WBTC,

      kUsdc: MaticAddresses.KEOM_USDC,
      kUsdt: MaticAddresses.KEOM_USDT,
      kDai: MaticAddresses.KEOM_DAI,
      kMatic: MaticAddresses.KEOM_MATIC,
      kWeth: MaticAddresses.KEOM_WETH,
      kWbtc: MaticAddresses.KEOM_WBTC,

      utils: new KeomUtilsProviderPolygon()
    }
  }
}