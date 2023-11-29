import {BigNumber, BigNumberish} from "ethers";

export interface IPlatformActor {
  getAvailableLiquidity: () => Promise<BigNumber>;
  getCurrentBR: () => Promise<BigNumber>;
  // eslint-disable-next-line no-unused-vars
  supplyCollateral: (collateralAmount: BigNumber) => Promise<void>;
  // eslint-disable-next-line no-unused-vars
  borrow: (borrowAmount: BigNumber) => Promise<void>;
  // eslint-disable-next-line no-unused-vars
  getBorrowRateAfterBorrow: (borrowAsset: string, amountToBorrow: BigNumberish) => Promise<BigNumber>;
}