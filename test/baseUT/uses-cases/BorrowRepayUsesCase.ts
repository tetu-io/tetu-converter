import {BigNumber} from "ethers";
import {IUserBalances} from "../utils/BalanceUtils";
import {
    IPoolAdapter__factory,
    Borrower
} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TokenDataTypes} from "../types/TokenDataTypes";

export interface IBorrowAction {
    collateralToken: TokenDataTypes,
    collateralAmount: BigNumber;
    borrowToken: TokenDataTypes,
    doAction: (user: Borrower) => Promise<IUserBalances>;
}

export interface IRepayAction {
    collateralToken: TokenDataTypes,
    borrowToken: TokenDataTypes,
    /** if undefined - repay all and close position */
    amountToRepay: BigNumber | undefined;
    doAction: (user: Borrower) => Promise<IUserBalances>;
}

export class BorrowRepayUsesCase {
    /**
     * Perform a series of actions, control user balances and total borrow balance after each action.
     * We assume, that uc has enough amount of collateral and borrow assets to make required actions.
     */
    static async makeBorrowRepayActions(
        signer: SignerWithAddress,
        user: Borrower,
        actions: (IBorrowAction | IRepayAction)[],
    ) : Promise<{
        userBalances: IUserBalances[],
        borrowBalances: BigNumber[]
    }>{
        const userBalances: IUserBalances[] = [];
        const borrowBalances: BigNumber[] = [];
        for (const action of actions) {
            const balances = await action.doAction(user);
            const poolAdapters: string[] = await user.getBorrows(action.collateralToken.address, action.borrowToken.address);
            borrowBalances.push(
                await poolAdapters.reduce(
                    async (prevPromise, curPoolAdapterAddress) => {
                        return prevPromise.then(async prevValue => {
                            const pa = IPoolAdapter__factory.connect(curPoolAdapterAddress, signer);
                            const status = await pa.getStatus();
                            return prevValue.add(status.amountToPay);
                        });
                    }
                    , Promise.resolve(BigNumber.from(0))
                )
            );
            userBalances.push(balances);
        }
        return {userBalances, borrowBalances};
    }
}