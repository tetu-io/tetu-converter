import {IBorrowAction} from "../BorrowRepayUsesCase";
import {IERC20__factory, Borrower} from "../../../typechain";
import {IUserBalances} from "../utils/BalanceUtils";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {TokenDataTypes} from "../types/TokenDataTypes";

export class BorrowAction implements IBorrowAction {
    public collateralToken: TokenDataTypes;
    public collateralAmount: BigNumber;
    public borrowToken: TokenDataTypes;
    public countBlocksToSkipAfterAction?: number;
    public controlGas?: boolean;

    constructor(
        collateralToken: TokenDataTypes,
        collateralAmount: BigNumber,
        borrowToken: TokenDataTypes,
        countBlocksToSkipAfterAction?: number,
        controlGas?: boolean
    ) {
        this.collateralToken = collateralToken;
        this.collateralAmount = collateralAmount;
        this.borrowToken = borrowToken;
        this.countBlocksToSkipAfterAction = countBlocksToSkipAfterAction;
        this.controlGas = controlGas;
    }

    async doAction(user: Borrower) : Promise<IUserBalances> {
        let gasUsed: BigNumber | undefined;

        await user.makeBorrowUC1_1(
            this.collateralToken.address,
            this.collateralAmount,
            this.borrowToken.address,
            user.address
        );
        if (this.controlGas) {
            gasUsed = await user.estimateGas.makeBorrowUC1_1(
                this.collateralToken.address,
                this.collateralAmount,
                this.borrowToken.address,
                user.address
            );
        }

        if (this.countBlocksToSkipAfterAction) {
            await TimeUtils.advanceNBlocks(this.countBlocksToSkipAfterAction);
        }

        const collateral = await IERC20__factory.connect(
            this.collateralToken.address,
            await DeployerUtils.startImpersonate(user.address)
        ).balanceOf(user.address);

        const borrow = await IERC20__factory.connect(
            this.borrowToken.address,
            await DeployerUtils.startImpersonate(user.address)
        ).balanceOf(user.address);

        return { collateral, borrow, gasUsed };
    }
}