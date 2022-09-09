import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {BigNumber} from "ethers";
import {ILendingPlatformFabric} from "../fabrics/ILendingPlatformFabric";
import {TetuConverterApp} from "../helpers/TetuConverterApp";
import {MocksHelper} from "../helpers/MocksHelper";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {setInitialBalance} from "../utils/CommonUtils";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {ConfigurableAmountToBorrow} from "./aprDataTypes";

/**
 * Initialize tetu-converter-app.
 * Set initial collateral and borrow balances.
 * Make borrow using tetu-converter-app.
 * Return address of the pool adapter (borrower).
 */
export async function makeBorrow (
  deployer: SignerWithAddress,
  p: TestSingleBorrowParams,
  amountToBorrow: ConfigurableAmountToBorrow,
  fabric: ILendingPlatformFabric,
) : Promise<{
  poolAdapter: string,
  borrowAmount: BigNumber
}> {
  const {controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
  const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.healthFactor2, p.countBlocks);

  const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
  const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

  const c0 = await setInitialBalance(deployer, collateralToken.address
    , p.collateral.holders, p.collateral.initialLiquidity, uc.address);
  const b0 = await setInitialBalance(deployer, borrowToken.address
    , p.borrow.holders, p.borrow.initialLiquidity, uc.address);
  const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

  await uc.makeBorrowExactAmount(
    p.collateral.asset
    , collateralAmount
    , p.borrow.asset
    , uc.address
    , amountToBorrow.exact
    , amountToBorrow.exact ? amountToBorrow.exactAmountToBorrow : amountToBorrow.ratio18
  );

  const poolAdapters = await uc.getBorrows(p.collateral.asset, p.borrow.asset);
  return {
    poolAdapter: poolAdapters[0],
    borrowAmount: await uc.totalBorrowedAmount()
  };
}

export function convertUnits(
  amount: BigNumber,
  sourcePrice: BigNumber,
  sourceDecimals: number,
  destPrice: BigNumber,
  destDecimals: number
) : BigNumber {
  return amount.mul(getBigNumberFrom(1, destDecimals))
    .mul(sourcePrice)
    .div(destPrice)
    .div(getBigNumberFrom(1, sourceDecimals));
}

export interface IBaseToBorrowParams {
  baseCurrencyDecimals: number;
  priceDecimals: number;
  priceBaseCurrency: BigNumber;
}

/** Convert amount from base-currency to borrow tokens with decimals 18 */
export function baseToBorrow18(amount: BigNumber, params: IBaseToBorrowParams) : BigNumber {
  // amount-in-base-currency = a1 * 10^db
  // we need to convert a1 * 10^db to a2*10^18, where a2 is the price in borrow tokens (and we need decimals 18 in result)
  //
  //                a1 * 10^db   *  10^dp
  // a2*10^18 =    ----------      -----  * 10^18
  //                p * 10^dp       10^db
  //
  // db - decimals of the base currency
  // dp - decimals of the price
  console.log("baseToBorrow18", amount, params);

  return amount // == a1 * 10^db
    .mul(getBigNumberFrom(1, params.priceDecimals)) // == 10^dp
    .mul(getBigNumberFrom(1, 18)) // == 10^18
    .div(params.priceBaseCurrency) // == p * 10^dp
    .div(getBigNumberFrom(1, params.baseCurrencyDecimals))
    ;
}

export function changeDecimals(amount: BigNumber, from: number, to: number) : BigNumber {
  return amount.mul(getBigNumberFrom(1, to)).div(getBigNumberFrom(1, from));
}