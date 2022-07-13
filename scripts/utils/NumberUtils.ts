import {BigNumber, BigNumberish, logger} from "ethers";

/**
 * Return value * 10^powValue
 */
export function getBigNumberFrom(value: any, powValue: BigNumberish = 18) {
    try {
        return BigNumber.from(value).mul(BigNumber.from(10).pow(powValue));
    } catch (e) {
        console.log("Problem value", value, e);
        throw e;
    }
}