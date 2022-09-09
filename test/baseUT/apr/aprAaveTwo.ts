import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {
  IAaveKeyState,
  IAaveKeyTestValues,
  IBorrowResults,
  IPointResults
} from "./aprDataTypes";
import {DataTypes, IAaveTwoPool} from "../../../typechain/contracts/integrations/aaveTwo/IAaveTwoPool";
import hre from "hardhat";
import {AaveTwoAprLibFacade, IAaveToken__factory, IERC20__factory, IERC20Extended__factory} from "../../../typechain";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {AaveTwoHelper} from "../../../scripts/integration/helpers/AaveTwoHelper";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {
  baseToBorrow18, prepareExactBorrowAmount,
  convertUnits,
  IBaseToBorrowParams,
  makeBorrow
} from "./aprUtils";
import {AaveTwoPlatformFabric} from "../fabrics/AaveTwoPlatformFabric";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ConfigurableAmountToBorrow} from "./ConfigurableAmountToBorrow";

//region Data types
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

interface IAaveTwoStateInfo {
  collateral: IAaveTwoAssetStateRaw;
  borrow: IAaveTwoAssetStateRaw;
  block: number,
  blockTimestamp: number,
  userAccount?: {
    totalCollateralETH: BigNumber;
    totalDebtETH: BigNumber;
    availableBorrowsETH: BigNumber;
    currentLiquidationThreshold: BigNumber;
    ltv: BigNumber;
    healthFactor: BigNumber;
  }
}

interface IAprData {
  apr: BigNumber,
  nextLiquidityIndex: BigNumber
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
  supplyAprBaseExact: BigNumber;
  /** Supply APR in terms of base currency calculated using exact supply rate taken from next step */
  supplyAprBaseApprox: IAprData;
  /** Borrow APR in terms of base currency calculated using predicted borrow rate */
  borrowAprBaseExact: BigNumber;
  /** borrow APR in terms of base currency calculated using exact borrow rate taken from next step */
  borrowAprBaseApprox: IAprData;
  /** total increment of collateral amount from NEXT to LAST in terms of base currency */
  totalCollateralETH: BigNumber;
  /** total increment of borrowed amount from NEXT to LAST in terms of base currency */
  totalDebtETH: BigNumber;


  keyValues: IAaveKeyTestValues;
}
//endregion Data types

//region Utils
async function getAaveTwoStateInfo(
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
    userAccount: userAccount,
    block: block.number,
    blockTimestamp: block.timestamp,
    collateral: {
      data: collateralAssetData,
      reserveNormalized: reserveNormalized,
      scaledBalance: collateralScaledBalance
    }, borrow: {
      data: borrowAssetDataAfterBorrow,
      reserveNormalized: borrowReserveNormalized,
      scaledBalance: borrowScaledBalance
    }
  }
}

/** Calc APR in the state AFTER the supply/borrow operation
 * Return value in terms of base currency
 * */
async function getAprAAVETwoBase(
  libFacade: AaveTwoAprLibFacade,
  amount: BigNumber,
  predictedRate: BigNumber,
  price: BigNumber,
  countBlocks: number,
  state: IAaveKeyState,
  blocksPerDay: number,
  decimalsAmount: number,
) : Promise<BigNumber> {
  const value = await libFacade.getAprForPeriodAfter(
    amount,
    state.reserveNormalized,
    state.liquidityIndex,
    predictedRate,
    countBlocks,
    blocksPerDay,
  );
  console.log("getAprAAVETwoBase", value);
  return (value)
    .mul(price)
    .div(getBigNumberFrom(1, decimalsAmount))
    ;

}

/** Calc APR in the state BEFORE the supply/borrow operation
 * Return value in terms of base currency
 * */
async function getAprBeforeAAVETwoBase(
  libFacade: AaveTwoAprLibFacade,
  amount: BigNumber,
  predictedRate: BigNumber,
  price: BigNumber,
  countBlocks: number,
  state: IAaveKeyState,
  blocksPerDay: number,
  operationTimestamp: number,
  decimalsAmount: number,
) : Promise<IAprData> {
  const st = {
    liquidityIndex: state.liquidityIndex,
    rate: state.rate,
    lastUpdateTimestamp: state.lastUpdateTimestamp
  };

  const nextLiquidityIndex = await libFacade.getNextLiquidityIndex(st, operationTimestamp);
  const value = await libFacade.getAprForPeriodBefore(
    st,
    amount,
    predictedRate,
    countBlocks,
    blocksPerDay,
    operationTimestamp
  );
  console.log("getAprAAVETwoBase", value);
  return {
    apr: value.mul(price).div(getBigNumberFrom(1, decimalsAmount))
    , nextLiquidityIndex
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
    deployer: SignerWithAddress
    , amountToBorrow0: ConfigurableAmountToBorrow
    , p: TestSingleBorrowParams
    , additionalPoints: number[]
  ) : Promise<{
    details: IAprAaveTwoResults
    , results: IBorrowResults
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
      deployer
      , p
      , prepareExactBorrowAmount(amountToBorrow0, borrowToken.decimals)
      , new AaveTwoPlatformFabric()
    );
    const userAddress = borrowResults.poolAdapter;
    const borrowAmount = borrowResults.borrowAmount;
    console.log(`userAddress=${userAddress} borrowAmount=${borrowAmount}`);

    const liquidityRateRaysPredicted = await libFacade.getLiquidityRateRays(
      before.collateral.data,
      p.collateral.asset,
      amountCollateral,
      collateralReserveData.totalStableDebt,
      collateralReserveData.totalVariableDebt,
    );
    const brRaysPredicted = (await libFacade.getVariableBorrowRateRays(
      before.borrow.data,
      p.borrow.asset,
      borrowAmount,
      borrowReserveData.totalStableDebt,
      borrowReserveData.totalVariableDebt
    ));
    console.log(`Predicted: liquidityRateRays=${liquidityRateRaysPredicted.toString()} brRays=${brRaysPredicted.toString()}`);

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
          userBalanceBase: next.userAccount!.totalCollateralETH,
          lastUpdateTimestamp: next.collateral.data.lastUpdateTimestamp
        },
        last: {
          block: last.block,
          blockTimeStamp: last.blockTimestamp,
          rate: last.collateral.data.currentLiquidityRate,
          liquidityIndex: last.collateral.data.liquidityIndex,
          scaledBalance: last.collateral.scaledBalance,
          reserveNormalized: last.collateral.reserveNormalized,
          userBalanceBase: last.userAccount!.totalCollateralETH,
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
          userBalanceBase: next.userAccount!.totalDebtETH,
          lastUpdateTimestamp: next.borrow.data.lastUpdateTimestamp
        },
        last: {
          block: last.block,
          blockTimeStamp: last.blockTimestamp,
          rate: last.borrow.data.currentVariableBorrowRate,
          liquidityIndex: last.borrow.data.variableBorrowIndex,
          scaledBalance: last.borrow.scaledBalance,
          reserveNormalized: last.borrow.reserveNormalized,
          userBalanceBase: last.userAccount!.totalDebtETH,
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

    const supplyAprBaseExact = await getAprAAVETwoBase(
      libFacade
      , amountCollateral
      , liquidityRateRaysPredicted
      , priceCollateral
      , countBlocks
      , keyValues.liquidity.next
      , blocksPerDay
      , collateralToken.decimals
    );
    console.log("supplyAprBaseExact", supplyAprBaseExact);
    const borrowAprBaseExact = await getAprAAVETwoBase(
      libFacade
      , borrowAmount
      , next.borrow.data.currentVariableBorrowRate
      , priceBorrow
      , countBlocks
      , keyValues.borrow.next
      , blocksPerDay
      , borrowToken.decimals
    );
    console.log("borrowAprBaseExact", borrowAprBaseExact);

    // calculate approx values of supply/borrow APR
    // we use state-values "before-borrow" and predicted values of supply/borrow rates after borrow
    const supplyAprBaseApprox = await getAprBeforeAAVETwoBase(
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
    console.log("supplyAprApprox", supplyAprBaseApprox);
    const borrowAprBaseApprox = await getAprBeforeAAVETwoBase(
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
    console.log("borrowAprApprox", borrowAprBaseApprox);

    // calculate real differences in user-account-balances for period [next block, last block]
    const totalCollateralETH = last.userAccount!.totalCollateralETH.sub(next.userAccount!.totalCollateralETH);
    const totalDebtETH = last.userAccount!.totalDebtETH.sub(next.userAccount!.totalDebtETH);
    console.log("collateralAprETH", totalCollateralETH);
    console.log("borrowAprETH", totalDebtETH);

    const bbp: IBaseToBorrowParams = {
      baseCurrencyDecimals: baseCurrencyDecimals,
      priceBaseCurrency: priceBorrow,
      priceDecimals: baseCurrencyDecimals // all prices in AAVE TWO are in ETH
    }

    const pointsResults: IPointResults[] = [];
    let prev = last;
    for (const period of additionalPoints) {
      await TimeUtils.advanceNBlocks(period);
      let current = await getAaveTwoStateInfo(deployer, aavePool, p.collateral.asset, p.borrow.asset, userAddress);

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
          collateral: current.userAccount!.totalCollateralETH,
          borrow: current.userAccount!.totalDebtETH
        }, costsBT18: {
          collateral: baseToBorrow18(
            current.userAccount!.totalCollateralETH.sub(prev.userAccount!.totalCollateralETH)
            , bbp
          ),
          borrow: baseToBorrow18(
            current.userAccount!.totalDebtETH.sub(prev.userAccount!.totalDebtETH)
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
        , last
        , borrowAprBaseExact
        , next
        , supplyAprBaseApprox
        , keyValues
        , supplyAprBaseExact
        , userAddress
        , totalCollateralETH
        , totalDebtETH
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
            collateral: baseToBorrow18(supplyAprBaseApprox.apr, bbp),
            borrow: baseToBorrow18(borrowAprBaseApprox.apr, bbp)
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
            collateral: baseToBorrow18(totalCollateralETH, bbp),
            borrow: baseToBorrow18(totalDebtETH, bbp)
          }
        },
        points: pointsResults
      }
    }
  }
}
