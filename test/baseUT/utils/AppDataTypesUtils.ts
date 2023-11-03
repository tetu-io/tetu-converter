import {IConversionPlan, IConversionPlanNum} from "../types/AppDataTypes";
import {formatUnits} from "ethers/lib/utils";
import {Misc} from "../../../scripts/utils/Misc";

export class AppDataTypesUtils {
  static getConversionPlanNum(p: IConversionPlan, decimalsCollateral: number, decimalsBorrow: number): IConversionPlanNum {
    return {
      collateralAmount: +formatUnits(p.collateralAmount, decimalsCollateral),
      amountToBorrow: +formatUnits(p.amountToBorrow, decimalsBorrow),
      maxAmountToBorrow: p.maxAmountToBorrow.eq(Misc.MAX_UINT)
        ? Number.MAX_SAFE_INTEGER
        : +formatUnits(p.maxAmountToBorrow, decimalsBorrow),
      maxAmountToSupply: p.maxAmountToSupply.eq(Misc.MAX_UINT)
        ? Number.MAX_SAFE_INTEGER
        : +formatUnits(p.maxAmountToSupply, decimalsCollateral),
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