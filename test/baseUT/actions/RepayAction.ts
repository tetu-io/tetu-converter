import {IRepayAction} from "../BorrowRepayUsesCase";
import {BigNumber} from "ethers";
import {IERC20__factory, UserBorrowRepayUCs} from "../../../typechain";
import {IUserBalances} from "../BalanceUtils";
import {TokenWrapper} from "../TokenWrapper";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";

export class RepayAction implements IRepayAction {
    public collateralToken: TokenWrapper;
    public borrowToken: TokenWrapper;
    /** if undefined - repay all */
    public amountToRepay: BigNumber | undefined;

    constructor(
        collateralToken: TokenWrapper,
        borrowToken: TokenWrapper,
        amountToRepay: BigNumber | undefined
    ) {
        this.collateralToken = collateralToken;
        this.borrowToken = borrowToken;
        this.amountToRepay = amountToRepay;
    }

    async doAction(user: UserBorrowRepayUCs) : Promise<IUserBalances> {
        if (this.amountToRepay) {
            await user.makeRepayUC1_3(
                this.collateralToken.address,
                this.borrowToken.address,
                user.address,
                this.amountToRepay
            );
        } else {
            await user.makeRepayUC1_2(
                this.collateralToken.address,
                this.borrowToken.address,
                user.address
            );
        }

        const collateral = await IERC20__factory.connect(
            this.collateralToken.address,
            await DeployerUtils.startImpersonate(user.address)
        ).balanceOf(user.address);

        const borrow = await IERC20__factory.connect(
            this.borrowToken.address,
            await DeployerUtils.startImpersonate(user.address)
        ).balanceOf(user.address);

        return { collateral, borrow };
    }
}