import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {BigNumber} from "ethers";
import {ILendingPlatformFabric} from "../fabrics/ILendingPlatformFabric";
import {TetuConverterApp} from "../helpers/TetuConverterApp";
import {MocksHelper} from "../helpers/MocksHelper";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {setInitialBalance} from "../utils/CommonUtils";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {existsSync, writeFileSync} from "fs";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {IBorrowTestResults} from "../uses-cases/CompareAprUsesCase";
import {IPointResults} from "./aprDataTypes";

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
  amountToBorrow: BigNumber,
  fabric: ILendingPlatformFabric,
) : Promise<{
  poolAdapter: string,
  borrowAmount: BigNumber
}> {
  console.log("makeBorrow:", p, amountToBorrow);
  const {controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
  const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.countBlocks);

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
    , true
    , amountToBorrow
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

//region Save borrow test results to CSV
export function appendTestResultsToFile(path: string, data: IBorrowTestResults[]) {
  console.log("appendTestResultsToFile", path);
  const lines: string[] = [];

  // write headers
  // Abbreviations in the headers:
  // P1 = point 1, RW - rewards, R - results, P - predicted, C - collateral, B - borrow
  if (! existsSync(path)) {
    const headers: string[] = [
      "platformTitle",
      "period.blocks",
      "error",

      "Collateral",
      "Borrow",

      "amount.C",
      "amount.B",
      "amountBT18.C",

      "planP.RW.AmountBt36",
      "P1.RW..AmountBt36",
      "P/R.%",

      "P.C.aprBt36",
      "R.C.aprBt36",
      "P/R.%",

      "P.B.aprBt36",
      "R.B.aprBt36",
      "P/R.%",

      "P1.costsBT36.C",
      "C.blocks",
      "P1.costsBT36.B",
      "B.blocks",

      "price.C",
      "price.B",

      "plan1.S.AprBt36",
      "plan1.B.Apr36",

      "P.C.supplyRate",
      "R.C.supplyRate",

      "P.C.borrowRate",
      "R.C.borrowRate",

      "block0",
      "block1",
      "timestamp0",
      "timestamp1",

      "Collateral.address",
      "Borrow.address",

// plan single block
      "plan1.converter",
      "plan1.RW.AmountBt36",
      "plan1.ltv18",
      "plan1.liquidationThreshold18",
      "plan1.maxAmountToSupplyCT",
      "plan1.maxAmountToBorrowBT",

// plan full period
      "planP.converter",
      "planP.S.AprBt36",
      "planP.B.Apr36",
      "planP.ltv18",
      "planP.liquidationThreshold18",
      "planP.maxAmountToSupplyCT",
      "planP.maxAmountToBorrowBT",

// point 0
      "costsBT36.C",
      "costsBT36.B",
      "rewardsTotal",
      "rewardsTotalBt36",

      "balances.C",
      "balances.B",

      "point.supplyRate",
      "point.borrowRate",

      "point.block0",
      "point.block1",

      "point.timestamp0",
      "point.timestamp1",
    ]
    lines.push(headers.join(","));
  }

  for (const row of data) {
    const firstPoint: IPointResults | undefined = row.results?.points ? row.results?.points[0] : undefined;
    const line = [
      row.platformTitle,
      row.countBlocks,
      row.error,

      row.assetCollateral.title,
      row.assetBorrow.title,

      row.results?.init.collateralAmount,
      row.results?.init.borrowAmount,
      row.results?.init.collateralAmountBT18,

      row.planFullPeriod.rewardsAmountBt36,
      firstPoint?.totalAmountRewardsBt36,
      row.planFullPeriod.rewardsAmountBt36 && !row.planFullPeriod.rewardsAmountBt36.eq(0)
          ? firstPoint?.totalAmountRewardsBt36?.mul(100).div(row.planFullPeriod.rewardsAmountBt36)
          : undefined,

      row.results?.predicted.aprBt36.collateral,
      row.results?.resultsBlock.aprBt36.collateral,
      row.results?.resultsBlock.aprBt36.collateral && !row.results?.resultsBlock.aprBt36.collateral.eq(0)
        ? row.results?.predicted.aprBt36.collateral.mul(100).div(row.results?.resultsBlock.aprBt36.collateral)
        : undefined,

      row.results?.predicted.aprBt36.borrow,
      row.results?.resultsBlock.aprBt36.borrow,
      row.results?.resultsBlock.aprBt36.borrow && !row.results?.resultsBlock.aprBt36.borrow.eq(0)
        ? row.results?.predicted.aprBt36.borrow.mul(100).div(row.results?.resultsBlock.aprBt36.borrow)
        : undefined,

      firstPoint?.costsBT36.collateral,
      firstPoint?.costsBT36.collateral
        && row.results?.predicted.aprBt36.collateral
        && !row.results?.predicted.aprBt36.collateral.eq(0)
          ? firstPoint?.costsBT36.collateral.div(row.results?.predicted.aprBt36.collateral)
          : undefined,
      firstPoint?.costsBT36.borrow,
      firstPoint?.costsBT36.borrow
        && row.results?.predicted.aprBt36.borrow
        && !row.results?.predicted.aprBt36.borrow.eq(0)
        ? firstPoint?.costsBT36.borrow.div(row.results?.predicted.aprBt36.borrow)
        : undefined,

      row.results?.prices.collateral,
      row.results?.prices.borrow,

      row.planSingleBlock.supplyAprBt36,
      row.planSingleBlock.borrowApr36,

      row.results?.predicted.rates.supplyRate,
      row.results?.resultsBlock.rates.supplyRate,

      row.results?.predicted.rates.borrowRate,
      row.results?.resultsBlock.rates.borrowRate,

      row.results?.resultsBlock.period.block0,
      row.results?.resultsBlock.period.block1,
      row.results?.resultsBlock.period.blockTimestamp0,
      row.results?.resultsBlock.period.blockTimestamp1,

      row.assetCollateral.asset,
      row.assetBorrow.asset,

// plan single block
      row.planSingleBlock.converter,
      row.planSingleBlock.rewardsAmountBt36,
      row.planSingleBlock.ltv18,
      row.planSingleBlock.liquidationThreshold18,
      row.planSingleBlock.maxAmountToSupplyCT,
      row.planSingleBlock.maxAmountToBorrowBT,

// plan full period
      row.planFullPeriod.converter,
      row.planFullPeriod.supplyAprBt36,
      row.planFullPeriod.borrowApr36,
      row.planFullPeriod.ltv18,
      row.planFullPeriod.liquidationThreshold18,
      row.planFullPeriod.maxAmountToSupplyCT,
      row.planFullPeriod.maxAmountToBorrowBT,
    ];

    if (row.results) {
      for (const point of row.results?.points) {
        const linePoint = [
          point.costsBT36.collateral
          , point.costsBT36.borrow
          , point.totalAmountRewards
          , point.totalAmountRewardsBt36

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
    , lines.join("\n") + "\n"
    , {
      encoding: 'utf8'
      , flag: "a" //appending
    }
  );
}

//endregion Save borrow test results to CSV