import {IRepayAction} from "../uses-cases/BorrowRepayUsesCase";
import {BigNumber} from "ethers";
import {IERC20__factory, Borrower, ConverterController, ITetuConverter__factory} from "../../../typechain";
import {IUserBalancesWithGas} from "../utils/BalanceUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {GAS_LIMIT} from "../GasLimit";

export interface IRepayActionOptionalParams {
  countBlocksToSkipAfterAction?: number,
}

export class RepayActionUsingSwap implements IRepayAction {
  public controller: ConverterController;
  public collateralToken: TokenDataTypes;
  public borrowToken: TokenDataTypes;
  public amountToRepay: BigNumber | undefined;
  public amountToKeepOnBorrowBalance: BigNumber;

  constructor(
    controller: ConverterController,
    collateralToken: TokenDataTypes,
    borrowToken: TokenDataTypes,
    amountToKeepOnBorrowBalance: BigNumber
  ) {
    this.collateralToken = collateralToken;
    this.borrowToken = borrowToken;
    this.controller = controller;
    this.amountToKeepOnBorrowBalance = amountToKeepOnBorrowBalance;
  }

  async doAction(user: Borrower) : Promise<IUserBalancesWithGas> {
    let gasUsed: BigNumber;

    const borrowBalance0 = await IERC20__factory.connect(
      this.borrowToken.address,
      await DeployerUtils.startImpersonate(user.address)
    ).balanceOf(user.address);

    const amountToPay = borrowBalance0.sub(this.amountToKeepOnBorrowBalance);

    await IERC20__factory.connect(
      this.borrowToken.address,
      await DeployerUtils.startImpersonate(user.address)
    ).transfer(await this.controller.tetuConverter(), amountToPay);

    const tx = await ITetuConverter__factory.connect(
      await this.controller.tetuConverter(),
      await DeployerUtils.startImpersonate(user.address)
    ).repay(this.collateralToken.address, this.borrowToken.address, amountToPay, user.address, {gasLimit: GAS_LIMIT});
    gasUsed = (await tx.wait()).gasUsed;

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
