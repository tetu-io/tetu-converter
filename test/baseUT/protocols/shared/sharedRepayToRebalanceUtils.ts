import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {Borrower, IERC20__factory} from "../../../../typechain";
import {
  IAmountToRepay,
  IMakeRepayToRebalanceInputParams,
} from "./sharedDataTypes";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {transferAndApprove} from "../../utils/transferUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";


export class SharedRepayToRebalanceUtils {

  static async prepareAmountsToRepayToRebalance(
    deployer: SignerWithAddress,
    amountToBorrow: BigNumber,
    collateralAmount: BigNumber,
    userContract: Borrower,
    p: IMakeRepayToRebalanceInputParams
  ) : Promise<IAmountToRepay> {
    let expectedBorrowAssetAmountToRepay = amountToBorrow.div(2); // health factor was increased twice
    let expectedCollateralAssetAmountToRepay = collateralAmount;

    if (p.badPathsParams?.additionalAmountCorrectionFactorMul) {
      expectedBorrowAssetAmountToRepay = expectedBorrowAssetAmountToRepay.mul(
        p.badPathsParams.additionalAmountCorrectionFactorMul
      );
      expectedCollateralAssetAmountToRepay = expectedCollateralAssetAmountToRepay.mul(
        p.badPathsParams.additionalAmountCorrectionFactorMul
      );
    }

    if (p.badPathsParams?.additionalAmountCorrectionFactorDiv) {
      expectedBorrowAssetAmountToRepay = expectedBorrowAssetAmountToRepay.div(
        p.badPathsParams.additionalAmountCorrectionFactorDiv
      );
      expectedCollateralAssetAmountToRepay = expectedCollateralAssetAmountToRepay.div(
        p.badPathsParams.additionalAmountCorrectionFactorDiv
      );
    }

    if (p.badPathsParams) {
      // we try to repay too much in bad-paths-test, so we need to give additional borrow asset to user
      const userBorrowAssetBalance = await IERC20__factory.connect(p.borrowToken.address, deployer)
        .balanceOf(userContract.address);
      if (userBorrowAssetBalance.lt(expectedBorrowAssetAmountToRepay)) {
        await TokenUtils.getToken(p.borrowToken.address, userContract.address, expectedBorrowAssetAmountToRepay.sub(userBorrowAssetBalance));
      }
    }

    // put required amount of collateral on user's balance
    if (p.useCollateralAssetToRepay) {
      const userCollateralAssetBalance = await IERC20__factory.connect(p.collateralToken.address, deployer)
        .balanceOf(userContract.address);
      if (userCollateralAssetBalance.lt(expectedCollateralAssetAmountToRepay)) {
        await TokenUtils.getToken(p.collateralToken.address, userContract.address, expectedCollateralAssetAmountToRepay.sub(userCollateralAssetBalance));
      }
    }

    return {
      useCollateral: p.useCollateralAssetToRepay,
      amountBorrowAsset: expectedBorrowAssetAmountToRepay,
      amountCollateralAsset: expectedCollateralAssetAmountToRepay
    }
  }

  static async approveAmountToRepayToUserContract(
    poolAdapterAddress: string,
    collateralAsset: string,
    borrowAsset: string,
    amountsToRepay: IAmountToRepay,
    userContractAddress: string,
    tetuConverter: string
  ) {
    if (amountsToRepay.useCollateral) {
      await transferAndApprove(
        collateralAsset,
        userContractAddress,
        tetuConverter,
        amountsToRepay.amountCollateralAsset,
        poolAdapterAddress
      );
    } else {
      await transferAndApprove(
        borrowAsset,
        userContractAddress,
        tetuConverter,
        amountsToRepay.amountBorrowAsset,
        poolAdapterAddress
      );
    }
  }


}