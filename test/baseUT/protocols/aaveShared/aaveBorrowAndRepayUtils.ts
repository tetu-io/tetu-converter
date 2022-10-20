import {BalanceUtils, IUserBalances} from "../../utils/BalanceUtils";
import {BigNumber} from "ethers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {IPoolAdapter__factory} from "../../../../typechain";
import {areAlmostEqual} from "../../utils/CommonUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export interface IMakeBorrowAndRepayResults {
  userBalancesBeforeBorrow: IUserBalances;
  userBalancesAfterBorrow: IUserBalances;
  userBalancesAfterRepay: IUserBalances;
  paATokensBalance: BigNumber;
  totalCollateralBase: BigNumber;
  totalDebtBase: BigNumber;
  poolAdapter: string;
}

/**
 * A function to make borrow and then full/partial repay.
 * Implementations depend on the version of AAVE protocol,
 */
type MakeBorrowAndRepayFunc = (
  collateralToken: TokenDataTypes,
  collateralHolder: string,
  collateralAmount: BigNumber,
  borrowToken: TokenDataTypes,
  borrowHolder: string,
  borrowAmount: BigNumber,
  amountToRepay?: BigNumber,
  initialBorrowAmountOnUserBalance?: BigNumber,
) => Promise<IMakeBorrowAndRepayResults>;

/**
 * Repay-tests for both AAVE.
 * The difference is only in the repay-function,
 * but wrapped code is the similar
 */
export class AaveMakeBorrowAndRepayUtils {
  static async daiWmatic(
    deployer: SignerWithAddress,
    funcMakeBorrowAndRepay: MakeBorrowAndRepayFunc,
    fullRepay: boolean,
    initialBorrowAmountOnUserBalanceNumber?: number
  ) : Promise<{ret: string, expected: string}> {
    const collateralAsset = MaticAddresses.DAI;
    const collateralHolder = MaticAddresses.HOLDER_DAI;
    const borrowAsset = MaticAddresses.WMATIC;
    const borrowHolder = MaticAddresses.HOLDER_WMATIC;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
    const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

    const initialBorrowAmountOnUserBalance = getBigNumberFrom(
      initialBorrowAmountOnUserBalanceNumber || 0,
      borrowToken.decimals
    );
    const r = await funcMakeBorrowAndRepay(
      collateralToken,
      collateralHolder,
      collateralAmount,
      borrowToken,
      borrowHolder,
      borrowAmount,
      fullRepay ? undefined : borrowAmount, // amount to repay
      initialBorrowAmountOnUserBalance
    );
    console.log(r);
    console.log(collateralAmount);

    const statusAfterRepay = await IPoolAdapter__factory.connect(r.poolAdapter, deployer).getStatus();

    const ret = [
      r.userBalancesBeforeBorrow.collateral, r.userBalancesBeforeBorrow.borrow,
      r.userBalancesAfterBorrow.collateral, r.userBalancesAfterBorrow.borrow,

      // original collateral ~ returned collateral
      areAlmostEqual(collateralAmount, r.userBalancesAfterRepay.collateral, 5),
      areAlmostEqual(r.userBalancesAfterRepay.borrow, initialBorrowAmountOnUserBalance, 5),
      statusAfterRepay.opened
    ].map(x => BalanceUtils.toString(x)).join("\n");

    const expected = [
      collateralAmount, initialBorrowAmountOnUserBalance,
      0, borrowAmount.add(initialBorrowAmountOnUserBalance),

      true, // original collateral ~ returned collateral
      true,

      !fullRepay // the position is closed after full repaying
    ].map(x => BalanceUtils.toString(x)).join("\n");

    return {ret, expected};
  }

  static async wmaticDai(
    deployer: SignerWithAddress,
    funcMakeBorrowAndRepay: MakeBorrowAndRepayFunc,
    fullRepay: boolean,
    initialBorrowAmountOnUserBalanceNumber?: number
  ) : Promise<{ret: string, expected: string}> {
    const collateralAsset = MaticAddresses.WMATIC;
    const collateralHolder = MaticAddresses.HOLDER_WMATIC;
    const borrowAsset = MaticAddresses.DAI;
    const borrowHolder = MaticAddresses.HOLDER_DAI;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
    const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

    const initialBorrowAmountOnUserBalance = getBigNumberFrom(
      initialBorrowAmountOnUserBalanceNumber || 0,
      borrowToken.decimals
    );

    const r = await funcMakeBorrowAndRepay(
      collateralToken,
      collateralHolder,
      collateralAmount,
      borrowToken,
      borrowHolder,
      borrowAmount,
      fullRepay ? undefined : borrowAmount, // amount to repay
      initialBorrowAmountOnUserBalance,
    );
    console.log(r);
    console.log(collateralAmount);

    const statusAfterRepay = await IPoolAdapter__factory.connect(r.poolAdapter, deployer).getStatus();

    const ret = [
      r.userBalancesBeforeBorrow.collateral, r.userBalancesBeforeBorrow.borrow,
      r.userBalancesAfterBorrow.collateral, r.userBalancesAfterBorrow.borrow,

      // original collateral ~ returned collateral
      areAlmostEqual(collateralAmount, r.userBalancesAfterRepay.collateral, 5),
      areAlmostEqual(r.userBalancesAfterRepay.borrow, initialBorrowAmountOnUserBalance, 5),
      statusAfterRepay.opened
    ].map(x => BalanceUtils.toString(x)).join("\n");

    const expected = [
      collateralAmount, initialBorrowAmountOnUserBalance,
      0, borrowAmount.add(initialBorrowAmountOnUserBalance),

      true, // original collateral ~ returned collateral
      true,

      !fullRepay // the position is closed after full repaying
    ].map(x => BalanceUtils.toString(x)).join("\n");

    return {ret, expected};
  }

  // we can add tests for any other asset pairs here
}