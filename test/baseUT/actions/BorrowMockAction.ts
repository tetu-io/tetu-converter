import {BorrowAction} from "./BorrowAction";
import {TokenWrapper} from "../TokenWrapper";
import {BigNumber} from "ethers";
import {PoolAdapterMock__factory, UserBorrowRepayUCs} from "../../../typechain";
import {IUserBalances} from "../BalanceUtils";
import {ethers} from "hardhat";

/** BorrowAction + setPassedBlocks(count blocks) */
export class BorrowMockAction extends BorrowAction {
    private _mockAddress?: string;
    constructor(
        collateralToken: TokenWrapper,
        collateralAmount: BigNumber,
        borrowToken: TokenWrapper,
        countBlocks: number,
        healthFactor2: number,
        countBlocksToSkipAfterAction?: number,
        mockAddress?: string
    ) {
        super(collateralToken, collateralAmount, borrowToken, countBlocks, healthFactor2, countBlocksToSkipAfterAction);

        this._mockAddress = mockAddress;
    }

    async doAction(user: UserBorrowRepayUCs) : Promise<IUserBalances> {
        const ret = await super.doAction(user);

        // !TODO
        // if (this.countBlocksToSkipAfterAction && this._mockAddress) {
        //     await PoolAdapterMock__factory.connect(this._mockAddress, ethers.Wallet.createRandom())
        //         .setPassedBlocks(this.countBlocksToSkipAfterAction);
        // }

        return ret;
    }
}