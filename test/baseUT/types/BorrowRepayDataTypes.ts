//region Data types
import {BigNumber} from "ethers";

export interface ITokenParams {
  asset: string;
  /** ;- separated list of holders */
  holder: string;
  initialLiquidity: number | BigNumber;
}

/* Input params for test: single borrow, single repay*/
export interface ITestSingleBorrowParams {
  collateral: ITokenParams;
  borrow: ITokenParams;
  collateralAmount: number | BigNumber;
  healthFactor2: number;
  countBlocks: number;
}
/* Input params for test: two borrows, two repays*/
export interface ITestTwoBorrowsParams extends ITestSingleBorrowParams {
  collateralAmount2: number;
  repayAmount1: number;
  deltaBlocksBetweenBorrows: number;
  deltaBlocksBetweenRepays: number;
}

export interface IMockCTokenParams {
  decimals: number;
  liquidity: number;
  borrowRate: BigNumber;
  collateralFactor: number;
}

export interface IMockTestInputParams {
  collateral: IMockCTokenParams;
  borrow: IMockCTokenParams;
}

export interface IPoolAdapterStatus {
  collateralAmount: BigNumber;
  amountToPay: BigNumber;
  healthFactor18: BigNumber;
  opened: boolean;
  collateralAmountLiquidated: BigNumber;
}
//endregion Data types