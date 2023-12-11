import {BalanceUtils, IUserBalances} from "../../utils/BalanceUtils";
import {BigNumber} from "ethers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {IPoolAdapter__factory} from "../../../../typechain";
import {areAlmostEqual} from "../../utils/CommonUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {parseUnits} from "ethers/lib/utils";

export interface IMakeBorrowAndRepayResults {
  userBalancesBeforeBorrow: IUserBalances;
  userBalancesAfterBorrow: IUserBalances;
  userBalancesAfterRepay: IUserBalances;
  paATokensBalance: BigNumber;
  totalCollateralBase: BigNumber;
  totalDebtBase: BigNumber;
  poolAdapter: string;
  /* Actually borrowed amount */
  borrowAmount: BigNumber;
  /* Actual collateral amount*/
  collateralAmount: BigNumber;
}

/**
 * Allow to emulate various bad-paths-problems for repay()
 */
export interface IBorrowAndRepayBadParams {
  /**
   * Try to make repay without borrowing
   */
  skipBorrow?: boolean;

  /**
   * What amount of borrow asset should be transferred to pool adapter's balance
   * before calling of repay().
   * We can emulate following problems:
   *    Try to transfer an amount LARGER than amount-to-pay - should revert
   *    Try to transfer an amount less than amount-to-pay - should revert
   */
  wrongAmountToRepayToTransfer?: BigNumber;

  forceToClosePosition?: boolean;

  repayAsNotUserAndNotTC?: boolean;

  comets?: string[];
  cometRewards?: string;
}

/**
 * A function to make borrow and then full/partial repay.
 * Implementations depend on the version of AAVE protocol,
 */
type MakeBorrowAndRepayFunc = (
  collateralToken: TokenDataTypes,
  collateralAmountRequired: BigNumber,
  borrowToken: TokenDataTypes,
  borrowAmount: BigNumber | undefined,
  amountToRepay?: BigNumber | undefined,
  initialBorrowAmountOnUserBalance?: BigNumber,
  badParams?: IBorrowAndRepayBadParams
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
    useMaxAvailableCollateral: boolean,
    initialBorrowAmountOnUserBalanceNumber?: number,
    badParams?: IBorrowAndRepayBadParams
  ) : Promise<{ret: string, expected: string}> {
    const collateralAsset = MaticAddresses.DAI;
    const borrowAsset = MaticAddresses.WMATIC;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = useMaxAvailableCollateral
      ? parseUnits("10000000", collateralToken.decimals) // huge amount <= max available collateral; TODO: auto calculate
      : parseUnits("100000", collateralToken.decimals);
    const borrowAmount = useMaxAvailableCollateral
      ? undefined
      : parseUnits("10", borrowToken.decimals);

    const initialBorrowAmountOnUserBalance = parseUnits((initialBorrowAmountOnUserBalanceNumber || 0).toString(), borrowToken.decimals);
    const r = await funcMakeBorrowAndRepay(
      collateralToken,
      collateralAmount,
      borrowToken,
      borrowAmount,
      fullRepay ? undefined : borrowAmount, // amount to repay
      initialBorrowAmountOnUserBalance,
      badParams
    );
    console.log(r);
    console.log(collateralAmount);

    const statusAfterRepay = await IPoolAdapter__factory.connect(r.poolAdapter, deployer).getStatus();

    const ret = [
      r.userBalancesBeforeBorrow.collateral, r.userBalancesBeforeBorrow.borrow,
      r.userBalancesAfterBorrow.collateral, r.userBalancesAfterBorrow.borrow,

      // original collateral ~ returned collateral
      areAlmostEqual(r.collateralAmount, r.userBalancesAfterRepay.collateral, 5),
      // borrow asset balance ~ initial borrow asset balance
      areAlmostEqual(r.userBalancesAfterRepay.borrow, initialBorrowAmountOnUserBalance, 1),
      statusAfterRepay.opened
    ].map(x => BalanceUtils.toString(x)).join("\n");

    const expected = [
      r.collateralAmount, initialBorrowAmountOnUserBalance,
      0, r.borrowAmount.add(initialBorrowAmountOnUserBalance),

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
    useMaxAvailableCollateral: boolean,
    initialBorrowAmountOnUserBalanceNumber?: number,
    badParams?: IBorrowAndRepayBadParams
  ) : Promise<{ret: string, expected: string}> {
    const collateralAsset = MaticAddresses.WMATIC;
    const borrowAsset = MaticAddresses.DAI;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = useMaxAvailableCollateral
      ? parseUnits("10000000", collateralToken.decimals) // // huge amount <= max available collateral; TODO: auto calculate
      : parseUnits("1000", collateralToken.decimals);
    const borrowAmount = useMaxAvailableCollateral
      ? undefined
      : parseUnits("10", borrowToken.decimals);

    const initialBorrowAmountOnUserBalance = getBigNumberFrom(
      initialBorrowAmountOnUserBalanceNumber || 0,
      borrowToken.decimals
    );

    const r = await funcMakeBorrowAndRepay(
      collateralToken,
      collateralAmount,
      borrowToken,
      borrowAmount,
      fullRepay ? undefined : borrowAmount, // amount to repay
      initialBorrowAmountOnUserBalance,
      badParams,
    );
    console.log(r);
    console.log(collateralAmount);

    const statusAfterRepay = await IPoolAdapter__factory.connect(r.poolAdapter, deployer).getStatus();

    const ret = [
      r.userBalancesBeforeBorrow.collateral, r.userBalancesBeforeBorrow.borrow,
      r.userBalancesAfterBorrow.collateral, r.userBalancesAfterBorrow.borrow,

      // original collateral ~ returned collateral
      areAlmostEqual(r.collateralAmount, r.userBalancesAfterRepay.collateral, 5),
      areAlmostEqual(r.userBalancesAfterRepay.borrow, initialBorrowAmountOnUserBalance, 5),
      statusAfterRepay.opened
    ].map(x => BalanceUtils.toString(x)).join("\n");

    const expected = [
      r.collateralAmount, initialBorrowAmountOnUserBalance,
      0, r.borrowAmount.add(initialBorrowAmountOnUserBalance),

      true, // original collateral ~ returned collateral
      true,

      !fullRepay // the position is closed after full repaying
    ].map(x => BalanceUtils.toString(x)).join("\n");

    return {ret, expected};
  }

  // we can add tests for any other asset pairs here
}