import {BigNumber} from "ethers";
import {IUserAccountDataResults} from "./aaveRepayToRebalanceUtils";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {toStringWithRound} from "../../utils/CommonUtils";

export interface IMakeBorrowToRebalanceResults {
  afterBorrow: IUserAccountDataResults;
  afterBorrowToRebalance: IUserAccountDataResults;
  userBalanceAfterBorrow: BigNumber;
  userBalanceAfterBorrowToRebalance: BigNumber;
  expectedAdditionalBorrowAmount: BigNumber;
}

export interface IMakeBorrowToRebalanceBadPathParams {
  makeBorrowToRebalanceAsDeployer?: boolean;
  skipBorrow?: boolean;
  additionalAmountCorrectionFactor?: number;
  useAavePoolMock?: boolean;
  aavePoolMockSkipsBorrowInBorrowToRebalance?: boolean;
}

type MakeBorrowToRebalanceFunc = (
  collateralToken: TokenDataTypes,
  collateralHolder: string,
  collateralAmount: BigNumber,
  borrowToken: TokenDataTypes,
  borrowHolder: string,
  badPathsParams?: IMakeBorrowToRebalanceBadPathParams
) => Promise<IMakeBorrowToRebalanceResults>;

export class AaveBorrowToRebalanceUtils {
  static async testDaiWMatic(
    deployer: SignerWithAddress,
    makeBorrowToRebalanceFunc: MakeBorrowToRebalanceFunc,
    targetHealthFactorInitial2: number,
    targetHealthFactorUpdated2: number,
    badPathParams?: IMakeBorrowToRebalanceBadPathParams
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

    const r = await makeBorrowToRebalanceFunc(
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
      toStringWithRound(r.userBalanceAfterBorrow, 18),
      toStringWithRound(r.userBalanceAfterBorrowToRebalance, 18),
    ].join();
    const expected = [
      targetHealthFactorInitial2,
      targetHealthFactorUpdated2,
      toStringWithRound(r.expectedAdditionalBorrowAmount, 18),
      toStringWithRound(r.expectedAdditionalBorrowAmount.mul(2), 18),
    ].join();

    return {ret, expected};
  }
}