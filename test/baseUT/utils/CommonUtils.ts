import {BigNumber, BigNumberish} from "ethers";
import {BalanceUtils} from "./BalanceUtils";
import {IERC20__factory, IERC20Metadata__factory} from "../../../typechain";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {parseUnits} from "ethers/lib/utils";

export async function setInitialBalance(
  deployer: SignerWithAddress,
  asset: string,
  amount: number | BigNumber,
  recipient: string
) : Promise<BigNumber> {
  const token = await IERC20Metadata__factory.connect(asset, deployer);
  const requiredAmount = typeof(amount) === "number"
    ? parseUnits(amount.toString(), await token.decimals())
    : amount;
  await TokenUtils.getToken(asset, recipient, requiredAmount);
  return token.balanceOf(recipient);
}

/// @param accuracy 10 for 1e-10
export function areAlmostEqual(b1: BigNumber, b2: BigNumber, accuracy: number = 8) : boolean {
  if (b1.eq(0)) {
    return b2.eq(0);
  }
  const n18 = getBigNumberFrom(1, accuracy);
  console.log("approx1", b1.toString(), b2.toString());
  console.log("approx2", b1.sub(b2).toString());
  console.log("approx3", b1.sub(b2).mul(n18).div(b1).abs().toString());
  console.log("approx4", b1.sub(b2).mul(n18).div(b1).abs().mul(accuracy).toString());
  console.log("approx5", b1.sub(b2).mul(n18).div(b1).abs().mul(accuracy).toNumber().toString());
  return b1.sub(b2).mul(n18).div(b1).abs().mul(accuracy).toNumber() === 0;
}

/**
 * i.e. AAVE v2 returns a bit of different values:
 *    result   = 100163.32794782843037345
 *    expected = 100163.32794782843037344
 * the difference is neglect, we can close eyes on it
 */
export function toStringWithRound(bn: BigNumber, decimals: number) : string {
  return ethers.utils.formatUnits(bn.div(10), decimals - 1);
}


export function getDifference(bn1?: BigNumber, bn2?: BigNumber) : BigNumber {
  return (bn1 || BigNumber.from(0)).sub(bn2 || BigNumber.from(0));
}


export function getSum(bn: BigNumber[]) : BigNumber {
  return bn.reduce((a, b) => a.add(b), BigNumber.from(0));
}

export class CommonUtils {
  public static toString(n: BigNumberish | boolean | undefined) : string {
    if (n === undefined) {
      return "";
    }
    return typeof n === "object" && n.toString()
        ? n.toString()
        : "" + n;
  }

  public static toMantissa(amount: BigNumber, from: number, to: number): BigNumber {
    return amount.mul(getBigNumberFrom(1, to)).div(getBigNumberFrom(1, from));
  }

  public static getRatioMul100(bn1?: BigNumber, bn2?: BigNumber) : BigNumber | undefined {
    if (bn1 && bn2 && !bn1.eq(0) && !bn2.eq(0)) {
      return bn1.mul(100).div(bn2);
    }
    return undefined;
  }
}