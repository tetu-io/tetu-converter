import {ILendingPlatformManager, PairAPRs} from "./ILendingPlatformManager";
import {PoolAdapterMock, PriceOracleMock__factory} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class LendingPlatformManagerMock implements ILendingPlatformManager {
    poolAdapter: PoolAdapterMock;
    constructor(pa: PoolAdapterMock) {
        this.poolAdapter = pa;
    }

    /** Increase or decrease a price of the asset on the given number of times */
    async changeAssetPrice(signer: SignerWithAddress, asset: string, inc: boolean, times: number) {
        const oracle = PriceOracleMock__factory.connect(await this.poolAdapter.priceOracle(), signer);
        const currentPrice = await oracle.getAssetPrice(asset);

        await oracle.changePrices(
            [
                asset
            ], [
                inc ? currentPrice.mul(times) : currentPrice.div(times)
            ]
        );
    }

    /** Change collateral factor of the asset on new value, decimals 2 */
    async changeCollateralFactor(signer: SignerWithAddress, newValue2: number) {
        await this.poolAdapter.changeCollateralFactor(newValue2);
    }

    /** Borrow max possible amount (and significantly increase the borrow rate) */
    async makeMaxBorrow(signer: SignerWithAddress,): Promise<PairAPRs> {
        const before = this.poolAdapter.getAPR18();
        const borrowRate = await this.poolAdapter.borrowRate;
        await this.poolAdapter.changeBorrowRate(borrowRate.mul(100));
        const after = this.poolAdapter.getAPR18();
        return {before, after};
    }
    /** Return previously borrowed amount back (reverse to makeMaxBorrow) */
    async releaseMaxBorrow(signer: SignerWithAddress,): Promise<PairAPRs> {
        const before = this.poolAdapter.getAPR18();
        const borrowRate = await this.poolAdapter.borrowRate;
        await this.poolAdapter.changeBorrowRate(borrowRate.div(100));
        const after = this.poolAdapter.getAPR18();
        return {before, after};
    }
}