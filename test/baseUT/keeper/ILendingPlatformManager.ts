import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IPoolAdapter__factory} from "../../../typechain";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";

export interface IPoolAdapterState {
  apr: BigNumber;
  healthFactor2: BigNumber;
}

/** Two values of APR: before and after the given change */
export interface IPoolAdapterState01 {
  before: IPoolAdapterState;
  after: IPoolAdapterState;
}

export async function getPoolAdapterState(signer: SignerWithAddress, poolAdapter: string) : Promise<IPoolAdapterState> {
  const pa = IPoolAdapter__factory.connect(poolAdapter, signer);
  return {
    apr: await pa.getAPR18(),
    healthFactor2: (await pa.getStatus()).healthFactor18.div(getBigNumberFrom(1, 16))
  }
}

/**
 * Allow to modify behavior of the given lending platform,
 * i.e. change prices, change collateral factors and so on
 */
export interface ILendingPlatformManager {
  /** Increase or decrease a price of the asset on the given number of times */
  changeAssetPrice: (
    // eslint-disable-next-line no-unused-vars
    signer: SignerWithAddress,
    // eslint-disable-next-line no-unused-vars
    asset: string,
    // eslint-disable-next-line no-unused-vars
    inc: boolean,
    // eslint-disable-next-line no-unused-vars
    times: number
  ) => Promise<IPoolAdapterState01>;

  /**
   *   Change collateral factor of the collateral asset on new value
   * @param signer
   * @param newValue2 100 for 1, 200 for 2, etc
   */
  // eslint-disable-next-line no-unused-vars
  changeCollateralFactor: (signer: SignerWithAddress, newValue2: number) => Promise<IPoolAdapterState01>;

  /** Borrow max possible amount (and significantly increase the borrow rate) */
  // eslint-disable-next-line no-unused-vars
  makeMaxBorrow: (signer: SignerWithAddress) => Promise<IPoolAdapterState01>;
  /** Return previously borrowed amount back (reverse to makeMaxBorrow) */
  // eslint-disable-next-line no-unused-vars
  releaseMaxBorrow: (signer: SignerWithAddress) => Promise<IPoolAdapterState01>;

  // eslint-disable-next-line no-unused-vars
  setActive: (signer: SignerWithAddress, asset: string, active: boolean) => Promise<void>;
}