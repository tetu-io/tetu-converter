import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IPoolAdapter, IPoolAdapter__factory} from "../../../typechain";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";

export interface PoolAdapterState {
    apr: BigNumber;
    healthFactor2: BigNumber;
}

/** Two values of APR: before and after the given change */
export interface PoolAdapterState01 {
    before: PoolAdapterState;
    after: PoolAdapterState;
}

export async function getPoolAdapterState(signer: SignerWithAddress, poolAdapter: string) : Promise<PoolAdapterState> {
    const pa = IPoolAdapter__factory.connect(poolAdapter, signer);
    return {
        apr: await pa.getAPR18()
        , healthFactor2: (await pa.getStatus()).healthFactor18.div(getBigNumberFrom(1, 16))
    }
}

/**
 * Allow to modify behavior of the given lending platform,
 * i.e. change prices, change collateral factors and so on
 */
export interface ILendingPlatformManager {
    /** Increase or decrease a price of the asset on the given number of times */
    changeAssetPrice: (
        signer: SignerWithAddress
        , asset: string
        , inc: boolean
        , times: number
    ) => Promise<PoolAdapterState01>;

    /** Change collateral factor of the collateral asset on new value
     *  @param newValue2 100 for 1, 200 for 2, etc
     * */
    changeCollateralFactor: (signer: SignerWithAddress, newValue2: number) => Promise<PoolAdapterState01>;

    /** Borrow max possible amount (and significantly increase the borrow rate) */
    makeMaxBorrow: (signer: SignerWithAddress) => Promise<PoolAdapterState01>;
    /** Return previously borrowed amount back (reverse to makeMaxBorrow) */
    releaseMaxBorrow: (signer: SignerWithAddress) => Promise<PoolAdapterState01>;
}