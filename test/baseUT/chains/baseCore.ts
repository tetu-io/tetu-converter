import {ICoreAave3} from "../protocols/aave3/Aave3DataTypes";
import {BaseAddresses} from "../../../scripts/addresses/BaseAddresses";

export class BaseCore {
    static getCoreAave3() : ICoreAave3 {
        return {
            pool: BaseAddresses.AAVE_V3_POOL,
            poolOwner: BaseAddresses.AAVE_V3_POOL_OWNER,
            emergencyAdmin: BaseAddresses.AAVE_V3_EMERGENCY_ADMIN,
            priceOracle: BaseAddresses.AAVE_V3_PRICE_ORACLE
        }
    }
}