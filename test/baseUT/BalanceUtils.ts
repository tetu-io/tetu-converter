import {BigNumber} from "ethers";
import {IERC20__factory, IERC20Extended__factory} from "../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";

export interface ContractToInvestigate {
    name: string;
    contract: string;
}

export interface IUserBalances {
    collateral: BigNumber;
    borrow: BigNumber;
    gasUsed?: BigNumber;
}

export class BalanceUtils {
    /**
     * Get balance of each pair (contract, token)
     * and return array
     *   balance(c1, t1), balance(c1, t2) .. balance(c1, tN), balance(c2, t1) ...
     */
    static async getBalances(
        signer: SignerWithAddress,
        contracts: ContractToInvestigate[],
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
     * Convert string or number to string.
     * Use BigNumber.toString() for big-numbers
     */
    static toString(n: number | string | BigNumber | boolean) : string {
        return typeof n === "object"
            ? n.toString()
            : "" + n;
    }

    static async getAmountFromHolder(
        asset: string
        , holder: string
        , recipient: string
        , amount: number
    ) {
        const decimals = await IERC20Extended__factory.connect(
            asset
            , await DeployerUtils.startImpersonate(holder)
        ).decimals();

        await IERC20Extended__factory.connect(
            asset
            , await DeployerUtils.startImpersonate(holder)
        ).transfer(
            recipient
            , getBigNumberFrom(amount, decimals)
        );
    }
}