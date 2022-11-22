import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {IERC20__factory, IERC20Extended, IERC20Extended__factory} from "../../../typechain";
import {analyzeModuleNotFoundError} from "hardhat/internal/core/config/config-loading";

export interface IContractToInvestigate {
  name: string;
  contract: string;
}

export interface IUserBalances {
  collateral: BigNumber;
  borrow: BigNumber;
  gasUsed: BigNumber;
}

export class BalanceUtils {
  /**
   * Get balance of each pair (contract, token)
   * and return array
   *   balance(c1, t1), balance(c1, t2) .. balance(c1, tN), balance(c2, t1) ...
   */
  static async getBalances(
    signer: SignerWithAddress,
    contracts: IContractToInvestigate[],
    tokens: string[]
  ) : Promise<(BigNumber | string)[]> {
    const dest: (BigNumber | string)[] = [];
    for (const contract of contracts) {
      dest.push(contract.name);
      for (const token of tokens) {
        dest.push(
          await IERC20__factory.connect(token, signer).balanceOf(contract.contract)
        )
      }
    }
    return dest;
  }

  /**
   * Get balance of each pair (contract, token)
   * and return array
   *   name1: {balance(c1, t1), balance(c1, t2) .. balance(c1, tN),}
   *   name2: {balance(c2, t1), balance(c2, t2) .. balance(c2, tN),}
   *   ...
   */
  static async getBalancesObj(
    signer: SignerWithAddress,
    contracts: IContractToInvestigate[],
    tokens: string[]
  ) : Promise<Map<string, (BigNumber | string)[]>> {
    const dest: Map<string, (BigNumber | string)[]> = new Map<string, (BigNumber | string)[]>();
    for (const contract of contracts) {
      const items: (BigNumber | string)[] = [];
      for (const token of tokens) {
        items.push(
          await IERC20__factory.connect(token, signer).balanceOf(contract.contract)
        )
      }
      dest.set(contract.name, items);
    }
    return dest;
  }

  /**
   * Convert string or number to string.
   * Use BigNumber.toString() for big-numbers
   */
  static toString(n: number | string | BigNumber | boolean) : string {
    return typeof n === "object"
      ? n.toString()
      : "" + n;
  }

  static async getAmountFromHolder(
    asset: string,
    holder: string,
    recipient: string,
    amount: number | BigNumber
  ) : Promise<BigNumber> {
    const connection = await IERC20Extended__factory.connect(
      asset
      , await DeployerUtils.startImpersonate(holder)
    );
    const decimals = await connection.decimals();

    const requiredTotalAmount = typeof(amount) === "number"
      ? getBigNumberFrom(amount, decimals)
      : amount;
    const availableAmount = await connection.balanceOf(holder);
    const amountToClaim = requiredTotalAmount.gt(availableAmount)
      ? availableAmount
      : requiredTotalAmount;
    console.log("holder", holder);
    console.log("availableAmount", availableAmount);
    console.log("requiredTotalAmount", requiredTotalAmount);
    console.log("decimals", decimals);
    console.log("amount", amount);

    if (amountToClaim.gt(0)) {
      console.log(`Transfer ${amountToClaim.toString()} of ${await connection.name()} to ${recipient}`);
      await connection.transfer(recipient, amountToClaim);
    }

    return amountToClaim;
  }

  /**
   * Transfer {requiredAmount} from holders to the receiver.
   * If the {requiredAmount} is undefined, transfer all available amount.
   * Return transferred amount
   */
  static async getRequiredAmountFromHolders(
    requiredAmount: BigNumber | undefined,
    token: IERC20Extended,
    holders: string[],
    receiver: string
  ) : Promise<BigNumber> {
    let dest: BigNumber = BigNumber.from(0);
    for (const holder of holders) {
      const holderBalance = await token.balanceOf(holder);
      const amountToTransfer = requiredAmount && holderBalance.gt(requiredAmount)
        ? requiredAmount
        : holderBalance;

      await token
        .connect(await DeployerUtils.startImpersonate(holder))
        .transfer(receiver, amountToTransfer);
      console.log("Require ", requiredAmount, " transfer ", amountToTransfer);

      dest = dest.add(amountToTransfer);
      if (requiredAmount) {
        requiredAmount = requiredAmount?.sub(amountToTransfer);
      }
    }

    return dest;
  }
}