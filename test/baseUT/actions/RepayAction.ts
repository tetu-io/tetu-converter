import {IRepayAction} from "../uses-cases/BorrowRepayUsesCase";
import {BigNumber} from "ethers";
import {IERC20__factory, Borrower} from "../../../typechain";
import {IUserBalances} from "../utils/BalanceUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {TokenDataTypes} from "../types/TokenDataTypes";

export interface IRepayActionOptionalParams {
  countBlocksToSkipAfterAction?: number,
  controlGas?: boolean;
  repayFirstPositionOnly?: boolean;
}

export class RepayAction implements IRepayAction {
  public collateralToken: TokenDataTypes;
  public borrowToken: TokenDataTypes;
  /** if undefined - repay all */
  public amountToRepay: BigNumber | undefined;
  public params: IRepayActionOptionalParams;

  constructor(
    collateralToken: TokenDataTypes,
    borrowToken: TokenDataTypes,
    amountToRepay: BigNumber | undefined,
    params: IRepayActionOptionalParams
  ) {
    this.collateralToken = collateralToken;
    this.borrowToken = borrowToken;
    this.amountToRepay = amountToRepay;
    this.params = params;
  }

  async doAction(user: Borrower) : Promise<IUserBalances> {
    let gasUsed: BigNumber | undefined;

    if (this.amountToRepay) {
      if (this.params.controlGas) {
        console.log("doAction.start makeRepayPartial");
        gasUsed = await user.estimateGas.makeRepayPartial(
          this.collateralToken.address,
          this.borrowToken.address,
          user.address,
          this.amountToRepay
        );
        console.log("doAction.end", gasUsed);
      }
      await user.makeRepayPartial(
        this.collateralToken.address,
        this.borrowToken.address,
        user.address,
        this.amountToRepay
      );
    } else {
      if (this.params.repayFirstPositionOnly) {
        if (this.params.controlGas) {
          console.log("doAction.start makeRepayComplete_firstPositionOnly");
          gasUsed = await user.estimateGas.makeRepayComplete_firstPositionOnly(
            this.collateralToken.address,
            this.borrowToken.address,
            user.address
          );
          console.log("doAction.end", gasUsed);
        }
        await user.makeRepayComplete_firstPositionOnly(
          this.collateralToken.address,
          this.borrowToken.address,
          user.address
        );
      } else {
        if (this.params.controlGas) {
          console.log("doAction.start makeRepayComplete");
          gasUsed = await user.estimateGas.makeRepayComplete(
            this.collateralToken.address,
            this.borrowToken.address,
            user.address
          );
          console.log("doAction.end", gasUsed);
        }
        await user.makeRepayComplete(
          this.collateralToken.address,
          this.borrowToken.address,
          user.address
        );
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