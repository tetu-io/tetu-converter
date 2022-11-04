import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ITestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {
  IAaveKeyState,
  IAaveKeyTestValues,
  IBorrowResults,
  IPointResults
} from "./aprDataTypes";
import {DataTypes, IAaveTwoPool} from "../../../typechain/contracts/integrations/aaveTwo/IAaveTwoPool";
import hre from "hardhat";
import {
  AaveTwoAprLibFacade,
  IAaveToken__factory,
  IERC20Extended__factory
} from "../../../typechain";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {AaveTwoHelper} from "../../../scripts/integration/helpers/AaveTwoHelper";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {
  convertUnits,
  IBaseToBorrowParams,
  makeBorrow, baseToBt, getExpectedApr18
} from "./aprUtils";
import {AaveTwoPlatformFabric} from "../fabrics/AaveTwoPlatformFabric";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {Misc} from "../../../scripts/utils/Misc";
import {getDifference} from "../utils/CommonUtils";

//region Data types
interface IAaveTwoReserveData {
  availableLiquidity: BigNumber;
  totalStableDebt: BigNumber;
  totalVariableDebt: BigNumber;
  liquidityRate: BigNumber;
  variableBorrowRate: BigNumber;
  stableBorrowRate: BigNumber;
  averageStableBorrowRate: BigNumber;
  liquidityIndex: BigNumber;
  variableBorrowIndex: BigNumber;
  lastUpdateTimestamp: number;
}

interface IAaveTwoAssetStateRaw {
  data: {
    configuration: DataTypes.ReserveConfigurationMapStructOutput;
    liquidityIndex: BigNumber;
    variableBorrowIndex: BigNumber;
    currentLiquidityRate: BigNumber;
    currentVariableBorrowRate: BigNumber;
    currentStableBorrowRate: BigNumber;
    lastUpdateTimestamp: number;
    aTokenAddress: string;
    stableDebtTokenAddress: string;
    variableDebtTokenAddress: string;
    interestRateStrategyAddress: string;
    id: number;
  },
  reserveNormalized: BigNumber,
  scaledBalance: BigNumber,
}

export interface IAaveTwoUserAccountDataResults {
  totalCollateralETH: BigNumber;
  totalDebtETH: BigNumber;
  availableBorrowsETH: BigNumber;
  currentLiquidationThreshold: BigNumber;
  ltv: BigNumber;
  healthFactor: BigNumber;
}

interface IAaveTwoStateInfo {
  collateral: IAaveTwoAssetStateRaw;
  borrow: IAaveTwoAssetStateRaw;
  block: number;
  blockTimestamp: number;
  userAccount?: IAaveTwoUserAccountDataResults;
}

interface ICostValue {
  /* Cost/income value in terms of base currency */
  valueBase: BigNumber,
  nextLiquidityIndex: BigNumber,
  /* Cost/income value in terms of borrow/collateral asset, multiplied on 1e18 to increase the precision */
  valueMultiplied18: BigNumber
}

interface IAprAaveTwoResults {
  /** State before borrow */
  before: IAaveTwoStateInfo;
  /** State just after borrow */
  next: IAaveTwoStateInfo;
  /** State just after borrow + 1 block */
  last: IAaveTwoStateInfo;
  /** Borrower address */
  userAddress: string;
  /** Exact value of the borrowed amount */
  borrowAmount: BigNumber;

//// next : last  results

  /** Supply APR in terms of base currency calculated using predicted supply rate */
  supplyIncomeBaseExactMul18: BigNumber;
  /** Supply income in terms of base currency calculated using exact supply rate taken from next step */
  supplyIncomeBaseApprox: ICostValue;
  /** Borrow cost in terms of base currency calculated using predicted borrow rate */
  borrowCostBaseExactMul18: BigNumber;
  /** borrow APR in terms of base currency calculated using exact borrow rate taken from next step */
  borrowCostBaseApprox: ICostValue;
  /** total increment of collateral amount from NEXT to LAST in terms of base currency */
  totalCollateralETH: BigNumber;
  /** total increment of borrowed amount from NEXT to LAST in terms of base currency */
  totalDebtETH: BigNumber;


  keyValues: IAaveKeyTestValues;
}
//endregion Data types

//region Utils
export async function getAaveTwoStateInfo(
  deployer: SignerWithAddress,
  aavePool: IAaveTwoPool,
  assetCollateral: string,
  assetBorrow: string,
  userAddress?: string,
) : Promise<IAaveTwoStateInfo> {
  const block = await hre.ethers.provider.getBlock("latest");

  const userAccount = userAddress
    ? await aavePool.getUserAccountData(userAddress)
    : undefined;

  const collateralAssetData = await aavePool.getReserveData(assetCollateral);
  const reserveNormalized = await aavePool.getReserveNormalizedIncome(assetCollateral);
  const collateralScaledBalance = userAddress
    ? await IAaveToken__factory.connect(
      collateralAssetData.aTokenAddress, deployer
    ).scaledBalanceOf(userAddress)
    : BigNumber.from(0);

  const borrowAssetDataAfterBorrow = await aavePool.getReserveData(assetBorrow);
  const borrowReserveNormalized = await aavePool.getReserveNormalizedVariableDebt(assetBorrow);
  const borrowScaledBalance = userAddress
    ? await IAaveToken__factory.connect(
      borrowAssetDataAfterBorrow.variableDebtTokenAddress, deployer
    ).scaledBalanceOf(userAddress)
    : BigNumber.from(0);

  return {
    userAccount,
    block: block.number,
    blockTimestamp: block.timestamp,
    collateral: {
      data: collateralAssetData,
      reserveNormalized,
      scaledBalance: collateralScaledBalance
    },
    borrow: {
      data: borrowAssetDataAfterBorrow,
      reserveNormalized: borrowReserveNormalized,
      scaledBalance: borrowScaledBalance
    }
  }
}

/**
 * Calc costs in the state AFTER the supply/borrow operation
 * Return value in terms of base currency
 */
async function getCostForPeriodAfterAAVETwoMultiplied(
  libFacade: AaveTwoAprLibFacade,
  amount: BigNumber,
  predictedRate: BigNumber,
  price: BigNumber,
  countBlocks: number,
  state: IAaveKeyState,
  blocksPerDay: number,
  decimalsAmount: number,
  multiplier: BigNumber
) : Promise<BigNumber> {
  const value = await libFacade.getCostForPeriodAfter(
    amount,
    state.reserveNormalized,
    state.liquidityIndex,
    predictedRate,
    countBlocks,
    blocksPerDay,
    multiplier // additional multiplier to keep precision
  );
  return (value)
    .mul(price)
    .div(getBigNumberFrom(1, decimalsAmount))
    ;

}

/**
 * Calc cost/income-value in the state BEFORE the supply/borrow operation
 * Return value in terms of base currency
 */
async function getCostValueBeforeAAVETwo(
  libFacade: AaveTwoAprLibFacade,
  amount: BigNumber,
  predictedRate: BigNumber,
  price: BigNumber,
  countBlocks: number,
  state: IAaveKeyState,
  blocksPerDay: number,
  operationTimestamp: number,
  decimalsAmount: number,
) : Promise<ICostValue> {
  const st = {
    liquidityIndex: state.liquidityIndex,
    rate: state.rate,
    lastUpdateTimestamp: state.lastUpdateTimestamp
  };

  const nextLiquidityIndex = await libFacade.getNextLiquidityIndex(st, operationTimestamp);
  const valueMultiplied18 = await libFacade.getCostForPeriodBefore(
    st,
    amount,
    predictedRate,
    countBlocks,
    blocksPerDay,
    operationTimestamp,
    Misc.WEI // additional multiplier to keep the precision
  );
  return {
    valueBase: valueMultiplied18
      .mul(price)
      .div(Misc.WEI)
      .div(getBigNumberFrom(1, decimalsAmount)),
    nextLiquidityIndex,
    valueMultiplied18
  };
}
//endregion Utils

export class AprAaveTwo {
  /**
   * 0. Predict APR
   * 1. Make borrow
   * This is "next point" (or AFTER BORROW point)
   * 2. Wait N blocks (typically N is 1)
   * This is "last point"
   * 3. Calculate real APR for the period since "next" to "last"
   * 4. Enumerate all additional points. Move to the point, get balances, save them to the results.
   *
   * @param deployer
   * @param amountToBorrow0 Amount to borrow without decimals (i.e. 100 for 100 DAI)
   * @param p Main parameters (asset, amounts, so on)
   * @param additionalPoints
   */
  static async makeBorrowTest(
    deployer: SignerWithAddress,
    amountToBorrow0: number | BigNumber,
    p: ITestSingleBorrowParams,
    additionalPoints: number[]
  ) : Promise<{
    details: IAprAaveTwoResults,
    results: IBorrowResults
  }> {
    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const aavePool = await AaveTwoHelper.getAavePool(deployer);
    const dp = await AaveTwoHelper.getAaveProtocolDataProvider(deployer);
    const priceOracle = await AaveTwoHelper.getAavePriceOracle(deployer);
    const baseCurrencyDecimals = await IERC20Extended__factory.connect(await priceOracle.WETH(), deployer).decimals();

    const borrowReserveData = await dp.getReserveData(p.borrow.asset);
    const collateralReserveData = await dp.getReserveData(p.collateral.asset);

    const amountCollateral = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);
    console.log(`amountCollateral=${amountCollateral.toString()}`);

    // prices
    const prices = await priceOracle.getAssetsPrices([p.collateral.asset, p.borrow.asset]);
    const priceCollateral = prices[0];
    const priceBorrow = prices[1];
    console.log("priceCollateral", priceCollateral);
    console.log("priceBorrow", priceBorrow);

    // predict APR
    const libFacade = await DeployUtils.deployContract(deployer, "AaveTwoAprLibFacade") as AaveTwoAprLibFacade;

    // start point: we estimate APR in this point before borrow and supply
    const before = await getAaveTwoStateInfo(deployer, aavePool, p.collateral.asset, p.borrow.asset);

    // make borrow
    const borrowResults = await makeBorrow(
      deployer,
      p,
      getBigNumberFrom(amountToBorrow0, borrowToken.decimals),
      new AaveTwoPlatformFabric(),
    );
    const userAddress = borrowResults.poolAdapter;
    const borrowAmount = borrowResults.borrowAmount;
    console.log(`userAddress=${userAddress} borrowAmount=${borrowAmount}`);

    const supplyRatePredictedRays = await libFacade.getLiquidityRateRays(
      before.collateral.data,
      p.collateral.asset,
      amountCollateral,
      collateralReserveData.totalStableDebt,
      collateralReserveData.totalVariableDebt,
    );
    const borrowRatePredictedRays = (await libFacade.getVariableBorrowRateRays(
      before.borrow.data,
      p.borrow.asset,
      borrowAmount,
      borrowReserveData.totalStableDebt,
      borrowReserveData.totalVariableDebt
    ));
    console.log(`Predicted: supplyRatePredictedRays=${supplyRatePredictedRays.toString()}`);
    console.log(`Predicted: borrowRatePredictedRays=${borrowRatePredictedRays.toString()}`);

    const next = await getAaveTwoStateInfo(deployer, aavePool, p.collateral.asset, p.borrow.asset, userAddress);
    await TimeUtils.advanceNBlocks(p.countBlocks);
    const last = await getAaveTwoStateInfo(deployer, aavePool, p.collateral.asset, p.borrow.asset, userAddress);

    // we need to display full objects
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;
    console.log("before", before);
    console.log("next", next);
    console.log("last", last);

    const keyValues = {
      borrowRatePredicted: borrowRatePredictedRays,
      liquidityRatePredicted: supplyRatePredictedRays,

      liquidity: {
        beforeBorrow: {
          block: before.block,
          blockTimeStamp: before.blockTimestamp,
          rate: before.collateral.data.currentLiquidityRate,
          liquidityIndex: before.collateral.data.liquidityIndex,
          scaledBalance: BigNumber.from(0),
          reserveNormalized: before.collateral.reserveNormalized,
          userBalanceBase: BigNumber.from(0),
          lastUpdateTimestamp: before.collateral.data.lastUpdateTimestamp
        },
        next: {
          block: next.block,
          blockTimeStamp: next.blockTimestamp,
          rate: next.collateral.data.currentLiquidityRate,
          liquidityIndex: next.collateral.data.liquidityIndex,
          scaledBalance: next.collateral.scaledBalance,
          reserveNormalized: next.collateral.reserveNormalized,
          userBalanceBase: next.userAccount?.totalCollateralETH || BigNumber.from(0),
          lastUpdateTimestamp: next.collateral.data.lastUpdateTimestamp
        },
        last: {
          block: last.block,
          blockTimeStamp: last.blockTimestamp,
          rate: last.collateral.data.currentLiquidityRate,
          liquidityIndex: last.collateral.data.liquidityIndex,
          scaledBalance: last.collateral.scaledBalance,
          reserveNormalized: last.collateral.reserveNormalized,
          userBalanceBase: last.userAccount?.totalCollateralETH || BigNumber.from(0),
          lastUpdateTimestamp: last.collateral.data.lastUpdateTimestamp
        }
      },
      borrow: {
        beforeBorrow: {
          block: before.block,
          blockTimeStamp: before.blockTimestamp,
          rate: before.borrow.data.currentVariableBorrowRate,
          liquidityIndex: before.borrow.data.variableBorrowIndex,
          scaledBalance: BigNumber.from(0),
          reserveNormalized: before.borrow.reserveNormalized,
          userBalanceBase: BigNumber.from(0),
          lastUpdateTimestamp: before.borrow.data.lastUpdateTimestamp
        },
        next: {
          block: next.block,
          blockTimeStamp: next.blockTimestamp,
          rate: next.borrow.data.currentVariableBorrowRate,
          liquidityIndex: next.borrow.data.variableBorrowIndex,
          scaledBalance: next.borrow.scaledBalance,
          reserveNormalized: next.borrow.reserveNormalized,
          userBalanceBase: next.userAccount?.totalDebtETH || BigNumber.from(0),
          lastUpdateTimestamp: next.borrow.data.lastUpdateTimestamp
        },
        last: {
          block: last.block,
          blockTimeStamp: last.blockTimestamp,
          rate: last.borrow.data.currentVariableBorrowRate,
          liquidityIndex: last.borrow.data.variableBorrowIndex,
          scaledBalance: last.borrow.scaledBalance,
          reserveNormalized: last.borrow.reserveNormalized,
          userBalanceBase: last.userAccount?.totalDebtETH || BigNumber.from(0),
          lastUpdateTimestamp: last.borrow.data.lastUpdateTimestamp
        }
      },
    };
    console.log("key", keyValues);

    // calculate exact values of supply/borrow APR
    // we use state-values "after-borrow" and exact values of supply/borrow rates after borrow
    const countBlocks = keyValues.liquidity.last.blockTimeStamp - keyValues.liquidity.next.blockTimeStamp;
    // for test purpose assume that we have exactly 1 block per 1 second
    const blocksPerDay = 86400;
    console.log("countBlocks", countBlocks);

    const supplyIncomeBaseExactMul18 = await getCostForPeriodAfterAAVETwoMultiplied(
      libFacade
      , amountCollateral
      , supplyRatePredictedRays
      , priceCollateral
      , countBlocks
      , keyValues.liquidity.next
      , blocksPerDay
      , collateralToken.decimals
      , getBigNumberFrom(1, 18) // additional multiplier to keep precision
    );
    console.log("supplyIncomeBaseExactMul18", supplyIncomeBaseExactMul18);
    const borrowIncomeBaseExactMul18 = await getCostForPeriodAfterAAVETwoMultiplied(
      libFacade
      , borrowAmount
      , next.borrow.data.currentVariableBorrowRate
      , priceBorrow
      , countBlocks
      , keyValues.borrow.next
      , blocksPerDay
      , borrowToken.decimals
      , Misc.WEI // additional multiplier to keep precision
    );
    console.log("borrowIncomeBaseExactMul18", borrowIncomeBaseExactMul18);

    // calculate approx values of supply/borrow APR
    // we use state-values "before-borrow" and predicted values of supply/borrow rates after borrow
    const supplyIncomeBaseApprox = await getCostValueBeforeAAVETwo(
      libFacade
      , amountCollateral
      , keyValues.liquidityRatePredicted
      , priceCollateral
      , countBlocks
      , keyValues.liquidity.beforeBorrow
      , blocksPerDay
      , keyValues.liquidity.next.blockTimeStamp
      , collateralToken.decimals
    );
    console.log("supplyIncomeBaseApprox", supplyIncomeBaseApprox);
    const borrowCostBaseApprox = await getCostValueBeforeAAVETwo(
      libFacade
      , borrowAmount
      , keyValues.borrowRatePredicted
      , priceBorrow
      , countBlocks
      , keyValues.borrow.beforeBorrow
      , blocksPerDay
      , keyValues.borrow.next.blockTimeStamp
      , borrowToken.decimals
    );
    console.log("borrowCostBaseApprox", borrowCostBaseApprox);

    // calculate real differences in user-account-balances for period [next block, last block]
    const totalCollateralETH = getDifference(
      last.userAccount?.totalCollateralETH,
      next.userAccount?.totalCollateralETH
    );
    const totalDebtETH = getDifference(
      last.userAccount?.totalDebtETH,
      next.userAccount?.totalDebtETH
    );
    console.log("totalCollateralETH", totalCollateralETH);
    console.log("totalDebtETH", totalDebtETH);

    const bbp: IBaseToBorrowParams = {
      baseCurrencyDecimals,
      priceBaseCurrency: priceBorrow,
      priceDecimals: baseCurrencyDecimals // all prices in AAVE TWO are in ETH
    }

    const pointsResults: IPointResults[] = [];
    const prev = last;
    for (const period of additionalPoints) {
      await TimeUtils.advanceNBlocks(period);
      const current = await getAaveTwoStateInfo(deployer, aavePool, p.collateral.asset, p.borrow.asset, userAddress);

      pointsResults.push({
        period: {
          block0: prev.block,
          blockTimestamp0: prev.blockTimestamp,
          block1: current.block,
          blockTimestamp1: current.blockTimestamp,
        },
        rates: {
          supplyRate: current.collateral.data.currentLiquidityRate,
          borrowRate: current.borrow.data.currentVariableBorrowRate
        },
        balances: {
          collateral: current.userAccount?.totalCollateralETH || BigNumber.from(0),
          borrow: current.userAccount?.totalDebtETH || BigNumber.from(0)
        },
        costsInBorrowTokens36: {
          collateral: baseToBt(
            (current.userAccount?.totalCollateralETH || BigNumber.from(0))
              .sub(prev.userAccount?.totalCollateralETH || BigNumber.from(0))
            , bbp
            , 36
          ),
          borrow: baseToBt(
            (current.userAccount?.totalDebtETH || BigNumber.from(0)).sub(
              prev.userAccount?.totalDebtETH || BigNumber.from(0)
            )
            , bbp
            , 36
          ),
        }
      })
    }

    const collateralAmountInBorrowTokens36 = convertUnits(amountCollateral,
      priceCollateral,
      collateralToken.decimals,
      priceBorrow,
      36
    );

    const predictedSupplyIncomeInBorrowTokens36 = supplyIncomeBaseApprox.valueMultiplied18
      .mul(Misc.WEI)
      .mul(priceCollateral)
      .div(priceBorrow)
      .div(getBigNumberFrom(1, collateralToken.decimals));

    const predictedCostBorrow36 = borrowCostBaseApprox.valueMultiplied18
      .mul(Misc.WEI)
      .div(getBigNumberFrom(1, borrowToken.decimals));

    const predictedApr18 = getExpectedApr18(
      predictedCostBorrow36,
      predictedSupplyIncomeInBorrowTokens36,
      BigNumber.from(0),
      collateralAmountInBorrowTokens36,
      Misc.WEI // rewardsFactor: any value is ok here, there are no rewards
    );

    const resultSupplyIncomeInBorrowTokens36 = baseToBt(totalCollateralETH, bbp, 36);
    const resultCostBorrow36 = baseToBt(totalDebtETH, bbp, 36);
    const resultApr18 = getExpectedApr18(
      resultCostBorrow36,
      resultSupplyIncomeInBorrowTokens36,
      BigNumber.from(0),
      collateralAmountInBorrowTokens36,
      Misc.WEI // rewardsFactor: any value is ok here, there are no rewards
    );

    return {
      details: {
        borrowAmount,
        before,
        borrowCostBaseApprox,
        last,
        borrowCostBaseExactMul18: borrowIncomeBaseExactMul18,
        next,
        supplyIncomeBaseApprox,
        keyValues,
        supplyIncomeBaseExactMul18,
        userAddress,
        totalCollateralETH,
        totalDebtETH,
      },
      results: {
        borrowAmount,
        collateralAmount: amountCollateral,
        collateralAmountInBorrowTokens18: collateralAmountInBorrowTokens36.div(18),
        predictedAmounts: {
          costBorrow36: predictedCostBorrow36,
          supplyIncomeInBorrowTokens36: predictedSupplyIncomeInBorrowTokens36,
          apr18: predictedApr18
        },
        predictedRates: {
          borrowRate: borrowRatePredictedRays,
          supplyRate: supplyRatePredictedRays
        },
        prices: {
          collateral: priceCollateral,
          borrow: priceBorrow,
        },
        period: {
          block0: next.block,
          blockTimestamp0: next.blockTimestamp,
          block1: last.block,
          blockTimestamp1: last.blockTimestamp,
        },
        resultRates: {
          borrowRate: next.borrow.data.currentVariableBorrowRate,
          supplyRate: next.collateral.data.currentLiquidityRate
        },
        resultAmounts: {
          supplyIncomeInBorrowTokens36: resultSupplyIncomeInBorrowTokens36,
          costBorrow36: resultCostBorrow36,
          apr18: resultApr18
        },
        points: pointsResults
      }
    }
  }

  /**
   * Calculate expected supply income (Rays) in the point before borrow
   * in assuming that the borrow will be made inside the current block
   */
  static async predictSupplyIncomeRays(
    deployer: SignerWithAddress,
    aavePool: IAaveTwoPool,
    collateralAsset: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    countBlocks: number,
    blocksPerDay: number,
    reserveData?: IAaveTwoReserveData,
    stateBeforeBorrow?: IAaveTwoStateInfo,
    operationTimestamp?: number
  ) : Promise<BigNumber> {
    console.log("predictSupplyApr36");
    console.log("collateralAmount", collateralAmount);
    console.log("countBlocks", countBlocks);
    const libFacade = await DeployUtils.deployContract(deployer, "AaveTwoAprLibFacade") as AaveTwoAprLibFacade;
    const dp = await AaveTwoHelper.getAaveProtocolDataProvider(deployer);

    const priceOracle = await AaveTwoHelper.getAavePriceOracle(deployer);
    const priceCollateral = await priceOracle.getAssetPrice(collateralAsset);
    const priceBorrow = await priceOracle.getAssetPrice(borrowAsset);

    const decimalsCollateral = await IERC20Extended__factory.connect(collateralAsset, deployer).decimals();
    const before = stateBeforeBorrow
      || (await getAaveTwoStateInfo(deployer
        , aavePool
        , collateralAsset
        , borrowAsset
      ));
    console.log("predictSupplyApr36.before", before);

    const collateralReserveData = reserveData || await dp.getReserveData(collateralAsset);
    console.log("predictSupplyApr36.collateralReserveData", collateralReserveData);

    const liquidityRateRaysPredicted = await libFacade.getLiquidityRateRays(
      before.collateral.data, // collateralAssetData,
      collateralAsset,
      collateralAmount,
      collateralReserveData.totalStableDebt,
      collateralReserveData.totalVariableDebt,
    );
    console.log("predictSupplyApr36.liquidityRateRaysPredicted", liquidityRateRaysPredicted);

    const state = {
      block: before.block,
      blockTimeStamp: before.blockTimestamp,
      rate: before.collateral.data.currentLiquidityRate,
      liquidityIndex: before.collateral.data.liquidityIndex,
      scaledBalance: BigNumber.from(0),
      reserveNormalized: before.collateral.reserveNormalized,
      userBalanceBase: BigNumber.from(0),
      lastUpdateTimestamp: before.collateral.data.lastUpdateTimestamp
    };
    const supplyIncome = await getCostValueBeforeAAVETwo(
      libFacade
      , collateralAmount
      , liquidityRateRaysPredicted
      , priceCollateral
      , countBlocks
      , state
      , blocksPerDay
      , operationTimestamp || before.blockTimestamp
      , decimalsCollateral
    );

    return supplyIncome.valueMultiplied18
      .mul(getBigNumberFrom(1, 18))
      .mul(priceCollateral)
      .div(priceBorrow)
      .div(getBigNumberFrom(1, decimalsCollateral));
  }

  /**
   * Calculate expected borrow cost (Rays) in the point before borrowing
   * in assuming that the borrow will be made inside the current block
   */
  static async predictBorrowCostRays(
    deployer: SignerWithAddress,
    aavePool: IAaveTwoPool,
    collateralAsset: string,
    borrowAsset: string,
    amountToBorrow: BigNumber,
    countBlocks: number,
    blocksPerDay: number,
    reserveData?: IAaveTwoReserveData,
    stateBeforeBorrow?: IAaveTwoStateInfo,
    operationTimestamp?: number
  ) : Promise<BigNumber> {
    const libFacade = await DeployUtils.deployContract(deployer, "AaveTwoAprLibFacade") as AaveTwoAprLibFacade;
    const dp = await AaveTwoHelper.getAaveProtocolDataProvider(deployer);

    const priceOracle = await AaveTwoHelper.getAavePriceOracle(deployer);
    const priceBorrow = await priceOracle.getAssetPrice(borrowAsset);

    const decimalsBorrow = await IERC20Extended__factory.connect(borrowAsset, deployer).decimals();
    const before = stateBeforeBorrow
      || (await getAaveTwoStateInfo(deployer
        , aavePool
        , collateralAsset
        , borrowAsset
      ));

    const borrowReserveData = reserveData || await dp.getReserveData(borrowAsset);

    const borrowRatePredictedRays = (await libFacade.getVariableBorrowRateRays(
      before.borrow.data,
      borrowAsset,
      amountToBorrow,
      borrowReserveData.totalStableDebt,
      borrowReserveData.totalVariableDebt,
    ));

    const state = {
      block: before.block,
      blockTimeStamp: before.blockTimestamp,
      rate: before.borrow.data.currentVariableBorrowRate,
      liquidityIndex: before.borrow.data.variableBorrowIndex,
      scaledBalance: BigNumber.from(0),
      reserveNormalized: before.borrow.reserveNormalized,
      userBalanceBase: BigNumber.from(0),
      lastUpdateTimestamp: before.borrow.data.lastUpdateTimestamp
    };
    const cost = await getCostValueBeforeAAVETwo(
      libFacade
      , amountToBorrow
      , borrowRatePredictedRays
      , priceBorrow
      , countBlocks
      , state
      , blocksPerDay
      , operationTimestamp || before.blockTimestamp
      , decimalsBorrow
    );

    console.log("predictBorrowApr36 borrowApr=", cost);
    console.log("amountToBorrow", amountToBorrow);
    console.log("brRaysPredicted", borrowRatePredictedRays);
    console.log("priceBorrow", priceBorrow);
    console.log("countBlocks", countBlocks);
    console.log("state", state);
    console.log("blocksPerDay", blocksPerDay);
    console.log("operationTimestamp", operationTimestamp || before.blockTimestamp);
    console.log("decimalsBorrow", decimalsBorrow);


    return cost.valueMultiplied18
      .mul(Misc.WEI)
      .div(getBigNumberFrom(1, decimalsBorrow));
  }
}
