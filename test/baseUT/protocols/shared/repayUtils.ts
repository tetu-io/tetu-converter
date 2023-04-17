import {BigNumber} from "ethers";

export class RepayUtils {
  /**
   * Calculates the amount to repay
   *  Amount of debt is X, debt gap is delta.
   *  We should pay: X < X + delta * percent / 100 < X + delta
   */
  static calcAmountToRepay(debtAmount: BigNumber, debtGap: BigNumber, percent: number): BigNumber {
    const DEBT_GAP_DENOMINATOR = 100_000;
    return debtAmount.mul(debtGap.mul(percent).div(100).add(DEBT_GAP_DENOMINATOR)).div(DEBT_GAP_DENOMINATOR);
  }

}