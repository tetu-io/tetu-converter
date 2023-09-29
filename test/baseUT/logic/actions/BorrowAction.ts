import {IBorrowAction} from "../../uses-cases/app/BorrowRepayUsesCase";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {BigNumber} from "ethers";
import {IUserBalancesWithGas} from "../../utils/BalanceUtils";
import {Borrower, IERC20__factory} from "../../../../typechain";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";

export class BorrowAction implements IBorrowAction {
  public collateralToken: TokenDataTypes;
  public collateralAmount: BigNumber;
  public borrowToken: TokenDataTypes;
  public countBlocksToSkipAfterAction?: number;

  constructor(
    collateralToken: TokenDataTypes,
    collateralAmount: BigNumber,
    borrowToken: TokenDataTypes,
    countBlocksToSkipAfterAction?: number,
  ) {
    this.collateralToken = collateralToken;
    this.collateralAmount = collateralAmount;
    this.borrowToken = borrowToken;
    this.countBlocksToSkipAfterAction = countBlocksToSkipAfterAction;
  }

  async doAction(user: Borrower) : Promise<IUserBalancesWithGas> {
    const tx = await user.borrowMaxAmount(
      "0x",
      this.collateralToken.address,
      this.collateralAmount,
      this.borrowToken.address,
      user.address
    );
    const cr = await tx.wait();
    const gasUsed = (await cr).gasUsed;

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