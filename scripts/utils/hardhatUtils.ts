import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {BigNumber, ContractTransaction} from "ethers";
import {DeployerUtils} from "./DeployerUtils";

export async function generateSigners(amount: number): Promise<SignerWithAddress[]> {
  const signers: SignerWithAddress[] = []
  for (let i = 0; i < amount; i++) {
    const wallet = ethers.Wallet.createRandom();
    signers.push(await DeployerUtils.startImpersonate(wallet.address));
  }
  return signers;
}

export async function getGasUsed(p: Promise<ContractTransaction>): Promise<BigNumber> {
  const tx = await p;
  const rec = await tx.wait();
  console.log("Gas used: ", rec.gasUsed.toNumber());
  return rec.gasUsed;
}

export function controlGasLimits(f: () => void) {
  if (process.env.APP_DISABLE_GAS_LIMITS_CONTROL) {
    console.log("Gas control is skipped: gas used{}");
  } else {
    f();
  }
}

export function controlGasLimitsEx(
  gasUsed: BigNumber
  , gasLimit: number
  , f: (gasUsed: BigNumber, gasLimit: number) => void
) {
  console.log("process.env.APP_DISABLE_GAS_LIMITS_CONTROL", process.env.APP_DISABLE_GAS_LIMITS_CONTROL)
  if (process.env.APP_DISABLE_GAS_LIMITS_CONTROL === "1") {
    console.log(`Gas control is skipped: used=${gasUsed.toNumber()} limit=${gasLimit}}`);
  } else {
    f(gasUsed, gasLimit);
    console.log(`Limit - used = ${gasLimit - gasUsed.toNumber()}, used=${gasUsed.toNumber()}`);
  }
}