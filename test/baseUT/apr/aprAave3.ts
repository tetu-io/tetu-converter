import {TokenDataTypes} from "../types/TokenDataTypes";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {
  Aave3AprLibFacade,
  IAavePool,
  IAaveProtocolDataProvider,
  IAaveToken__factory, IERC20Extended__factory
} from "../../../typechain";
import {
  convertUnits,
  IBaseToBorrowParams,
  makeBorrow, baseToBt
} from "./aprUtils";
import {Aave3PlatformFabric} from "../fabrics/Aave3PlatformFabric";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ITestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {Aave3DataTypes} from "../../../typechain/contracts/integrations/aave3/IAavePool";
import hre from "hardhat";
import {
  IAaveKeyState,
  IAaveKeyTestValues,
  IBorrowResults,
  IPointResults
} from "./aprDataTypes";
import {Misc} from "../../../scripts/utils/Misc";

//region Data types
interface IAaveReserveData {
  unbacked: BigNumber;
  accruedToTreasuryScaled: BigNumber;
  totalAToken: BigNumber;
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
interface IAave3AssetStateRaw {
  data: {
    configuration: Aave3DataTypes.ReserveConfigurationMapStructOutput;
    liquidityIndex: BigNumber;
    currentLiquidityRate: BigNumber;
    variableBorrowIndex: BigNumber;
    currentVariableBorrowRate: BigNumber;
    currentStableBorrowRate: BigNumber;
    lastUpdateTimestamp: number;
    id: number;
    aTokenAddress: string;
    stableDebtTokenAddress: string;
    variableDebtTokenAddress: string;
    interestRateStrategyAddress: string;
    accruedToTreasury: BigNumber;
    unbacked: BigNumber;
    isolationModeTotalDebt: BigNumber;
  },
  reserveData: IAaveReserveData,
  reserveNormalized: BigNumber,
  scaledBalance: BigNumber,
}

export interface IAave3UserAccountDataResults {
  totalCollateralBase: BigNumber;
  totalDebtBase: BigNumber;
  availableBorrowsBase: BigNumber;
  currentLiquidationThreshold: BigNumber;
  ltv: BigNumber;
  healthFactor: BigNumber;
}

interface IAave3StateInfo {
  collateral: IAave3AssetStateRaw;
  borrow: IAave3AssetStateRaw;
  block: number,
  blockTimestamp: number,
  userAccount?: IAave3UserAccountDataResults
}

export interface IAprAave3Results {
  /** State before borrow */
  before: IAave3StateInfo;
  /** State just after borrow */
  next: IAave3StateInfo;
  /** State just after borrow + 1 block */
  last: IAave3StateInfo;
  /** Borrower address */
  userAddress: string;
  /** Exact value of the borrowed amount */
  borrowAmount: BigNumber;

//// next : last  results

  /** Supply APR in terms of base currency calculated using predicted supply rate */
  supplyAprBaseExactMul18: BigNumber;
  /** Supply APR in terms of base currency calculated using exact supply rate taken from next step */
  supplyAprBaseApprox: BigNumber;
  /** Borrow APR in terms of base currency calculated using predicted borrow rate */
  borrowAprBaseExactMul18: BigNumber;
  /** borrow APR in terms of base currency calculated using exact borrow rate taken from next step */
  borrowAprBaseApprox: BigNumber;
  /** total increment of collateral amount from NEXT to LAST in terms of base currency */
  totalCollateralBaseDelta: BigNumber;
  /** total increment of borrowed amount from NEXT to LAST in terms of base currency */
  totalDebtBaseDelta: BigNumber;

  /**
   * Supply APR in terms of borrow currency calculated using predictSupplyApr18
   * (we need it to ensure that predictSupplyApr18 works fine)
   */
  predictedSupplyAprBt36: BigNumber;

  /**
   * Borrow APR in terms of borrow currency calculated using predictBorrowApr18
   * (we need it to ensure that predictBorrowApr18 works fine)
   */
  predictedBorrowAprBt36: BigNumber;

}
//endregion Data types

//region Utils
export async function getAave3StateInfo(
  deployer: SignerWithAddress,
  aavePool: IAavePool,
  dp: IAaveProtocolDataProvider,
  assetCollateral: string,
  assetBorrow: string,
  userAddress?: string,
) : Promise<IAave3StateInfo> {
  const block = await hre.ethers.provider.getBlock("latest");

  const userAccount = userAddress
    ? await aavePool.getUserAccountData(userAddress)
    : undefined;

  const reserveDataCollateral = await dp.getReserveData(assetCollateral);
  const reserveDataBorrow = await dp.getReserveData(assetBorrow);

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
      scaledBalance: collateralScaledBalance,
      reserveData: reserveDataCollateral
    },
    borrow: {
      data: borrowAssetDataAfterBorrow,
      reserveNormalized: borrowReserveNormalized,
      scaledBalance: borrowScaledBalance,
      reserveData: reserveDataBorrow
    }
  }
}

/*
 *  Calc APR in the state AFTER the supply/borrow operation
 *  Return value in terms of base currency
 */
export async function getAprAAVE3Base(
  libFacade: Aave3AprLibFacade,
  amount: BigNumber,
  predictedRate: BigNumber,
  price: BigNumber,
  countBlocks: number,
  state: IAaveKeyState,
  blocksPerDay: number,
  decimalsAmount: number,
  multiplier: BigNumber
) : Promise<BigNumber> {
  console.log("getAprAAVE3Base");
  console.log("amount", amount);
  console.log("predictedRate", predictedRate);
  console.log("price", price);
  console.log("countBlocks", countBlocks);
  console.log("state", state);
  console.log("blocksPerDay", blocksPerDay);
  console.log("decimalsAmount", decimalsAmount);
  const value = await libFacade.getAprForPeriodAfter(
    amount,
    state.reserveNormalized,
    state.liquidityIndex,
    predictedRate,
    countBlocks,
    blocksPerDay,
    multiplier
  );
  console.log("getAprAAVE3Base.value", value);
  return value
    .mul(price)
    .div(getBigNumberFrom(1, decimalsAmount))
  ;
}

/**
 * Calc APR in the state before the supply/borrow operation
 * Return value in terms of base currency
 */
export async function getAprBeforeAAVE3(
  libFacade: Aave3AprLibFacade,
  amount: BigNumber,
  predictedRate: BigNumber,
  price: BigNumber,
  countBlocks: number,
  state: IAaveKeyState,
  blocksPerDay: number,
  operationTimestamp: number,
  decimalsAmount: number,
) : Promise<{
   aprBase18: BigNumber,
   aprMultiplied18: BigNumber
}> {
  const value = await libFacade.getAprForPeriodBefore(
    {
      liquidityIndex: state.liquidityIndex,
      rate: state.rate,
      lastUpdateTimestamp: state.lastUpdateTimestamp
    },
    amount,
    predictedRate,
    countBlocks,
    blocksPerDay,
    operationTimestamp,
    Misc.WEI // multiplier to increase the precision
  );
  console.log("getAprBeforeAAVE3Base.getAprForPeriodBefore returns:", value);
  console.log("getAprBeforeAAVE3Base.blocksPerDay", blocksPerDay);
  console.log("getAprBeforeAAVE3Base.operationTimestamp", operationTimestamp);
  console.log("getAprBeforeAAVE3Base.countBlocks", countBlocks);
  console.log("getAprBeforeAAVE3Base.amount", amount);
  console.log("getAprBeforeAAVE3Base.predictedRate", predictedRate);
  console.log("getAprBeforeAAVE3Base.state.liquidityIndex", state.liquidityIndex);
  console.log("getAprBeforeAAVE3Base.state.lastUpdateTimestamp", state.lastUpdateTimestamp);
  console.log("getAprBeforeAAVE3Base.state.rate", state.rate);
  console.log("getAprBeforeAAVE3Base.price", price);
  console.log("getAprBeforeAAVE3Base.decimalsAmount", decimalsAmount);
  return {
    aprBase18: value
      .mul(price)
      .div(Misc.WEI)
      .div(getBigNumberFrom(1, decimalsAmount)),
    aprMultiplied18: value
  };
}
//endregion Utils

export class AprAave3 {
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
    details: IAprAave3Results,
    results: IBorrowResults
  }> {
    console.log("makeBorrowTest:", amountToBorrow0, p, additionalPoints);
    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const aavePool = await Aave3Helper.getAavePool(deployer);
    const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);
    const priceOracle = await Aave3Helper.getAavePriceOracle(deployer);
    const baseCurrencyDecimals = Math.log10((await priceOracle.BASE_CURRENCY_UNIT()).toNumber());

    const borrowReserveData = await dp.getReserveData(p.borrow.asset);
    const collateralReserveData = await dp.getReserveData(p.collateral.asset);
    console.log("collateralReserveData", collateralReserveData);
    console.log("borrowReserveData", borrowReserveData);

    const amountCollateral = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);
    console.log(`amountCollateral=${amountCollateral.toString()}`);

    // prices
    const prices = await priceOracle.getAssetsPrices([p.collateral.asset, p.borrow.asset]);
    const priceCollateral = prices[0];
    const priceBorrow = prices[1];
    console.log("priceCollateral", priceCollateral);
    console.log("priceBorrow", priceBorrow);

    // predict APR
    const libFacade = await DeployUtils.deployContract(deployer, "Aave3AprLibFacade") as Aave3AprLibFacade;

    // start point: we estimate APR in this point before borrow and supply
    const before = await getAave3StateInfo(deployer, aavePool, dp, p.collateral.asset, p.borrow.asset);

    // just for control: let's try to predict current borrow rays
    const liquidityRateRaysCurrentCalculated = await libFacade.getLiquidityRateRays(
      before.collateral.data, // collateralAssetData,
      p.collateral.asset,
      0, // no changes
      before.collateral.reserveData.totalStableDebt,
      before.collateral.reserveData.totalVariableDebt,
    );
    const brRaysCurrentCalculated = (await libFacade.getVariableBorrowRateRays(
      before.borrow.data, // borrowAssetData,
      p.borrow.asset,
      0, // no changes
      before.borrow.reserveData.totalStableDebt,
      before.borrow.reserveData.totalVariableDebt,
    ));
    console.log(`Current: liquidityRateRays=${liquidityRateRaysCurrentCalculated.toString()} brRays=${brRaysCurrentCalculated.toString()}`);

    // make borrow
    const borrowResults = await makeBorrow(deployer
      , p
      , getBigNumberFrom(amountToBorrow0, borrowToken.decimals)
      , new Aave3PlatformFabric()
    );
    const userAddress = borrowResults.poolAdapter;
    const borrowAmount = borrowResults.borrowAmount;
    console.log(`userAddress=${userAddress} borrowAmount=${borrowAmount}`);

    // predict borrow and supply rates after borrow
    const liquidityRateRaysPredicted = await libFacade.getLiquidityRateRays(
      before.collateral.data, // collateralAssetData,
      p.collateral.asset,
      amountCollateral,
      collateralReserveData.totalStableDebt,
      collateralReserveData.totalVariableDebt,
    );
    const brRaysPredicted = (await libFacade.getVariableBorrowRateRays(
      before.borrow.data, // borrowAssetData,
      p.borrow.asset,
      borrowAmount,
      borrowReserveData.totalStableDebt,
      borrowReserveData.totalVariableDebt
    ));
    console.log(`Predicted: liquidityRateRays=${liquidityRateRaysPredicted.toString()} brRays=${brRaysPredicted.toString()}`);

    // next => last
    const next = await getAave3StateInfo(deployer, aavePool, dp, p.collateral.asset, p.borrow.asset, userAddress);
    await TimeUtils.advanceNBlocks(p.countBlocks);
    const last = await getAave3StateInfo(deployer, aavePool, dp, p.collateral.asset, p.borrow.asset, userAddress);

    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;
    console.log("before", before);
    console.log("next", next);
    console.log("last", last);

    const keyValues: IAaveKeyTestValues = {
      borrowRatePredicted: brRaysPredicted,
      liquidityRatePredicted: liquidityRateRaysPredicted,

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
          userBalanceBase: next.userAccount?.totalCollateralBase || BigNumber.from(0),
          lastUpdateTimestamp: next.collateral.data.lastUpdateTimestamp
        },
        last: {
          block: last.block,
          blockTimeStamp: last.blockTimestamp,
          rate: last.collateral.data.currentLiquidityRate,
          liquidityIndex: last.collateral.data.liquidityIndex,
          scaledBalance: last.collateral.scaledBalance,
          reserveNormalized: last.collateral.reserveNormalized,
          userBalanceBase: last.userAccount?.totalCollateralBase || BigNumber.from(0),
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
          userBalanceBase: next.userAccount?.totalDebtBase || BigNumber.from(0),
          lastUpdateTimestamp: next.borrow.data.lastUpdateTimestamp
        },
        last: {
          block: last.block,
          blockTimeStamp: last.blockTimestamp,
          rate: last.borrow.data.currentVariableBorrowRate,
          liquidityIndex: last.borrow.data.variableBorrowIndex,
          scaledBalance: last.borrow.scaledBalance,
          reserveNormalized: last.borrow.reserveNormalized,
          userBalanceBase: last.userAccount?.totalDebtBase || BigNumber.from(0),
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

    const supplyAprBaseExactMul18 = await getAprAAVE3Base(
      libFacade
      , amountCollateral
      , next.collateral.data.currentLiquidityRate
      , priceCollateral
      , countBlocks
      , keyValues.liquidity.next
      , blocksPerDay
      , collateralToken.decimals
      , getBigNumberFrom(1, 18)
    );
    console.log("supplyAprBaseExactMul18", supplyAprBaseExactMul18);
    const borrowAprBaseExactMul18 = await getAprAAVE3Base(
      libFacade
      , borrowAmount
      , next.borrow.data.currentVariableBorrowRate
      , priceBorrow
      , countBlocks
      , keyValues.borrow.next
      , blocksPerDay
      , borrowToken.decimals
      , Misc.WEI
    );
    console.log("borrowAprBaseExactMul18", borrowAprBaseExactMul18);

    // calculate approx values of supply/borrow APR
    // we use state-values "before-borrow" and predicted values of supply/borrow rates after borrow
    const supplyAprBaseApprox = (await getAprBeforeAAVE3(
      libFacade
      , amountCollateral
      , liquidityRateRaysPredicted
      , priceCollateral
      , countBlocks
      , keyValues.liquidity.beforeBorrow
      , blocksPerDay
      , keyValues.liquidity.next.blockTimeStamp
      , collateralToken.decimals
    ));
    console.log("supplyAprBaseApprox", supplyAprBaseApprox);

    const borrowAprBaseApprox = (await getAprBeforeAAVE3(
      libFacade
      , borrowAmount
      , brRaysPredicted
      , priceBorrow
      , countBlocks
      , keyValues.borrow.beforeBorrow
      , blocksPerDay
      , keyValues.borrow.next.blockTimeStamp
      , borrowToken.decimals
    ));
    console.log("borrowAprBaseApprox", borrowAprBaseApprox);

    const totalCollateralBaseDelta = (last.userAccount?.totalCollateralBase || BigNumber.from(0)).sub(
      (next.userAccount?.totalCollateralBase || BigNumber.from(0))
    );
    const totalDebtBaseDelta = (last.userAccount?.totalDebtBase || BigNumber.from(0)).sub(
      (next.userAccount?.totalDebtBase || BigNumber.from(0))
    );
    console.log("totalCollateralBaseDelta", totalCollateralBaseDelta);
    console.log("totalDebtBaseDelta", totalDebtBaseDelta);

    const bbp: IBaseToBorrowParams = {
      baseCurrencyDecimals,
      priceBaseCurrency: priceBorrow,
      priceDecimals: baseCurrencyDecimals // all prices in AAVE v3 are in base currency
    }

    const pointsResults: IPointResults[] = [];
    const prev = last;
    for (const period of additionalPoints) {
      await TimeUtils.advanceNBlocks(period);
      const current = await getAave3StateInfo(deployer, aavePool, dp, p.collateral.asset, p.borrow.asset, userAddress);

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
          collateral: current.userAccount?.totalCollateralBase || BigNumber.from(0),
          borrow: current.userAccount?.totalDebtBase || BigNumber.from(0)
        },
        costsBT36: {
          collateral: baseToBt(
            (current.userAccount?.totalCollateralBase || BigNumber.from(0))
              .sub(prev.userAccount?.totalCollateralBase || BigNumber.from(0)),
            bbp,
            36
          ),
          borrow: baseToBt(
            (current.userAccount?.totalDebtBase || BigNumber.from(0))
              .sub(prev.userAccount?.totalDebtBase || BigNumber.from(0)),
            bbp,
            36,
          ),
        }
      })
    }

    // let's check how predictSupplyApr18 works
    const predictedSupplyAprBt36 = await this.predictSupplyApr36(deployer
      , aavePool
      , collateralToken.address
      , amountCollateral
      , borrowToken.address
      , countBlocks
      , blocksPerDay
      , collateralReserveData
      , before
      , keyValues.borrow.next.blockTimeStamp
    );
    console.log("predictedSupplyAprBT18", predictedSupplyAprBt36);

    const predictedBorrowAprBt36 = await this.predictBorrowApr36(deployer
      , aavePool
      , collateralToken.address
      , borrowToken.address
      , borrowAmount
      , countBlocks
      , blocksPerDay
      , borrowReserveData
      , before
      , keyValues.borrow.next.blockTimeStamp
    );
    console.log("predictedBorrowAprBT18", predictedBorrowAprBt36);

    return {
      details: {
        borrowAmount,
        before,
        borrowAprBaseApprox: borrowAprBaseApprox.aprBase18,
        totalCollateralBaseDelta,
        totalDebtBaseDelta,
        last,
        next,
        borrowAprBaseExactMul18,
        supplyAprBaseApprox: supplyAprBaseApprox.aprBase18,
        supplyAprBaseExactMul18,
        userAddress,
        predictedSupplyAprBt36,
        predictedBorrowAprBt36,
      },
      results: {
        init: {
          borrowAmount,
          collateralAmount: amountCollateral,
          collateralAmountBT18: convertUnits(
            amountCollateral
            , priceCollateral, collateralToken.decimals
            , priceBorrow, 18
          )
        },
        predicted: {
          aprBt36: {
            collateral: supplyAprBaseApprox.aprMultiplied18
              .mul(Misc.WEI)
              .mul(priceCollateral)
              .div(priceBorrow)
              .div(getBigNumberFrom(1, collateralToken.decimals)),
            borrow: borrowAprBaseApprox.aprMultiplied18
              .mul(Misc.WEI)
              .div(getBigNumberFrom(1, borrowToken.decimals)),
          },
          rates: {
            borrowRate: brRaysPredicted,
            supplyRate: liquidityRateRaysPredicted
          }
        },
        prices: {
          collateral: priceCollateral,
          borrow: priceBorrow,
        },
        resultsBlock: {
          period: {
            block0: next.block,
            blockTimestamp0: next.blockTimestamp,
            block1: last.block,
            blockTimestamp1: last.blockTimestamp,
          },
          rates: {
            borrowRate: next.borrow.data.currentVariableBorrowRate,
            supplyRate: next.collateral.data.currentLiquidityRate
          },
          aprBt36: {
            collateral: baseToBt(totalCollateralBaseDelta, bbp, 36),
            borrow: baseToBt(totalDebtBaseDelta, bbp, 36)
          }
        },
        points: pointsResults
      }
    }
  }

  /**
   * Calculate expected supply-apr-18 in the point before borrow
   * in assuming that the borrow will be made inside the current block
   */
  static async predictSupplyApr36(
    deployer: SignerWithAddress,
    aavePool: IAavePool,
    collateralAsset: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    countBlocks: number,
    blocksPerDay: number,
    reserveData?: IAaveReserveData,
    stateBeforeBorrow?: IAave3StateInfo,
    operationTimestamp?: number
  ) : Promise<BigNumber> {
    // console.log("predictSupplyApr36");
    // console.log("collateralAmount", collateralAmount);
    // console.log("countBlocks", countBlocks);
    const libFacade = await DeployUtils.deployContract(deployer, "Aave3AprLibFacade") as Aave3AprLibFacade;
    const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);

    const priceOracle = await Aave3Helper.getAavePriceOracle(deployer);
    const priceCollateral = await priceOracle.getAssetPrice(collateralAsset);
    const priceBorrow = await priceOracle.getAssetPrice(borrowAsset);

    const decimalsCollateral = await IERC20Extended__factory.connect(collateralAsset, deployer).decimals();
    const before = stateBeforeBorrow
      || (await getAave3StateInfo(deployer
        , aavePool
        , dp
        , collateralAsset
        , borrowAsset
      ));
    // console.log("predictSupplyApr18.before", before);

    const collateralReserveData = reserveData || await dp.getReserveData(collateralAsset);
    // console.log("predictSupplyApr36.collateralReserveData", collateralReserveData);

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
    const supplyApr = await getAprBeforeAAVE3(
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
    // console.log("predictSupplyApr36.supplyApr=", supplyApr);
    // console.log("collateralAmount", collateralAmount);
    // console.log("liquidityRateRaysPredicted", liquidityRateRaysPredicted);
    // console.log("priceCollateral", priceCollateral);
    // console.log("countBlocks", countBlocks);
    // console.log("state", state);
    // console.log("blocksPerDay", blocksPerDay);
    // console.log("operationTimestamp", operationTimestamp || before.blockTimestamp);
    // console.log("decimalsCollateral", decimalsCollateral);

    const baseCurrencyDecimals = Math.log10((await priceOracle.BASE_CURRENCY_UNIT()).toNumber());
    const bbp: IBaseToBorrowParams = {
      baseCurrencyDecimals,
      priceBaseCurrency: priceBorrow,
      priceDecimals: baseCurrencyDecimals // all prices in AAVE v3 are in base currency
    }

    return supplyApr.aprMultiplied18
      .mul(getBigNumberFrom(1, 18))
      .mul(priceCollateral)
      .div(priceBorrow)
      .div(getBigNumberFrom(1, decimalsCollateral));
  }

  /**
   * Calculate expected borrow-apr-36 in the point before borrow
   * in assuming that the borrow will be made inside the current block
   */
  static async predictBorrowApr36(
    deployer: SignerWithAddress,
    aavePool: IAavePool,
    collateralAsset: string,
    borrowAsset: string,
    amountToBorrow: BigNumber,
    countBlocks: number,
    blocksPerDay: number,
    reserveData?: IAaveReserveData,
    stateBeforeBorrow?: IAave3StateInfo,
    operationTimestamp?: number
  ) : Promise<BigNumber> {
    const libFacade = await DeployUtils.deployContract(deployer, "Aave3AprLibFacade") as Aave3AprLibFacade;
    const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);

    const priceOracle = await Aave3Helper.getAavePriceOracle(deployer);
    const priceBorrow = await priceOracle.getAssetPrice(borrowAsset);

    const decimalsBorrow = await IERC20Extended__factory.connect(borrowAsset, deployer).decimals();
    const before = stateBeforeBorrow
      || (await getAave3StateInfo(deployer
        , aavePool
        , dp
        , collateralAsset
        , borrowAsset
      ));

    const borrowReserveData = reserveData || await dp.getReserveData(borrowAsset);

    const brRaysPredicted = (await libFacade.getVariableBorrowRateRays(
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
    const borrowApr = await getAprBeforeAAVE3(
      libFacade
      , amountToBorrow
      , brRaysPredicted
      , priceBorrow
      , countBlocks
      , state
      , blocksPerDay
      , operationTimestamp || before.blockTimestamp
      , decimalsBorrow
    );

    const baseCurrencyDecimals = Math.log10((await priceOracle.BASE_CURRENCY_UNIT()).toNumber());
    const bbp: IBaseToBorrowParams = {
      baseCurrencyDecimals,
      priceBaseCurrency: priceBorrow,
      priceDecimals: baseCurrencyDecimals // all prices in AAVE v3 are in base currency
    }

    // console.log("predictBorrowApr36 borrowApr=", borrowApr);
    // console.log("amountToBorrow", amountToBorrow);
    // console.log("brRaysPredicted", brRaysPredicted);
    // console.log("priceBorrow", priceBorrow);
    // console.log("countBlocks", countBlocks);
    // console.log("state", state);
    // console.log("blocksPerDay", blocksPerDay);
    // console.log("operationTimestamp", operationTimestamp || before.blockTimestamp);
    // console.log("decimalsBorrow", decimalsBorrow);

    return borrowApr.aprMultiplied18
      .mul(Misc.WEI)
      .div(getBigNumberFrom(1, decimalsBorrow));
  }
}