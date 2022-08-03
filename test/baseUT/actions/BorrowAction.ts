import {IBorrowAction} from "../BorrowRepayUsesCase";
import {IERC20__factory, UserBorrowRepayUCs} from "../../../typechain";
import {IUserBalances} from "../BalanceUtils";
import {TokenWrapper} from "../TokenWrapper";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";

export class BorrowAction implements IBorrowAction {
    public collateralToken: TokenWrapper;
    public collateralAmount: BigNumber;
    public borrowToken: TokenWrapper;
    public countBlocks: number;
    public healthFactor2: number;

    constructor(
        collateralToken: TokenWrapper,
        collateralAmount: BigNumber,
        borrowToken: TokenWrapper,
        countBlocks: number,
        healthFactor2: number
    ) {
        this.collateralToken = collateralToken;
        this.collateralAmount = collateralAmount;
        this.borrowToken = borrowToken;
        this.countBlocks = countBlocks;
        this.healthFactor2 = healthFactor2;
    }

    async doAction(user: UserBorrowRepayUCs) : Promise<IUserBalances> {
        await user.makeBorrowUC1_1(
            this.collateralToken.address,
            this.collateralAmount,
            this.borrowToken.address,
            this.countBlocks,
            this.healthFactor2,
            user.address
        );

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