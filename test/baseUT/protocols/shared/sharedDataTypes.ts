import {BigNumber} from "ethers";
import {TokenDataTypes} from "../../types/TokenDataTypes";

export interface IAmountToRepay {
  useCollateral: boolean;
  amountCollateralAsset: BigNumber;
  amountBorrowAsset: BigNumber;
}

export interface IMakeRepayRebalanceBadPathParams {
  makeRepayToRebalanceAsDeployer?: boolean;
  skipBorrow?: boolean;
  additionalAmountCorrectionFactorMul?: number;
  additionalAmountCorrectionFactorDiv?: number;
  repayBorrowFails?: boolean;

  useAavePoolMock?: boolean;
  /**
   * After call of repay() get current user status, save it and add given value to the saved health factor.
   * So, next call of the status will return modified health factor.
   */
  addToHealthFactorAfterRepay?: string;

  /**
   * Don't modify health factor after borrow.
   * As result, we call repayRebalance in valid state (health factor is already ok)
   */
  skipHealthFactors2?: boolean;
}

export interface IMakeRepayToRebalanceInputParams {
  collateralToken: TokenDataTypes;
  collateralHolder: string;
  collateralAmount: BigNumber;
  borrowToken: TokenDataTypes;
  borrowHolder: string;
  useCollateralAssetToRepay: boolean;
  badPathsParams?: IMakeRepayRebalanceBadPathParams;
}

export interface IMakeRepayToRebalanceInputParamsWithCTokens extends IMakeRepayToRebalanceInputParams{
  collateralCTokenAddress: string;
  borrowCTokenAddress: string;
}

export interface IAssetsInputParams {
  collateralAsset: string;
  collateralHolder: string;
  borrowAsset: string;
  borrowHolder: string;
  collateralAmountStr: string;
}

export interface IAssetsInputParamsWithCTokens extends IAssetsInputParams {
  collateralCTokenAddress: string;
  borrowCTokenAddress: string;
}