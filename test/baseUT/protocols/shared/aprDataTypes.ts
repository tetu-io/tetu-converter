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
}

export interface IResultAmounts {
  costBorrow36: BigNumber;
  supplyIncomeInBorrowTokens36: BigNumber;
  rewardsAmountInBorrowTokens36?: BigNumber;
  apr18: BigNumber;
}

export interface IPointResults {
  period: IPeriod;
  rates: IRates;
  /* Result balances.
   * Supply is in terms of collateral token, borrow - in terms of borrow tokens, rewards - in terms of rewards token
   **/
  balances: IAmounts;

  /* Actual costs for period, all values are given in terms of borrow token, decimals 18 */
  costsInBorrowTokens36: IAmounts;

  /* both supply and borrow rewards in total (starting from the beginning) */
  totalAmountRewards?: BigNumber;

  /** both supply and borrow rewards in total (starting from the beginning) in terms of borrow tokens, decimals 36 */
  totalAmountRewardsBt36?: BigNumber;
}

/**
 * Results of the borrow.
 * 0. Predict APR
 * 1. Make borrow
 * 2. Wait N blocks
 * 3. Check current collateral and borrow balances.
 */
export interface IBorrowResults {
  collateralAmount: BigNumber;
  collateralAmountInBorrowTokens18: BigNumber;
  borrowAmount: BigNumber;

  prices: IAmounts;

  predictedAmounts: IResultAmounts;
  predictedRates: IRates;

  period: IPeriod;
  resultAmounts: IResultAmounts;
  resultRates: IRates;

  points: IPointResults[];
}

export interface IAssetInfo {
  asset: string;
  title: string;
  holders: string[];
}

export interface ISwapResults {
  collateralAmount: BigNumber;
  borrowedAmount: BigNumber;
  apr18: BigNumber;
  lostCollateral: BigNumber;
}

export interface IStrategyToConvert {
  converter: string;
  collateralAmountOut: BigNumber;
  amountToBorrowOut: BigNumber;
  apr18: BigNumber;
}

export interface IStrategyToSwap {
  converter: string;
  maxTargetAmount: BigNumber;
}