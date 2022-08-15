import {IRepayAction} from "../BorrowRepayUsesCase";
import {BigNumber} from "ethers";
import {IERC20__factory, Borrower} from "../../../typechain";
import {IUserBalances} from "../utils/BalanceUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {TokenDataTypes} from "../types/TokenDataTypes";

export interface RepayActionOptionalParams {
    countBlocksToSkipAfterAction?: number,
    controlGas?: boolean;
    repayFirstPositionOnly?: boolean;
}

export class RepayAction implements IRepayAction {
    public collateralToken: TokenDataTypes;
    public borrowToken: TokenDataTypes;
    /** if undefined - repay all */
    public amountToRepay: BigNumber | undefined;
    public params: RepayActionOptionalParams;

    constructor(
        collateralToken: TokenDataTypes,
        borrowToken: TokenDataTypes,
        amountToRepay: BigNumber | undefined,
        params: RepayActionOptionalParams
    ) {
        this.collateralToken = collateralToken;
        this.borrowToken = borrowToken;
        this.amountToRepay = amountToRepay;
        this.params = params;
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
            if (this.params.controlGas) {
                gasUsed = await user.estimateGas.makeRepayUC1_3(
                    this.collateralToken.address,
                    this.borrowToken.address,
                    user.address,
                    this.amountToRepay
                );
            }
        } else {
            if (this.params.repayFirstPositionOnly) {
                await user.makeRepayUC1_2_firstPositionOnly(
                    this.collateralToken.address,
                    this.borrowToken.address,
                    user.address
                );
                if (this.params.controlGas) {
                    gasUsed = await user.estimateGas.makeRepayUC1_2_firstPositionOnly(
                        this.collateralToken.address,
                        this.borrowToken.address,
                        user.address
                    );
                }
            } else {
                await user.makeRepayUC1_2(
                    this.collateralToken.address,
                    this.borrowToken.address,
                    user.address
                );
                if (this.params.controlGas) {
                    gasUsed = await user.estimateGas.makeRepayUC1_2(
                        this.collateralToken.address,
                        this.borrowToken.address,
                        user.address
                    );
                }
            }
        }

        if (this.params.countBlocksToSkipAfterAction) {
            await TimeUtils.advanceNBlocks(this.params.countBlocksToSkipAfterAction);
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