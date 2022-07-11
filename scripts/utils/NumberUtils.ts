import {BigNumber, BigNumberish, logger} from "ethers";

/**
 * Return value * 10^powValue
 */
export function getBigNumberFrom(value: any, powValue: BigNumberish = 18) {
    return BigNumber.from(value).mul(BigNumber.from(10).pow(powValue));
}