//region Making borrow impl
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {BigNumber} from "ethers";
import {ILendingPlatformFabric} from "../fabrics/ILendingPlatformFabric";
import {TetuConverterApp} from "../helpers/TetuConverterApp";
import {MocksHelper} from "../helpers/MocksHelper";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {setInitialBalance} from "../utils/CommonUtils";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";

/**
 * Initialize tetu-converter-app.
 * Set initial collateral and borrow balances.
 * Make borrow using tetu-converter-app.
 * Return address of the pool adapter (borrower).
 */
export async function makeBorrow (
  deployer: SignerWithAddress,
  p: TestSingleBorrowParams,
  amountToBorrow: BigNumber,
  fabric: ILendingPlatformFabric,
) : Promise<string> {
  const {controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
  const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.healthFactor2, p.countBlocks);

  const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
  const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

  const c0 = await setInitialBalance(deployer, collateralToken.address
    , p.collateral.holder, p.collateral.initialLiquidity, uc.address);
  const b0 = await setInitialBalance(deployer, borrowToken.address
    , p.borrow.holder, p.borrow.initialLiquidity, uc.address);
  const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

  await uc.makeBorrowExactAmount(p.collateral.asset, collateralAmount, p.borrow.asset, uc.address, amountToBorrow);

  const poolAdapters = await uc.getBorrows(p.collateral.asset, p.borrow.asset);
  return poolAdapters[0];
}

export function convertUnits(
  amount: BigNumber,
  sourceToken: TokenDataTypes,
  sourcePrice: BigNumber,
  destToken: TokenDataTypes,
  destPrice: BigNumber
) : BigNumber {
  return amount.mul(getBigNumberFrom(1, destToken.decimals))
    .mul(sourcePrice)
    .div(destPrice)
    .div(getBigNumberFrom(1, sourceToken.decimals));
}
