import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {BigNumber} from "ethers";
import {ILendingPlatformFabric} from "../fabrics/ILendingPlatformFabric";
import {TetuConverterApp} from "../helpers/TetuConverterApp";
import {MocksHelper} from "../helpers/MocksHelper";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {setInitialBalance} from "../utils/CommonUtils";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {ConfigurableAmountToBorrow} from "./ConfigurableAmountToBorrow";
import {existsSync, writeFileSync} from "fs";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {IBorrowTestResults} from "../uses-cases/CompareAprUsesCase";

//region Make borrow
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
  console.log("makeBorrow:", p, amountToBorrow);
  const {controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
  const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.healthFactor2, p.countBlocks);

  const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
  const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

  const c0 = await setInitialBalance(deployer, collateralToken.address
    , p.collateral.holder, p.collateral.initialLiquidity, uc.address);
  const b0 = await setInitialBalance(deployer, borrowToken.address
    , p.borrow.holder, p.borrow.initialLiquidity, uc.address);
  const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

  await uc.makeBorrowExactAmount(
    p.collateral.asset
    , collateralAmount
    , p.borrow.asset
    , uc.address
    , amountToBorrow.exact
    , ConfigurableAmountToBorrow.getValue(amountToBorrow, borrowToken.decimals)
  );
  console.log("Borrow is done, borrowed amount is", await uc.totalBorrowedAmount());

  const poolAdapters = await uc.getBorrows(p.collateral.asset, p.borrow.asset);
  console.log("Pool adapter is", poolAdapters[0]);
  return {
    poolAdapter: poolAdapters[0],
    borrowAmount: await uc.totalBorrowedAmount()
  };
}
//endregion Make borrow

//region Conversion of amounts
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
export function baseToBt18(amount: BigNumber, params: IBaseToBorrowParams) : BigNumber {
  return baseToBt(amount, params, 18);
}

export function baseToBt(amount: BigNumber, params: IBaseToBorrowParams, targetDecimals: number) : BigNumber {
  // amount-in-base-currency = a1 * 10^db
  // we need to convert a1 * 10^db to a2*10^18, where a2 is the price in borrow tokens (and we need decimals 18 in result)
  //
  //                a1 * 10^db   *  10^dp
  // a2*10^18 =    ----------      -----  * 10^targetDecimals
  //                p * 10^dp       10^db
  //
  // db - decimals of the base currency
  // dp - decimals of the price

  console.log("baseToBorrow18", amount, params);
  console.log("baseToBorrow18 result=", amount // == a1 * 10^db
    .mul(getBigNumberFrom(1, params.priceDecimals)) // == 10^dp
    .mul(getBigNumberFrom(1, targetDecimals)) // == 10^targetDecimals
    .div(params.priceBaseCurrency) // == p * 10^dp
    .div(getBigNumberFrom(1, params.baseCurrencyDecimals))
  );

  return amount // == a1 * 10^db
    .mul(getBigNumberFrom(1, params.priceDecimals)) // == 10^dp
    .mul(getBigNumberFrom(1, targetDecimals)) // == 10^targetDecimals
    .div(params.priceBaseCurrency) // == p * 10^dp
    .div(getBigNumberFrom(1, params.baseCurrencyDecimals))
    ;
}

export function changeDecimals(amount: BigNumber, from: number, to: number) : BigNumber {
  return amount.mul(getBigNumberFrom(1, to)).div(getBigNumberFrom(1, from));
}
//endregion Conversion of amounts

//region ConfigurableAmountToBorrow
/** Convert numerical borrowAmount to BigNumer */
export function prepareExactBorrowAmount(
  data: ConfigurableAmountToBorrow,
  assetDecimals: number
): ConfigurableAmountToBorrow {
  if (
    (data.exact && !data.exactAmountToBorrow)
    || (!data.exact && !data.ratio18)
  ) {
    throw "Incorrect ConfigurableAmountToBorrowNumeric";
  }

  return data.exact
    ? new ConfigurableAmountToBorrow(
        true
      , ConfigurableAmountToBorrow.getValue(data, assetDecimals)
    )
    : data;
}

//endregion ConfigurableAmountToBorrow

//region Save borrow test results to CSV
export function appendTestResultsToFile(path: string, data: IBorrowTestResults[]) {
  console.log("appendTestResultsToFile", path);
  const lines: string[] = [];

  // write headers
  if (! existsSync(path)) {
    const headers: string[] = [
      "platformTitle"
      , "error"

      , "Collateral"
      , "Borrow"

      , "amount.C"
      , "amount.B"
      , "amountBT18.C"

      , "price.C"
      , "price.B"

      , "predicted.C.aprBT18"
      , "result.C.aprBT18"

      , "predicted.B.aprBT18"
      , "result.B.aprBT18"

      , "predicted.C.supplyRate"
      , "result.C.supplyRate"

      , "predicted.C.borrowRate"
      , "result.C.borrowRate"

      , "block0"
      , "block1"
      , "timestamp0"
      , "timestamp1"

      , "Collateral.address"
      , "Borrow.address"

      , "plan.converter"
      , "plan.ltv18"
      , "plan.borrowApr18"
      , "plan.liquidationThreshold18"
      , "plan.maxAmountToSupplyCT"
      , "plan.maxAmountToBorrowBT"
      , "plan.rewardsAmountBT18"
      , "plan.supplyAprBT18"

// plan

// point 0
      , "costsBT18.C"
      , "costsBT18.B"
      , "rewardsTotal"

      , "balances.C"
      , "balances.B"

      , "point.supplyRate"
      , "point.borrowRate"

      , "point.block0"
      , "point.block1"

      , "point.timestamp0"
      , "point.timestamp1"
    ]
    lines.push(headers.join(","));
  }

  for (const row of data) {
    const line = [
      row.platformTitle
      , row.error

      , row.assetCollateral.title
      , row.assetBorrow.title

      , row.results?.init.collateralAmount
      , row.results?.init.borrowAmount
      , row.results?.init.collateralAmountBT18

      , row.results?.prices.collateral
      , row.results?.prices.borrow

      , row.results?.predicted.aprBt36.collateral
      , row.results?.resultsBlock.aprBt36.collateral

      , row.results?.predicted.aprBt36.borrow
      , row.results?.resultsBlock.aprBt36.borrow

      , row.results?.predicted.rates.supplyRate
      , row.results?.resultsBlock.rates.supplyRate

      , row.results?.predicted.rates.borrowRate
      , row.results?.resultsBlock.rates.borrowRate

      , row.results?.resultsBlock.period.block0
      , row.results?.resultsBlock.period.block1
      , row.results?.resultsBlock.period.blockTimestamp0
      , row.results?.resultsBlock.period.blockTimestamp1

      , row.assetCollateral.asset
      , row.assetBorrow.asset

      , row.plan.converter
      , row.plan.ltv18
      , row.plan.borrowApr36
      , row.plan.liquidationThreshold18
      , row.plan.maxAmountToSupplyCT
      , row.plan.maxAmountToBorrowBT
      , row.plan.rewardsAmountBt36
      , row.plan.supplyAprBt36
    ];

    if (row.results) {
      for (const point of row.results?.points) {
        const linePoint = [
          point.costsBT18.collateral
          , point.costsBT18.borrow
          , point.totalAmountRewards

          , point.balances.collateral
          , point.balances.borrow

          , point.rates.supplyRate
          , point.rates.borrowRate

          , point.period.block0
          , point.period.block1

          , point.period.blockTimestamp0
          , point.period.blockTimestamp1
        ];
        line.push(...linePoint);
      }
    }

    lines.push(line.map(x => Aave3Helper.toString(x)).join(","));
  }

  // write data
  writeFileSync(
    path
    , lines.join("\n")
    , {
      encoding: 'utf8'
      , flag: "a" //appending
    }
  );
}

//endregion Save borrow test results to CSV