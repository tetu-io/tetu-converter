import {TokenWrapper} from "./TokenWrapper";
import {BigNumber} from "ethers";
import {IUserBalances} from "./BalanceUtils";
import {
    IPoolAdapter__factory,
    UserBorrowRepayUCs
} from "../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {deprecate} from "util";

export interface IBorrowAction {
    collateralToken: TokenWrapper,
    collateralAmount: BigNumber;
    borrowToken: TokenWrapper,
    countBlocks: number;
    healthFactor2: number;
    doAction: (user: UserBorrowRepayUCs) => Promise<IUserBalances>;
}

export interface IRepayAction {
    collateralToken: TokenWrapper,
    borrowToken: TokenWrapper,
    /** if undefined - repay all and close position */
    amountToRepay: BigNumber | undefined;
    doAction: (user: UserBorrowRepayUCs) => Promise<IUserBalances>;
}

export class BorrowRepayUsesCase {
    /**
     * Perform a series of actions, control user balances and total borrow balance after each action.
     * We assume, that uc has enough amount of collateral and borrow assets to make required actions.
     */
    static async makeBorrowRepayActions(
        signer: SignerWithAddress,
        user: UserBorrowRepayUCs,
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