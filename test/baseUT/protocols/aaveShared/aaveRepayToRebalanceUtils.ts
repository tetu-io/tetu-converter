import {BigNumber} from "ethers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {toStringWithRound} from "../../utils/CommonUtils";
import {Borrower, IERC20__factory} from "../../../../typechain";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {
  IAmountToRepay,
  IAssetsInputParams,
  IMakeRepayRebalanceBadPathParams,
  IMakeRepayToRebalanceInputParams
} from "../shared/sharedDataTypes";

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
  userAccountBorrowBalanceAfterBorrow: BigNumber;
  userAccountBorrowBalanceAfterRepayToRebalance: BigNumber;
  userAccountCollateralBalanceAfterBorrow: BigNumber;
  userAccountCollateralBalanceAfterRepayToRebalance: BigNumber;
  expectedBorrowAssetAmountToRepay: BigNumber;
  expectedCollateralAssetAmountToRepay: BigNumber;
}

/**
 * A function to make borrow, increase health factor and make repay with rebalance.
 * Implementations depend on the version of AAVE protocol,
 */
type MakeRepayToRebalanceFunc = (p: IMakeRepayToRebalanceInputParams) => Promise<IMakeRepayToRebalanceResults>;

/**
 * Common implementation of
 *      repayToRebalance-test
 * for both AAVE protocols
 * for different asset pairs.
 */
export class AaveRepayToRebalanceUtils {

  static async makeRepayToRebalanceTest(
    assets: IAssetsInputParams,
    deployer: SignerWithAddress,
    makeRepayToRebalanceFunc: MakeRepayToRebalanceFunc,
    targetHealthFactorInitial2: number,
    targetHealthFactorUpdated2: number,
    useCollateralAssetToRepay: boolean,
    badPathsParams?: IMakeRepayRebalanceBadPathParams
  ) : Promise<{ret: string, expected: string}> {

    const collateralToken = await TokenDataTypes.Build(deployer, assets.collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, assets.borrowAsset);
    console.log("collateralToken.decimals", collateralToken.decimals);
    console.log("borrowToken.decimals", borrowToken.decimals);

    const collateralAmount = getBigNumberFrom(assets.collateralAmountNum, collateralToken.decimals);
    console.log(collateralAmount, collateralAmount);

    const r = await makeRepayToRebalanceFunc({
      collateralToken,
      collateralHolder: assets.collateralHolder,
      collateralAmount,
      borrowToken,
      borrowHolder: assets.borrowHolder,
      badPathsParams,
      useCollateralAssetToRepay
    });

    console.log(r);

    const ret = [
      Math.round(r.afterBorrow.healthFactor.div(
        getBigNumberFrom(1, 15)).toNumber() / 10.
      ),
      Math.round(r.afterBorrowToRebalance.healthFactor.div(
        getBigNumberFrom(1, 15)).toNumber() / 10.
      ),
      r.userAccountBorrowBalanceAfterRepayToRebalance
        .div(getBigNumberFrom(1, borrowToken.decimals)),
      r.userAccountCollateralBalanceAfterRepayToRebalance
        .div(getBigNumberFrom(1, collateralToken.decimals))
    ].join("\n");
    const expected = [
      targetHealthFactorInitial2,
      targetHealthFactorUpdated2,
      r.userAccountBorrowBalanceAfterBorrow
        .sub(r.expectedBorrowAssetAmountToRepay)
        .div(getBigNumberFrom(1, borrowToken.decimals)),
      r.userAccountCollateralBalanceAfterBorrow
        .add(r.expectedCollateralAssetAmountToRepay)
        .div(getBigNumberFrom(1, collateralToken.decimals))
    ].join("\n");
    console.log("ret", ret);
    console.log("expected", expected);

    return {ret, expected};
  }

  static async daiWMatic(
    deployer: SignerWithAddress,
    makeRepayToRebalanceFunc: MakeRepayToRebalanceFunc,
    targetHealthFactorInitial2: number,
    targetHealthFactorUpdated2: number,
    useCollateralAssetToRepay: boolean,
    badPathParams?: IMakeRepayRebalanceBadPathParams
  ) : Promise<{ret: string, expected: string}> {
    const collateralAsset = MaticAddresses.DAI;
    const collateralHolder = MaticAddresses.HOLDER_DAI;
    const borrowAsset = MaticAddresses.WMATIC;
    const borrowHolder = MaticAddresses.HOLDER_WMATIC;

    return  this.makeRepayToRebalanceTest(
      {
        collateralAsset,
        borrowAsset,
        borrowHolder,
        collateralHolder,
        collateralAmountNum: 100_000,
      },
      deployer,
      makeRepayToRebalanceFunc,
      targetHealthFactorInitial2,
      targetHealthFactorUpdated2,
      useCollateralAssetToRepay,
      badPathParams
    );
  }

  static async usdcUsdt(
    deployer: SignerWithAddress,
    makeRepayToRebalanceFunc: MakeRepayToRebalanceFunc,
    targetHealthFactorInitial2: number,
    targetHealthFactorUpdated2: number,
    useCollateralAssetToRepay: boolean,
    badPathsParams?: IMakeRepayRebalanceBadPathParams
  ) : Promise<{ret: string, expected: string}> {
    const collateralAsset = MaticAddresses.USDC;
    const collateralHolder = MaticAddresses.HOLDER_USDC;
    const borrowAsset = MaticAddresses.USDT;
    const borrowHolder = MaticAddresses.HOLDER_USDT;

    return  this.makeRepayToRebalanceTest(
      {
        collateralAsset,
        borrowAsset,
        borrowHolder,
        collateralHolder,
        collateralAmountNum: 100_000,
      },
      deployer,
      makeRepayToRebalanceFunc,
      targetHealthFactorInitial2,
      targetHealthFactorUpdated2,
      useCollateralAssetToRepay,
      badPathsParams
    );
  }
}