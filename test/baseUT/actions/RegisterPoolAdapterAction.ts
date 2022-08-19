import {IBorrowAction} from "../uses-cases/BorrowRepayUsesCase";
import {IERC20__factory, Borrower} from "../../../typechain";
import {IUserBalances} from "../utils/BalanceUtils";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {TokenDataTypes} from "../types/TokenDataTypes";

export class RegisterPoolAdapterAction implements IBorrowAction {
  public collateralToken: TokenDataTypes;
  public collateralAmount: BigNumber;
  public borrowToken: TokenDataTypes;
  public controlGas?: boolean;

  constructor(
    collateralToken: TokenDataTypes,
    collateralAmount: BigNumber,
    borrowToken: TokenDataTypes,
    controlGas?: boolean
  ) {
    this.collateralToken = collateralToken;
    this.collateralAmount = collateralAmount;
    this.borrowToken = borrowToken;
    this.controlGas = controlGas;
  }

  async doAction(user: Borrower) : Promise<IUserBalances> {
    let gasUsed: BigNumber | undefined;

    if (this.controlGas) {
      console.log("doAction.start preInitializePoolAdapter");
      gasUsed = await user.estimateGas.preInitializePoolAdapter(
        this.collateralToken.address,
        this.collateralAmount,
        this.borrowToken.address,
        user.address
      );
      console.log("doAction.end", gasUsed);
    }
    await user.preInitializePoolAdapter(
      this.collateralToken.address,
      this.collateralAmount,
      this.borrowToken.address,
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

    return { collateral, borrow, gasUsed };
  }
}