import {BigNumber} from "ethers";

export interface IRates {
  borrowRate: BigNumber;
  supplyRate: BigNumber;
}

export interface IPeriod {
  block0: number;
  block1: number;
  blockTimestamp0: number;
  blockTimestamp1: number;
}

export interface IAmounts {
  collateral: BigNumber;
  borrow: BigNumber;
  rewards?: BigNumber;
}

export interface IPointResults {
  period: IPeriod;
  rates: IRates;
  /** Result balances.
   * Supply is in terms of collateral token, borrow - in terms of borrow tokens, rewards - in terms of rewards token
   **/
  balances: IAmounts;

  /** Actual costs for period, all values are given in terms of borrow token, decimals 18*/
  costsBT18: IAmounts;
  /** both supply and borrow rewards in total (starting from the beginning) */
  totalAmountRewards?: BigNumber;
}

/**
 * Results of the borrow.
 * 0. Predict APR
 * 1. Make borrow
 * 2. Wait N blocks
 * 3. Check current collateral and borrow balances.
 */
export interface IBorrowResults {
  init: {
    collateralAmount: BigNumber;
    collateralAmountBT18: BigNumber;
    borrowAmount: BigNumber;
  }
  prices: IAmounts;

  predicted: {
    /** Predicted APR, all values are given in terms of borrow token */
    aprBT18: IAmounts;
    rates: IRates;
  }

  resultsBlock: {
    period: IPeriod;
    /** APR for single block, all values are given in terms of borrow token */
    aprBT18: IAmounts;
    rates: IRates;
  }

  points: IPointResults[];
}

export interface IAaveKeyState {
  rate: BigNumber;
  liquidityIndex: BigNumber;
  reserveNormalized: BigNumber;
  block: number;
  blockTimeStamp: number;
  scaledBalance: BigNumber;
  userBalanceBase: BigNumber
  lastUpdateTimestamp: number;
}

export interface IAaveKeyTestValues {
  borrowRatePredicted: BigNumber;
  liquidityRatePredicted: BigNumber;

  liquidity: {
    beforeBorrow: IAaveKeyState,
    next: IAaveKeyState,
    last: IAaveKeyState
  },
  borrow: {
    beforeBorrow: IAaveKeyState,
    next: IAaveKeyState,
    last: IAaveKeyState
  },
}

export interface ConfigurableAmountToBorrow {
  /**
   * true  - exactAmountToBorrow contains exact amount to borrow
   * false - ratio18 contains RATIO, amount to borrow will be calculated as
   *         amount to borrow = max allowed amount * RATIO
   *         The RATIO should have decimals 18
   * */
  exact: boolean;

  /** One of two fields below must be not empty depending on exact value*/

  exactAmountToBorrow: BigNumber | undefined;
  ratio18: BigNumber | undefined;
}

export interface ConversionPlan {
  converter: string;
  liquidationThreshold18: BigNumber;
  borrowApr18: BigNumber;
  supplyAprBT18: BigNumber;
  rewardsAmountBT18: BigNumber;
  ltv18: BigNumber;
  maxAmountToBorrowBT: BigNumber;
  maxAmountToSupplyCT: BigNumber;
}

export interface IAsset {
  /** title */
  t: string;
  /** address */
  a: string;
}

export interface IAssetHoldersBox {
  asset: string;
  holders: string[];
}
