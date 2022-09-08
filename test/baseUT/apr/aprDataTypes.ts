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
    collateralAmountBT: BigNumber;
    borrowAmount: BigNumber;
  }
  prices: IAmounts;

  predicted: {
    /** Predicted APR, all values are given in terms of borrow token */
    aprBT: IAmounts;
    rates: IRates;
  }

  resultsBlock: {
    period: IPeriod;
    /** APR for single block, all values are given in terms of borrow token */
    aprBT: IAmounts;
    rates: IRates;
  }

  // resultsPeriod: {
  //   period: IPeriod;
  //
  //   /** Result balances.
  //    * Supply is in terms of collateral token, borrow - in terms of borrow tokens, rewards - in terms of rewards token
  //    **/
  //   balances: IAmounts;
  //
  //   /** Actual costs for period, all values are given in terms of borrow token.*/
  //   costs: IAmounts;
  //   rates: IRates;
  // }
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
    afterBorrow: IAaveKeyState,
    next: IAaveKeyState,
    last: IAaveKeyState
  },
  borrow: {
    beforeBorrow: IAaveKeyState,
    afterBorrow: IAaveKeyState,
    next: IAaveKeyState,
    last: IAaveKeyState
  },
}