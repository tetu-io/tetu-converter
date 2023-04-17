import {BigNumber} from "ethers";

export interface ICompound3AssetInfo {
  offset: number,
  asset: string,
  priceFeed: string,
  scale: BigNumber,
  borrowCollateralFactor: BigNumber,
  liquidateCollateralFactor: BigNumber,
  liquidationFactor: BigNumber,
  supplyCap: BigNumber,
}
