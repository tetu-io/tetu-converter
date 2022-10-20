import {BigNumber} from "ethers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {toStringWithRound} from "../../utils/CommonUtils";

/**
 * Unification for both
 *    IAave3UserAccountDataResults
 *    IAaveTwoUserAccountDataResults
 */
export interface IUserAccountDataResults {
  totalCollateralBase: BigNumber;
  totalDebtBase: BigNumber;
  availableBorrowsBase: BigNumber;
  currentLiquidationThreshold: BigNumber;
  ltv: BigNumber;
  healthFactor: BigNumber;
}

export interface IMakeRepayToRebalanceResults {
  afterBorrow: IUserAccountDataResults;
  afterBorrowToRebalance: IUserAccountDataResults;
  userBalanceAfterBorrow: BigNumber;
  userBalanceAfterRepayToRebalance: BigNumber;
  expectedAmountToRepay: BigNumber;
}

export interface IMakeRepayRebalanceBadPathParams {
  makeRepayToRebalanceAsDeployer?: boolean;
  skipBorrow?: boolean;
  additionalAmountCorrectionFactorMul?: number;
  additionalAmountCorrectionFactorDiv?: number;
}

/**
 * A function to make borrow, increase health factor and make repay with rebalance.
 * Implementations depend on the version of AAVE protocol,
 */
type MakeRepayToRebalanceFunc = (
  collateralToken: TokenDataTypes,
  collateralHolder: string,
  collateralAmount: BigNumber,
  borrowToken: TokenDataTypes,
  borrowHolder: string,
  badPathsParams?: IMakeRepayRebalanceBadPathParams
) => Promise<IMakeRepayToRebalanceResults>;

/**
 * Common implementation of
 *      repayToRebalance-test
 * for both AAVE protocols
 * for different asset pairs.
 */
export class AaveRepayToRebalanceUtils {
  static async daiWMatic(
    deployer: SignerWithAddress,
    makeRepayToRebalanceFunc: MakeRepayToRebalanceFunc,
    targetHealthFactorInitial2: number,
    targetHealthFactorUpdated2: number,
    badPathParams?: IMakeRepayRebalanceBadPathParams
  ) : Promise<{ret: string, expected: string}> {
    const collateralAsset = MaticAddresses.DAI;
    const collateralHolder = MaticAddresses.HOLDER_DAI;
    const borrowAsset = MaticAddresses.WMATIC;
    const borrowHolder = MaticAddresses.HOLDER_WMATIC;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
    console.log("collateralToken.decimals", collateralToken.decimals);
    console.log("borrowToken.decimals", borrowToken.decimals);

    const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
    console.log(collateralAmount, collateralAmount);

    const r = await makeRepayToRebalanceFunc(
      collateralToken
      , collateralHolder
      , collateralAmount
      , borrowToken
      , borrowHolder
      , badPathParams
    );

    console.log(r);

    const ret = [
      Math.round(r.afterBorrow.healthFactor.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
      Math.round(r.afterBorrowToRebalance.healthFactor.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
      toStringWithRound(r.userBalanceAfterBorrow),
      toStringWithRound(r.userBalanceAfterRepayToRebalance),
    ].join("\n");
    const expected = [
      targetHealthFactorInitial2,
      targetHealthFactorUpdated2,
      toStringWithRound(r.expectedAmountToRepay.mul(2)),
      toStringWithRound(r.expectedAmountToRepay),
    ].join("\n");

    return {ret, expected};
  }


}