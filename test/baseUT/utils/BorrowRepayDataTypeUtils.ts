import {IPoolAdapterStatus, IPoolAdapterStatusNum} from "../types/BorrowRepayDataTypes";
import {formatUnits} from "ethers/lib/utils";

export class BorrowRepayDataTypeUtils {
  static getPoolAdapterStatusNum(
    p: IPoolAdapterStatus,
    collateralDecimals: number,
    borrowDecimals: number
  ): IPoolAdapterStatusNum {
    return {
      opened: p.opened,
      collateralAmount: +formatUnits(p.collateralAmount, collateralDecimals),
      amountToPay: +formatUnits(p.amountToPay, borrowDecimals),
      healthFactor: +formatUnits(p.healthFactor18, 18),
      collateralAmountLiquidated: +formatUnits(p.collateralAmountLiquidated, collateralDecimals),
      debtGapRequired: p.debtGapRequired
    }
  }
}