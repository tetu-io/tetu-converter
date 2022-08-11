import {getPoolAdapterState, ILendingPlatformManager, PoolAdapterState01} from "./ILendingPlatformManager";
import {PoolAdapterMock, PriceOracleMock__factory} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class LendingPlatformManagerMock implements ILendingPlatformManager {
    poolAdapter: PoolAdapterMock;
    constructor(pa: PoolAdapterMock) {
        this.poolAdapter = pa;
    }

    /** Increase or decrease a price of the asset on the given number of times */
    async changeAssetPrice(
        signer: SignerWithAddress
        , asset: string
        , inc: boolean
        , times: number
    ) : Promise<PoolAdapterState01> {
        const before = await getPoolAdapterState(signer, this.poolAdapter.address);
        const oracle = PriceOracleMock__factory.connect(await this.poolAdapter.priceOracle(), signer);
        const currentPrice = await oracle.getAssetPrice(asset);

        await oracle.changePrices(
            [
                asset
            ], [
                inc ? currentPrice.mul(times) : currentPrice.div(times)
            ]
        );

        const after = await getPoolAdapterState(signer, this.poolAdapter.address);
        return {before, after};
    }

    /** Change collateral factor of the asset on new value, decimals 2 */
    async changeCollateralFactor(signer: SignerWithAddress, newValue2: number): Promise<PoolAdapterState01> {
        const before = await getPoolAdapterState(signer, this.poolAdapter.address);

        await this.poolAdapter.changeCollateralFactor(newValue2);

        const after = await getPoolAdapterState(signer, this.poolAdapter.address);
        return {before, after};
    }

    /** Borrow max possible amount (and significantly increase the borrow rate) */
    async makeMaxBorrow(signer: SignerWithAddress): Promise<PoolAdapterState01> {
        const before = await getPoolAdapterState(signer, this.poolAdapter.address);
        const borrowRate = await this.poolAdapter.borrowRate();

        await this.poolAdapter.changeBorrowRate(borrowRate.mul(100));

        const after = await getPoolAdapterState(signer, this.poolAdapter.address);
        return {before, after};
    }
    /** Return previously borrowed amount back (reverse to makeMaxBorrow) */
    async releaseMaxBorrow(signer: SignerWithAddress): Promise<PoolAdapterState01> {
        const before = await getPoolAdapterState(signer, this.poolAdapter.address);
        const borrowRate = await this.poolAdapter.borrowRate();

        await this.poolAdapter.changeBorrowRate(borrowRate.div(100));

        const after = await getPoolAdapterState(signer, this.poolAdapter.address);
        return {before, after};
    }
}