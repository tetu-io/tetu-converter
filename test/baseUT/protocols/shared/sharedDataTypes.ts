import {BigNumber} from "ethers";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {HfComptrollerMock} from "../../../../typechain";

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
  useHfComptrollerMock?: HfComptrollerMock;
  repayBorrowFails?: boolean;
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