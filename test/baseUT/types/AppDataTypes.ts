import {BigNumber} from "ethers";

export interface IConversionPlan {
  converter: string;
  liquidationThreshold18: BigNumber;
  amountToBorrow: BigNumber;
  collateralAmount: BigNumber;
  borrowCost36: BigNumber;
  supplyIncomeInBorrowAsset36: BigNumber;
  rewardsAmountInBorrowAsset36: BigNumber;
  amountCollateralInBorrowAsset36: BigNumber;
  ltv18: BigNumber;
  maxAmountToBorrow: BigNumber;
  maxAmountToSupply: BigNumber;
}

export interface IConversionPlanNum {
  converter: string;
  liquidationThreshold: number;
  amountToBorrow: number;
  collateralAmount: number;
  borrowCost: number;
  supplyIncomeInBorrowAsset: number;
  rewardsAmountInBorrowAsset: number;
  amountCollateralInBorrowAsset: number;
  ltv: number;
  maxAmountToBorrow: number;
  maxAmountToSupply: number;
}
