import {BorrowAction} from "./BorrowAction";
import {BigNumber} from "ethers";
import {PoolAdapterMock__factory, Borrower} from "../../../typechain";
import {IUserBalances} from "../utils/BalanceUtils";
import {ethers} from "hardhat";
import {TokenDataTypes} from "../types/TokenDataTypes";

/** BorrowAction + setPassedBlocks(count blocks) */
export class BorrowMockAction extends BorrowAction {
    private _mockAddress?: string;
    constructor(
        collateralToken: TokenDataTypes,
        collateralAmount: BigNumber,
        borrowToken: TokenDataTypes,
        countBlocksToSkipAfterAction?: number,
        mockAddress?: string
    ) {
        super(collateralToken, collateralAmount, borrowToken, countBlocksToSkipAfterAction);

        this._mockAddress = mockAddress;
    }

    async doAction(user: Borrower) : Promise<IUserBalances> {
        const ret = await super.doAction(user);

        // !TODO
        // if (this.countBlocksToSkipAfterAction && this._mockAddress) {
        //     await PoolAdapterMock__factory.connect(this._mockAddress, ethers.Wallet.createRandom())
        //         .setPassedBlocks(this.countBlocksToSkipAfterAction);
        // }

        return ret;
    }
}