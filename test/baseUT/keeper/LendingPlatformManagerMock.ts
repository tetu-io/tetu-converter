import {getPoolAdapterState, ILendingPlatformManager, PoolAdapterState01} from "./ILendingPlatformManager";
import {
  LendingPlatformMock,
  PoolAdapterMock,
  PriceOracleMock__factory
} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";

export class LendingPlatformManagerMock implements ILendingPlatformManager {
  poolAdapter: PoolAdapterMock;
  platform: LendingPlatformMock;
  constructor(
    pa: PoolAdapterMock,
    platform: LendingPlatformMock
  ) {
    this.poolAdapter = pa;
    this.platform = platform;
  }

  /** Increase or decrease a price of the asset on the given number of times */
  async changeAssetPrice(
    signer: SignerWithAddress,
    asset: string,
    inc: boolean,
    times: number,
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

    await this.poolAdapter.changeCollateralFactor(BigNumber.from(newValue2).mul(getBigNumberFrom(1, 18-2)));

    const after = await getPoolAdapterState(signer, this.poolAdapter.address);
    console.log("LendingPlatformManagerMock.changeCollateralFactor.end", before, after);
    return {before, after};
  }

  /** Borrow max possible amount (and significantly increase the borrow rate) */
  async changeBorrowRate(
    signer: SignerWithAddress,
    multiplication: boolean,
    ratio: number
  ): Promise<PoolAdapterState01> {
    console.log("LendingPlatformManagerMock.makeBorrow.start", multiplication, ratio);
    const before = await getPoolAdapterState(signer, this.poolAdapter.address);
    const borrowRate = await this.poolAdapter.borrowRate();
    const newBorrowRate = multiplication
      ? borrowRate.mul(ratio * 1000).div(1000)
      : borrowRate.div(ratio * 1000).div(1000)
    const config = await this.poolAdapter.getConfig();

    console.log(`Change borrow rate from ${borrowRate.toString()} to ${newBorrowRate.toString()}`);
    await this.poolAdapter.changeBorrowRate(newBorrowRate);
    await this.platform.changeBorrowRate(config.borrowAsset, newBorrowRate);

    const after = await getPoolAdapterState(signer, this.poolAdapter.address);
    console.log("LendingPlatformManagerMock.makeBorrow.end", before, after);
    return {before, after};
  }

  /** Borrow max possible amount (and significantly increase the borrow rate) */
  async makeMaxBorrow(signer: SignerWithAddress): Promise<PoolAdapterState01> {
    return this.changeBorrowRate(signer, true, 200);
  }

  /** Return previously borrowed amount back (reverse to makeMaxBorrow) */
  async releaseMaxBorrow(signer: SignerWithAddress): Promise<PoolAdapterState01> {
    return this.changeBorrowRate(signer, false, 200);
  }

  async setActive(signer: SignerWithAddress, asset: string, active: boolean) {
    // TODO
  }
}