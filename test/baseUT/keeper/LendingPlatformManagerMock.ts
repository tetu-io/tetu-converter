import {getPoolAdapterState, ILendingPlatformManager, PoolAdapterState01} from "./ILendingPlatformManager";
import {
    IPoolAdaptersManager__factory, LendingPlatformMock,
    PoolAdapterMock,
    PoolAdapterMock__factory,
    PriceOracleMock__factory
} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";

export class LendingPlatformManagerMock implements ILendingPlatformManager {
    poolAdapter: PoolAdapterMock;
    platform: LendingPlatformMock;
    constructor(
        pa: PoolAdapterMock
        , platform: LendingPlatformMock
    ) {
        this.poolAdapter = pa;
        this.platform = platform;
    }

    /** Increase or decrease a price of the asset on the given number of times */
    async changeAssetPrice(
        signer: SignerWithAddress
        , asset: string
        , inc: boolean
        , times: number
    ) : Promise<PoolAdapterState01> {
        console.log("LendingPlatformManagerMock.changeAssetPrice.start");
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
        console.log("LendingPlatformManagerMock.changeAssetPrice.end", before, after);
        return {before, after};
    }

    /** Change collateral factor of the asset on new value, decimals 2 */
    async changeCollateralFactor(signer: SignerWithAddress, newValue2: number): Promise<PoolAdapterState01> {
        console.log("LendingPlatformManagerMock.changeCollateralFactor.start", this.poolAdapter.address);
        const before = await getPoolAdapterState(signer, this.poolAdapter.address);

        await this.poolAdapter.changeCollateralFactor(BigNumber.from(newValue2).mul(getBigNumberFrom(1, 18-2)) );

        const after = await getPoolAdapterState(signer, this.poolAdapter.address);
        console.log("LendingPlatformManagerMock.changeCollateralFactor.end", before, after);
        return {before, after};
    }

    /** Borrow max possible amount (and significantly increase the borrow rate) */
    async makeMaxBorrow(signer: SignerWithAddress): Promise<PoolAdapterState01> {
        console.log("LendingPlatformManagerMock.makeMaxBorrow.start");
        const before = await getPoolAdapterState(signer, this.poolAdapter.address);
        const borrowRate = await this.poolAdapter.borrowRate();
        const newBorrowRate = borrowRate.mul(100);
        const config = await this.poolAdapter.getConfig();

        await this.poolAdapter.changeBorrowRate(newBorrowRate);
        await this.platform.changeBorrowRate(config.borrowAsset, newBorrowRate);

        const after = await getPoolAdapterState(signer, this.poolAdapter.address);
        console.log("LendingPlatformManagerMock.makeMaxBorrow.end", before, after);
        return {before, after};
    }
    /** Return previously borrowed amount back (reverse to makeMaxBorrow) */
    async releaseMaxBorrow(signer: SignerWithAddress): Promise<PoolAdapterState01> {
        console.log("LendingPlatformManagerMock.releaseMaxBorrow.start");
        const before = await getPoolAdapterState(signer, this.poolAdapter.address);

        const borrowRate = await this.poolAdapter.borrowRate();
        const newBorrowRate = borrowRate.div(100);
        const config = await this.poolAdapter.getConfig();

        await this.poolAdapter.changeBorrowRate(newBorrowRate);
        await this.platform.changeBorrowRate(config.borrowAsset, newBorrowRate);

        const after = await getPoolAdapterState(signer, this.poolAdapter.address);
        console.log("LendingPlatformManagerMock.releaseMaxBorrow.end", before, after);
        return {before, after};
    }
}