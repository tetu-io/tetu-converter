import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ITestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {BigNumber} from "ethers";
import {ILendingPlatformFabric} from "../fabrics/ILendingPlatformFabric";
import {TetuConverterApp} from "../helpers/TetuConverterApp";
import {MocksHelper} from "../helpers/MocksHelper";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {getRatioMul100, setInitialBalance} from "../utils/CommonUtils";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {existsSync, writeFileSync} from "fs";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {IBorrowingTestResults, ISwapTestResults} from "../uses-cases/CompareAprUsesCase";
import {IPointResults} from "./aprDataTypes";
import {Misc} from "../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";

//region Make borrow
/**
 * Initialize tetu-converter-app.
 * Disable swap.
 * Set initial collateral and borrow balances.
 * Make borrow using tetu-converter-app.
 * Return address of the pool adapter (borrower).
 */
export async function makeBorrow (
  deployer: SignerWithAddress,
  p: ITestSingleBorrowParams,
  amountToBorrow: BigNumber,
  fabric: ILendingPlatformFabric,
) : Promise<{
  poolAdapter: string,
  borrowAmount: BigNumber
}> {
  console.log("makeBorrow:", p, amountToBorrow);
  const {controller} = await TetuConverterApp.buildApp(
    deployer,
    [fabric],
    {
      swapManagerFabric: async () => (await MocksHelper.createSwapManagerMock(deployer)).address,
      tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR
    }
  );
  const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.countBlocks);

  const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
  const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

  await setInitialBalance(deployer, collateralToken.address,
    p.collateral.holder, p.collateral.initialLiquidity, uc.address);
  await setInitialBalance(deployer, borrowToken.address,
    p.borrow.holder, p.borrow.initialLiquidity, uc.address);
  const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

  await uc.borrowExactAmount(
    p.collateral.asset,
    collateralAmount,
    p.borrow.asset,
    uc.address,
    amountToBorrow
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

//region Save borrow/swap test results to CSV
/**
 *   Prepare set of headers
 *   Abbreviations in the headers:
 *   P1 = point 1, RW - rewards, R - results, P - predicted, C - collateral, B - borrow
 */
function getHeadersLine(): string[] {
  return [
    "platformTitle",
    "period.blocks",
    "error",
    "P.apr18",
    "apr18",
    "C.lost",

    "Collateral",
    "Borrow",
// amounts
    "amount.C",
    "amount.B",
    "amountBT18.C",
// rewards
    "planP.RW.AmountBt36",
    "P1.RW.AmountBt36",
    "P/R.%",
// collateral apr
    "P.C.aprBt36",
    "R.C.aprBt36",
    "P/R.%",
// borrow apr
    "P.B.aprBt36",
    "R.B.aprBt36",
    "P/R.%",
// costs
    "P1.costsBT36.C",
    "C.blocks",
    "P1.costsBT36.B",
    "B.blocks",
// prices
    "price.C",
    "price.B",
// plan1 - apr
    "plan1.S.AprBt36",
    "plan1.B.Apr36",
// supply rates
    "P.C.supplyRate",
    "R.C.supplyRate",
// borrow rates
    "P.C.borrowRate",
    "R.C.borrowRate",
// periods
    "block0",
    "block1",
    "timestamp0",
    "timestamp1",
// addresses
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
}

function escapeCsvText(text?: string) : string | undefined {
  if (!text) return text;

  return text.replace(/[,;]/g, " ");
}

export function appendBorrowingTestResultsToFile(path: string, data: IBorrowingTestResults[]) {
  console.log("appendBorrowingTestResultsToFile", path);
  const lines: string[] = [];

  if (! existsSync(path)) {
    const headers = getHeadersLine();
    lines.push(headers.join(","));
  }

  for (const row of data) {
    const firstPoint: IPointResults | undefined = row.results?.points ? row.results?.points[0] : undefined;
    const plannedApr18 = row.planFullPeriod.amountCollateralInBorrowAsset36
      ? getExpectedApr18(
        row.planFullPeriod.borrowCost36,
        row.planFullPeriod.supplyIncomeInBorrowAsset36,
        row.planFullPeriod.rewardsAmountInBorrowAsset36,
        row.planFullPeriod.amountCollateralInBorrowAsset36,
        Misc.WEI // TODO: take rewards factor from controller
      )
      : undefined;

    const line = [
      row.platformTitle,
      row.countBlocks,
      escapeCsvText(row.error),
      plannedApr18,
      row.results?.resultAmounts?.apr18,
      undefined, // lost of collateral

      row.assetCollateral.title,
      row.assetBorrow.title,

      row.results?.collateralAmount,
      row.results?.borrowAmount,
      row.results?.collateralAmountInBorrowTokens18,

      row.planFullPeriod.rewardsAmountInBorrowAsset36,
      firstPoint?.totalAmountRewardsBt36,
      row.planFullPeriod.rewardsAmountInBorrowAsset36 && !row.planFullPeriod.rewardsAmountInBorrowAsset36.eq(0)
          ? firstPoint?.totalAmountRewardsBt36?.mul(100).div(row.planFullPeriod.rewardsAmountInBorrowAsset36)
          : undefined,

      row.results?.predictedAmounts.supplyIncomeInBorrowTokens36,
      row.results?.resultAmounts.supplyIncomeInBorrowTokens36,
      getRatioMul100(
        row.results?.predictedAmounts.supplyIncomeInBorrowTokens36,
        row.results?.resultAmounts.supplyIncomeInBorrowTokens36
      ),

      row.results?.predictedAmounts.costBorrow36,
      row.results?.resultAmounts.costBorrow36,
      getRatioMul100(
        row.results?.predictedAmounts.costBorrow36,
        row.results?.resultAmounts.costBorrow36
      ),

      firstPoint?.costsInBorrowTokens36.collateral,
      firstPoint?.costsInBorrowTokens36.collateral
        && row.results?.predictedAmounts.supplyIncomeInBorrowTokens36
        && !row.results?.predictedAmounts.supplyIncomeInBorrowTokens36.eq(0)
          ? firstPoint?.costsInBorrowTokens36.collateral.div(row.results?.predictedAmounts.supplyIncomeInBorrowTokens36)
          : undefined,
      firstPoint?.costsInBorrowTokens36.borrow,
      firstPoint?.costsInBorrowTokens36.borrow
        && row.results?.predictedAmounts.costBorrow36
        && !row.results?.predictedAmounts.costBorrow36.eq(0)
        ? firstPoint?.costsInBorrowTokens36.borrow.div(row.results?.predictedAmounts.costBorrow36)
        : undefined,

      row.results?.prices.collateral,
      row.results?.prices.borrow,

      row.planSingleBlock.supplyIncomeInBorrowAsset36,
      row.planSingleBlock.borrowCost36,

      row.results?.predictedRates.supplyRate,
      row.results?.resultRates.supplyRate,

      row.results?.predictedRates.borrowRate,
      row.results?.resultRates.borrowRate,

      row.results?.period.block0,
      row.results?.period.block1,
      row.results?.period.blockTimestamp0,
      row.results?.period.blockTimestamp1,

      row.assetCollateral.asset,
      row.assetBorrow.asset,

// plan single block
      row.planSingleBlock.converter,
      row.planSingleBlock.rewardsAmountInBorrowAsset36,
      row.planSingleBlock.ltv18,
      row.planSingleBlock.liquidationThreshold18,
      row.planSingleBlock.maxAmountToSupply,
      row.planSingleBlock.maxAmountToBorrow,

// plan full period
      row.planFullPeriod.converter,
      row.planFullPeriod.supplyIncomeInBorrowAsset36,
      row.planFullPeriod.borrowCost36,
      row.planFullPeriod.ltv18,
      row.planFullPeriod.liquidationThreshold18,
      row.planFullPeriod.maxAmountToSupply,
      row.planFullPeriod.maxAmountToBorrow,
    ];

    if (row.results) {
      for (const point of row.results?.points) {
        const linePoint = [
          point.costsInBorrowTokens36.collateral,
          point.costsInBorrowTokens36.borrow,
          point.totalAmountRewards,
          point.totalAmountRewardsBt36,

          point.balances.collateral,
          point.balances.borrow,

          point.rates.supplyRate,
          point.rates.borrowRate,

          point.period.block0,
          point.period.block1,

          point.period.blockTimestamp0,
          point.period.blockTimestamp1,
        ];
        line.push(...linePoint);
      }
    }

    lines.push(line.map(x => Aave3Helper.toString(x)).join(","));
  }

  // write data
  writeFileSync(
    path,
    lines.join("\n") + "\n",
    {
      encoding: 'utf8',
      flag: "a" // appending
    }
  );
}

export function appendSwapTestResultsToFile(path: string, data: ISwapTestResults[]) {
  console.log("appendSwapTestResultsToFile", path);
  const lines: string[] = [];

  if (! existsSync(path)) {
    const headers = getHeadersLine();
    lines.push(headers.join(","));
  }

  for (const row of data) {
    const line = [
      "SWAP",
      "",
      escapeCsvText(row.error),
      row.apr18,
      row.results?.apr18,
      row.results?.lostCollateral,

      row.assetCollateral.title,
      row.assetBorrow.title,
// amounts
      row.results?.collateralAmount || row.collateralAmount,
      row.results?.borrowedAmount,
      "", // row.results?.init.collateralAmountBT18,
// rewards
      undefined, // row.planFullPeriod.rewardsAmountBt36,
      undefined, // firstPoint?.totalAmountRewardsBt36,
      undefined,
// collateral apr
      undefined, undefined, undefined,
// borrow apr
      undefined, // row.results?.predicted.aprBt36.borrow,
      undefined, // row.results?.resultsBlock.aprBt36.borrow,
      undefined,
// costs
      undefined, undefined, undefined, undefined,
// prices
      undefined, undefined,
// plan1 - apr
      undefined,
      undefined,
// supply rates
      undefined, undefined,
// borrow rates
      undefined, undefined,
// periods
      undefined, undefined, undefined, undefined,
// addresses
      row.assetCollateral.asset, row.assetBorrow.asset,
// plan single block
      undefined, undefined, undefined, undefined, undefined,
    ];

    lines.push(line.map(x => Aave3Helper.toString(x)).join(","));
  }

  // write data
  writeFileSync(
    path,
    lines.join("\n") + "\n",
    {
      encoding: 'utf8',
      flag: "a" // appending
    }
  );
}
//endregion Save borrow/swap test results to CSV

//region Expected APR
/**
 * Repeat the algo of APR calculation
 * from BorrowManager.findConverter
 */
export function getExpectedApr18(
  borrowCost: BigNumber,
  supplyIncomeInBorrowAsset: BigNumber,
  rewardsAmountInBorrowAsset: BigNumber,
  amountCollateralInBorrowAsset: BigNumber,
  rewardsFactor18: BigNumber
) : BigNumber {
  console.log("expected.borrowCost", borrowCost);
  console.log("expected.supplyIncomeInBorrowAsset", supplyIncomeInBorrowAsset);
  console.log("expected.rewardsAmountInBorrowAsset", rewardsAmountInBorrowAsset);
  console.log("expected.rewardsFactor", rewardsFactor18);
  console.log("expected.amountCollateralInBorrowAsset", amountCollateralInBorrowAsset);
  return amountCollateralInBorrowAsset.eq(0)
    ? BigNumber.from(0)
    : borrowCost
      .sub(supplyIncomeInBorrowAsset)
      .sub(rewardsAmountInBorrowAsset.mul(rewardsFactor18).div(Misc.WEI))
      .mul(Misc.WEI)
      .div(amountCollateralInBorrowAsset);
}
//endregion Expected APR