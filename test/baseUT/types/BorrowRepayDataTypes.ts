//region Data types
import {BigNumber} from "ethers";

export interface TokenParams {
  asset: string;
  holder: string;
  initialLiquidity: number;
}

/** Input params for test: single borrow, single repay*/
export interface TestSingleBorrowParams {
  collateral: TokenParams;
  borrow: TokenParams;
  collateralAmount: number;
  healthFactor2: number;
  countBlocks: number;
}
/** Input params for test: two borrows, two repays*/
export interface TestTwoBorrowsParams extends TestSingleBorrowParams {
  collateralAmount2: number;
  repayAmount1: number;
  deltaBlocksBetweenBorrows: number;
  deltaBlocksBetweenRepays: number;
}

export interface MockCTokenParams {
  decimals: number;
  liquidity: number;
  borrowRate: BigNumber;
  collateralFactor: number;
}

export interface MockTestInputParams {
  collateral: MockCTokenParams;
  borrow: MockCTokenParams;
}
//endregion Data types