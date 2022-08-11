import {IRepayAction} from "../uses-cases/BorrowRepayUsesCase";
import {BigNumber} from "ethers";
import {IERC20__factory, Borrower} from "../../../typechain";
import {IUserBalances} from "../utils/BalanceUtils";
import {TokenWrapper} from "../helpers/TokenWrapper";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";

export class RepayAction implements IRepayAction {
    public collateralToken: TokenWrapper;
    public borrowToken: TokenWrapper;
    /** if undefined - repay all */
    public amountToRepay: BigNumber | undefined;
    public countBlocksToSkipAfterAction?: number;
    public controlGas?: boolean;

    constructor(
        collateralToken: TokenWrapper,
        borrowToken: TokenWrapper,
        amountToRepay: BigNumber | undefined,
        countBlocksToSkipAfterAction?: number,
        controlGas?: boolean
    ) {
        this.collateralToken = collateralToken;
        this.borrowToken = borrowToken;
        this.amountToRepay = amountToRepay;
        this.countBlocksToSkipAfterAction = countBlocksToSkipAfterAction;
        this.controlGas = controlGas;
    }

    async doAction(user: Borrower) : Promise<IUserBalances> {
        let gasUsed: BigNumber | undefined;

        if (this.amountToRepay) {
            await user.makeRepayUC1_3(
                this.collateralToken.address,
                this.borrowToken.address,
                user.address,
                this.amountToRepay
            );
            if (this.controlGas) {
                gasUsed = await user.estimateGas.makeRepayUC1_3(
                    this.collateralToken.address,
                    this.borrowToken.address,
                    user.address,
                    this.amountToRepay
                );
            }
        } else {
            await user.makeRepayUC1_2(
                this.collateralToken.address,
                this.borrowToken.address,
                user.address
            );
            if (this.controlGas) {
                gasUsed = await user.estimateGas.makeRepayUC1_2(
                    this.collateralToken.address,
                    this.borrowToken.address,
                    user.address
                );
            }
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