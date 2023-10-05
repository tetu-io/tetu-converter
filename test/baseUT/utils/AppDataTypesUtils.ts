import {IConversionPlan, IConversionPlanNum} from "../types/AppDataTypes";
import {formatUnits} from "ethers/lib/utils";

export class AppDataTypesUtils {
  static async getConversionPlanNum(
    p: IConversionPlan,
    decimalsCollateral: number,
    decimalsBorrow: number
  ): Promise<IConversionPlanNum> {
    return {
      collateralAmount: +formatUnits(p.collateralAmount, decimalsCollateral),
      amountToBorrow: +formatUnits(p.amountToBorrow, decimalsBorrow),
      maxAmountToBorrow: +formatUnits(p.maxAmountToBorrow, decimalsBorrow),
      maxAmountToSupply: +formatUnits(p.maxAmountToSupply, decimalsCollateral),
      amountCollateralInBorrowAsset: +formatUnits(p.amountCollateralInBorrowAsset36, 36),
      rewardsAmountInBorrowAsset: +formatUnits(p.rewardsAmountInBorrowAsset36, 36),
      supplyIncomeInBorrowAsset: +formatUnits(p.supplyIncomeInBorrowAsset36, 36),
      borrowCost: +formatUnits(p.borrowCost36, 36),
      ltv: +formatUnits(p.ltv18, 18),
      converter: p.converter,
      liquidationThreshold: +formatUnits(p.liquidationThreshold18, 18)
    }
  }
}