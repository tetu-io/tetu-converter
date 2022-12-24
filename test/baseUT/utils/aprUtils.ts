import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {Misc} from "../../../scripts/utils/Misc";
import {toMantissa} from "./CommonUtils";
import {parseUnits} from "ethers/lib/utils";

export const COUNT_BLOCKS_PER_DAY = 41142; // 15017140 / 365
const COUNT_SECONDS_PER_YEAR = 31536000;
export class AprUtils {

  static aprPerBlock18(br27: BigNumber, countBlocksPerDay: number = COUNT_BLOCKS_PER_DAY) : BigNumber {
    return br27
      .div(COUNT_SECONDS_PER_YEAR)
      .div(COUNT_SECONDS_PER_YEAR).mul(365).mul(COUNT_BLOCKS_PER_DAY)
      .mul(Misc.WEI)
      .div(getBigNumberFrom(1, 27));
  }

  /**
   * What amount can be borrowed using given collateral amount, health factor and liquidation threshold.
   */
  public static getBorrowAmount(
    collateralAmount: BigNumber,
    healthFactor2: number,
    liquidationThreshold18: BigNumber,
    priceCollateral: BigNumber,
    priceBorrow: BigNumber,
    collateralDecimals: number,
    borrowDecimals: number
  ) {
    return collateralAmount
        .mul(100)
        .div(healthFactor2)
        .mul(liquidationThreshold18)
        .mul(priceCollateral)
        .div(priceBorrow)
        .mul(parseUnits("1", borrowDecimals))
        .div(Misc.WEI)
        .div(parseUnits("1", collateralDecimals));
  }
}