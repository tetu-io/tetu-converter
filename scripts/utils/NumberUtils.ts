import {BigNumber, BigNumberish, logger} from "ethers";

/**
 * Return value * 10^powValue
 */
export function getBigNumberFrom(value: number | BigNumber, powValue: BigNumberish = 18) : BigNumber{
  if (typeof(value) === "number") {
    try {
      return BigNumber.from(value).mul(BigNumber.from(10).pow(powValue));
    } catch (e) {
      console.log("Problem value", value, e);
      throw e;
    }
  } else {
    return value;
  }
}

export function changeDecimals(value: BigNumber, fromDecimals: number, toDecimals: number): BigNumber {
  return value
    .mul(BigNumber.from(10).pow(toDecimals))
    .div(BigNumber.from(10).pow(fromDecimals));
}