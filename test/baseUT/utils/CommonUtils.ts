import {BigNumber} from "ethers";
import {BalanceUtils} from "./BalanceUtils";
import {IERC20__factory} from "../../../typechain";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export async function setInitialBalance(
  deployer: SignerWithAddress,
  asset: string,
  holders: string,
  amount: number | BigNumber,
  recipient: string
) : Promise<BigNumber> {
  const hh = holders.split(";");

  let dest: BigNumber = BigNumber.from(0);
  for (const h of hh) {
    await BalanceUtils.getAmountFromHolder(asset, h, recipient, amount);
    dest = dest.add(
      await IERC20__factory.connect(asset, deployer).balanceOf(recipient)
    );
  }

  return dest;
}

/// @param accuracy 10 for 1e-10
export function areAlmostEqual(b1: BigNumber, b2: BigNumber, accuracy: number = 8) : boolean {
  const n18 = getBigNumberFrom(1, accuracy);
  console.log("approx1", b1, b2);
  console.log("approx2", b1.sub(b2));
  console.log("approx3", b1.sub(b2).mul(n18).div(b1).abs());
  console.log("approx4", b1.sub(b2).mul(n18).div(b1).abs().mul(accuracy));
  console.log("approx5", b1.sub(b2).mul(n18).div(b1).abs().mul(accuracy).toNumber());
  return b1.sub(b2).mul(n18).div(b1).abs().mul(accuracy).toNumber() == 0;
}