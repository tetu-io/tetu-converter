import {BigNumber} from "ethers";
import {Borrower} from "../../../../typechain";
import {IUserBalancesWithGas} from "../../utils/BalanceUtils";
import {RepayAction} from "./RepayAction";
import {TokenDataTypes} from "../../types/TokenDataTypes";

/** RepayAction + setPassedBlocks(count blocks) */
export class RepayMockAction extends RepayAction {
  private _mockAddress?: string;
  constructor(
    collateralToken: TokenDataTypes,
    borrowToken: TokenDataTypes,
    amountToRepay: BigNumber | undefined,
    countBlocksToSkipAfterAction?: number,
    mockAddress?: string
  ) {
    super(collateralToken, borrowToken, amountToRepay, {countBlocksToSkipAfterAction});
    this._mockAddress = mockAddress;
  }

  async doAction(user: Borrower) : Promise<IUserBalancesWithGas> {
    return super.doAction(user);

    // TODO
    // if (this.countBlocksToSkipAfterAction && this._mockAddress) {
    //     await PoolAdapterMock__factory.connect(this._mockAddress, ethers.Wallet.createRandom())
    //         .setPassedBlocks(this.countBlocksToSkipAfterAction);
    // }
  }
}