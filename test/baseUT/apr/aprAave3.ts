import {TokenDataTypes} from "../types/TokenDataTypes";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {
  Aave3AprLibFacade,
  IAavePool,
  IAaveProtocolDataProvider,
  IAaveToken__factory
} from "../../../typechain";
import {
  baseToBorrow18, prepareExactBorrowAmount,
  convertUnits,
  IBaseToBorrowParams,
  makeBorrow
} from "./aprUtils";
import {Aave3PlatformFabric} from "../fabrics/Aave3PlatformFabric";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {Aave3DataTypes} from "../../../typechain/contracts/integrations/aave3/IAavePool";
import hre from "hardhat";
import {
  IAaveKeyState,
  IAaveKeyTestValues,
  IBorrowResults,
  IPointResults
} from "./aprDataTypes";
import {ConfigurableAmountToBorrow} from "./ConfigurableAmountToBorrow";

const ray = getBigNumberFrom(1, 36);
const base = getBigNumberFrom(1, 18);

//region Data types
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
  reserveData: {
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
  reserveNormalized: BigNumber,
  scaledBalance: BigNumber,
}

interface IAave3StateInfo {
  collateral: IAave3AssetStateRaw;
  borrow: IAave3AssetStateRaw;
  block: number,
  blockTimestamp: number,
  userAccount?: {
    totalCollateralBase: BigNumber;
    totalDebtBase: BigNumber;
    availableBorrowsBase: BigNumber;
    currentLiquidationThreshold: BigNumber;
    ltv: BigNumber;
    healthFactor: BigNumber;
  }
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
  supplyAprBaseExact: BigNumber;
  /** Supply APR in terms of base currency calculated using exact supply rate taken from next step */
  supplyAprBaseApprox: BigNumber;
  /** Borrow APR in terms of base currency calculated using predicted borrow rate */
  borrowAprBaseExact: BigNumber;
  /** borrow APR in terms of base currency calculated using exact borrow rate taken from next step */
  borrowAprBaseApprox: BigNumber;
  /** total increment of collateral amount from NEXT to LAST in terms of base currency */
  totalCollateralBaseDelta: BigNumber;
  /** total increment of borrowed amount from NEXT to LAST in terms of base currency */
  totalDebtBaseDelta: BigNumber;

}
//endregion Data types

//region Utils
async function getAave3StateInfo(
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
    userAccount: userAccount,
    block: block.number,
    blockTimestamp: block.timestamp,
    collateral: {
      data: collateralAssetData,
      reserveNormalized: reserveNormalized,
      scaledBalance: collateralScaledBalance,
      reserveData: reserveDataCollateral
    }, borrow: {
      data: borrowAssetDataAfterBorrow,
      reserveNormalized: borrowReserveNormalized,
      scaledBalance: borrowScaledBalance,
      reserveData: reserveDataBorrow
    }
  }
}

/** Calc APR in the state AFTER the supply/borrow operation
 *  Return value in terms of base currency
 * */
async function getAprAAVE3Base(
  libFacade: Aave3AprLibFacade,
  amount: BigNumber,
  predictedRate: BigNumber,
  price: BigNumber,
  countBlocks: number,
  state: IAaveKeyState,
  blocksPerDay: number,
  decimalsAmount: number,
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
    blocksPerDay
  );
  console.log("getAprAAVE3Base", value);
  return value
    .mul(price)
    .div(getBigNumberFrom(1, decimalsAmount))
  ;
}

/** Calc APR in the state before the supply/borrow operation
 * Return value in terms of base currency
 * */
async function getAprBeforeAAVE3Base(
  libFacade: Aave3AprLibFacade,
  amount: BigNumber,
  predictedRate: BigNumber,
  price: BigNumber,
  countBlocks: number,
  state: IAaveKeyState,
  blocksPerDay: number,
  operationTimestamp: number,
  decimalsAmount: number,
) : Promise<BigNumber> {
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
    operationTimestamp
  );
  console.log("getAprBeforeAAVE3Base", value);
  return value
    .mul(price)
    .div(getBigNumberFrom(1, decimalsAmount))
  ;
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
    deployer: SignerWithAddress
    , amountToBorrow0: ConfigurableAmountToBorrow
    , p: TestSingleBorrowParams
    , additionalPoints: number[]
  ) : Promise<{
    details: IAprAave3Results
    , results: IBorrowResults
  }> {
    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const h: Aave3Helper = new Aave3Helper(deployer);
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
      , prepareExactBorrowAmount(amountToBorrow0, borrowToken.decimals)
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
          userBalanceBase: next.userAccount!.totalCollateralBase,
          lastUpdateTimestamp: next.collateral.data.lastUpdateTimestamp
        },
        last: {
          block: last.block,
          blockTimeStamp: last.blockTimestamp,
          rate: last.collateral.data.currentLiquidityRate,
          liquidityIndex: last.collateral.data.liquidityIndex,
          scaledBalance: last.collateral.scaledBalance,
          reserveNormalized: last.collateral.reserveNormalized,
          userBalanceBase: last.userAccount!.totalCollateralBase,
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
          userBalanceBase: next.userAccount!.totalDebtBase,
          lastUpdateTimestamp: next.borrow.data.lastUpdateTimestamp
        },
        last: {
          block: last.block,
          blockTimeStamp: last.blockTimestamp,
          rate: last.borrow.data.currentVariableBorrowRate,
          liquidityIndex: last.borrow.data.variableBorrowIndex,
          scaledBalance: last.borrow.scaledBalance,
          reserveNormalized: last.borrow.reserveNormalized,
          userBalanceBase: last.userAccount!.totalDebtBase,
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

    const supplyAprBaseExact = await getAprAAVE3Base(
      libFacade
      , amountCollateral
      , next.collateral.data.currentLiquidityRate
      , priceCollateral
      , countBlocks
      , keyValues.liquidity.next
      , blocksPerDay
      , collateralToken.decimals
    );
    console.log("supplyAprExactRay", supplyAprBaseExact);
    const borrowAprBaseExact = await getAprAAVE3Base(
      libFacade
      , borrowAmount
      , next.borrow.data.currentVariableBorrowRate
      , priceBorrow
      , countBlocks
      , keyValues.borrow.next
      , blocksPerDay
      , borrowToken.decimals
    );
    console.log("borrowAprExact", borrowAprBaseExact);

    // calculate approx values of supply/borrow APR
    // we use state-values "before-borrow" and predicted values of supply/borrow rates after borrow
    const supplyAprBaseApprox = await getAprBeforeAAVE3Base(
      libFacade
      , amountCollateral
      , liquidityRateRaysPredicted
      , priceCollateral
      , countBlocks
      , keyValues.liquidity.beforeBorrow
      , blocksPerDay
      , keyValues.liquidity.next.blockTimeStamp
      , collateralToken.decimals
    );
    console.log("supplyAprBaseApprox", supplyAprBaseApprox);

    const borrowAprBaseApprox = await getAprBeforeAAVE3Base(
      libFacade
      , borrowAmount
      , brRaysPredicted
      , priceBorrow
      , countBlocks
      , keyValues.borrow.beforeBorrow
      , blocksPerDay
      , keyValues.borrow.next.blockTimeStamp
      , borrowToken.decimals
    );
    console.log("borrowAprBaseApprox", borrowAprBaseApprox);

    const totalCollateralBaseDelta = last.userAccount!.totalCollateralBase.sub(
      next.userAccount!.totalCollateralBase
    );
    const totalDebtBaseDelta = last.userAccount!.totalDebtBase.sub(
      next.userAccount!.totalDebtBase
    );
    console.log("totalCollateralBaseDelta", totalCollateralBaseDelta);
    console.log("totalDebtBaseDelta", totalDebtBaseDelta);

    const bbp: IBaseToBorrowParams = {
      baseCurrencyDecimals: baseCurrencyDecimals,
      priceBaseCurrency: priceBorrow,
      priceDecimals: baseCurrencyDecimals // all prices in AAVE v3 are in base currency
    }

    const pointsResults: IPointResults[] = [];
    let prev = last;
    for (const period of additionalPoints) {
      await TimeUtils.advanceNBlocks(period);
      let current = await getAave3StateInfo(deployer, aavePool, dp, p.collateral.asset, p.borrow.asset, userAddress);

      pointsResults.push({
        period: {
          block0: prev.block,
          blockTimestamp0: prev.blockTimestamp,
          block1: current.block,
          blockTimestamp1: current.blockTimestamp,
        }, rates: {
          supplyRate: current.collateral.data.currentLiquidityRate,
          borrowRate: current.borrow.data.currentVariableBorrowRate
        }, balances: {
          collateral: current.userAccount!.totalCollateralBase,
          borrow: current.userAccount!.totalDebtBase
        }, costsBT18: {
          collateral: baseToBorrow18(
            current.userAccount!.totalCollateralBase.sub(prev.userAccount!.totalCollateralBase)
            , bbp
          ),
          borrow: baseToBorrow18(
            current.userAccount!.totalDebtBase.sub(prev.userAccount!.totalDebtBase)
            , bbp
          ),
        }
      })
    }

    return {
      details: {
        borrowAmount
        , before
        , borrowAprBaseApprox
        , totalCollateralBaseDelta
        , totalDebtBaseDelta
        , last
        , next
        , borrowAprBaseExact
        , supplyAprBaseApprox
        , supplyAprBaseExact
        , userAddress
      }, results: {
        init: {
          borrowAmount: borrowAmount,
          collateralAmount: amountCollateral,
          collateralAmountBT18: convertUnits(
            amountCollateral
            , priceCollateral, collateralToken.decimals
            , priceBorrow, 18
          )
        }, predicted: {
          aprBT18: {
            collateral: baseToBorrow18(supplyAprBaseApprox, bbp),
            borrow: baseToBorrow18(borrowAprBaseApprox, bbp)
          },
          rates: {
            borrowRate: brRaysPredicted,
            supplyRate: liquidityRateRaysPredicted
          }
        }, prices: {
          collateral: priceCollateral,
          borrow: priceBorrow,
        }, resultsBlock: {
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
          aprBT18: {
            collateral: baseToBorrow18(totalCollateralBaseDelta, bbp),
            borrow: baseToBorrow18(totalDebtBaseDelta, bbp)
          }
        },
        points: pointsResults
      }
    }
  }
}