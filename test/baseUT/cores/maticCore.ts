import {ICoreAave3} from "../protocols/aave3/Aave3DataTypes";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";

export class MaticCore {
  static getCoreAave3() : ICoreAave3 {
    return {
      pool: MaticAddresses.AAVE_V3_POOL,
      poolOwner: MaticAddresses.AAVE_V3_POOL_OWNER,
      emergencyAdmin: MaticAddresses.AAVE_V3_EMERGENCY_ADMIN
    }
  }
}