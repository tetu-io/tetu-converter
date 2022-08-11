import {BigNumber} from "ethers";

/** Two values of APR: before and after the given change */
export interface PairAPRs {
    before: BigNumber;
    after: BigNumber;
}

/**
 * Allow to modify behavior of the given lending platform,
 * i.e. change prices, change collateral factors and so on
 */
export interface ILendingPlatformManager {
    /** Increase or decrease a price of the asset on the given number of times */
    changeAssetPrice: (asset: string, inc: boolean, times: number) => Promise<void>;

    /** Change collateral factor of the asset on new value
     *  @param newValue2 100 for 1, 200 for 2, etc
     * */
    changeCollateralFactor: (asset: string, newValue2: number) => Promise<void>;

    /** Borrow max possible amount (and significantly increase the borrow rate) */
    makeMaxBorrow: () => Promise<PairAPRs>;
    /** Return previously borrowed amount back (reverse to makeMaxBorrow) */
    releaseMaxBorrow: () => Promise<PairAPRs>;
}