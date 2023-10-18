import {IPoolAdapterStatusNum} from "../../types/BorrowRepayDataTypes";
import {ITetuConverter} from "../../../../typechain";
import {BigNumber} from "ethers";
import {IConversionPlanNum} from "../../types/AppDataTypes";

interface IBorrowRepaySetup {
  tetuConverter: ITetuConverter;
  collateralAsset: string;
  borrowAsset: string;
  collateralAssetHolder: string;
  borrowAssetHolder: string;
  userBorrowAssetBalance: string;
  userCollateralAssetBalance: string;
}

interface IBorrowRepayCommandParams {
  /** set up min health factor to the given value before the borrow */
  healthFactorMin?: string;
  /** set up target health factor to the given value before the borrow */
  healthFactorTarget?: string;
  /** undefined - no borrow on this step */
  borrowAmount?: string;
  /** 100_000 = 100%, undefined - no repay on this step*/
  repayPart: number;
  /** Count blocks between borrow and repay, 0 by default */
  countBlocksAfterBorrow?: number;
  /** Count blocks after repay, 0 by default */
  countBlocksAfterRepay?: number;
}

interface IBorrowResults {
  /** Status of the first (single available) pool adapter after borrow */
  statusAfterBorrow: IPoolAdapterStatusNum;
  gasUsedByBorrow: BigNumber;
  plan: IConversionPlanNum;
}

interface IRepayResults {
  /** Status of the first (single available) pool adapter after repay */
  statusAfterRepay: IPoolAdapterStatusNum;
  gasUsedByRepay: BigNumber;
}

interface IBorrowRepayCommandResults {
  borrowResults?: IBorrowResults;
  repayResults?: IRepayResults;

  /** User balance of the collateral asset after repay */
  userCollateralAssetBalance: string;
  /** User balance of the borrow asset after repay */
  userBorrowAssetBalance: string;
}

export class BorrowRepayCases {
  static async borrowRepay(p: IBorrowRepaySetup, commands: IBorrowRepayCommandParams[]): Promise<IBorrowRepayCommandResults[]> {
    const dest: IBorrowRepayCommandResults[] = [];
    for (const command of commands) {
      // setup health factors

      // make borrow

      // move time

      // make repay

      // move time
    }

    return dest;
  }
}