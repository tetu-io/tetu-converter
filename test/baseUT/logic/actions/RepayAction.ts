import {IRepayAction} from "../../uses-cases/app/BorrowRepayUsesCase";
import {BigNumber} from "ethers";
import {IERC20__factory, Borrower} from "../../../../typechain";
import {IUserBalancesWithGas} from "../../utils/BalanceUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {TokenDataTypes} from "../../types/TokenDataTypes";

export interface IRepayActionOptionalParams {
  countBlocksToSkipAfterAction?: number,
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

  async doAction(user: Borrower) : Promise<IUserBalancesWithGas> {
    let gasUsed: BigNumber;

    if (this.amountToRepay) {
      const tx = await user.makeRepayPartial(
        this.collateralToken.address,
        this.borrowToken.address,
        user.address,
        this.amountToRepay
      );
      gasUsed = (await tx.wait()).gasUsed;
    } else {
      if (this.params.repayFirstPositionOnly) {
        const tx = await user.makeRepayComplete_firstPositionOnly(
          this.collateralToken.address,
          this.borrowToken.address,
          user.address
        );
        gasUsed = (await tx.wait()).gasUsed;
      } else {
        const tx = await user.makeRepayComplete(
          this.collateralToken.address,
          this.borrowToken.address,
          user.address
        );
        gasUsed = (await tx.wait()).gasUsed;
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