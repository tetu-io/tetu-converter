import {ILendingPlatformManager, PairAPRs} from "./ILendingPlatformManager";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Aave3PoolAdapter} from "../../../typechain";

export class LendingPlatformManagerAave3 implements ILendingPlatformManager {
    poolAdapter: Aave3PoolAdapter;
    constructor(pa: Aave3PoolAdapter) {
        this.poolAdapter = pa;
    }

    /** Increase or decrease a price of the asset on the given number of times */
    async changeAssetPrice(signer: SignerWithAddress, asset: string, inc: boolean, times: number) {
        
    }

    /** Change collateral factor of the asset on new value, decimals 2 */
    async changeCollateralFactor(signer: SignerWithAddress, newValue2: number) {

    }

    /** Borrow max possible amount (and significantly increase the borrow rate) */
    async makeMaxBorrow(signer: SignerWithAddress,): Promise<PairAPRs> {
    }
    /** Return previously borrowed amount back (reverse to makeMaxBorrow) */
    async releaseMaxBorrow(signer: SignerWithAddress,): Promise<PairAPRs> {

    }
}