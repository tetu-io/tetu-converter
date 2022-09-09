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
import {baseToBorrow18, ConfigurableAmountToBorrow, convertUnits, IBaseToBorrowParams, makeBorrow} from "./aprUtils";
import {Aave3PlatformFabric} from "../fabrics/Aave3PlatformFabric";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {Aave3DataTypes} from "../../../typechain/contracts/integrations/aave3/IAavePool";
import hre from "hardhat";
import {IAaveKeyState, IAaveKeyTestValues, IBorrowResults, IPointResults} from "./aprDataTypes";

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

/** Calc APR in the state this.before the supply/borrow operation
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
  /** State before borrow */
  before: IAave3StateInfo | undefined;
  /** State just after borrow */
  next: IAave3StateInfo | undefined;
  /** State just after borrow + 1 block */
  last: IAave3StateInfo | undefined;
  /** Borrower address */
  userAddress: string | undefined;
  /** Exact value of the borrowed amount */
  borrowAmount: BigNumber = BigNumber.from(0);

//// next : last  results

  /** Supply APR in terms of base currency calculated using predicted supply rate */
  supplyAprBaseExact: BigNumber | undefined;
  /** Supply APR in terms of base currency calculated using exact supply rate taken from next step */
  supplyAprBaseApprox: BigNumber | undefined;
  /** Borrow APR in terms of base currency calculated using predicted borrow rate */
  borrowAprBaseExact: BigNumber | undefined;
  /** borrow APR in terms of base currency calculated using exact borrow rate taken from next step */
  borrowAprBaseApprox: BigNumber | undefined;
  /** total increment of collateral amount from NEXT to LAST in terms of base currency */
  totalCollateralBaseDelta: BigNumber | undefined;
  /** total increment of borrowed amount from NEXT to LAST in terms of base currency */
  totalDebtBaseDelta: BigNumber | undefined;

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
  async makeBorrowTest(
    deployer: SignerWithAddress
    , amountToBorrow0: ConfigurableAmountToBorrow
    , p: TestSingleBorrowParams
    , additionalPoints: number[]
  ) : Promise<IBorrowResults> {
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

    // start point: we estimate APR in this point this.before borrow and supply
    this.before = await getAave3StateInfo(deployer, aavePool, dp, p.collateral.asset, p.borrow.asset);

    // just for control: let's try to predict current borrow rays
    const liquidityRateRaysCurrentCalculated = await libFacade.getLiquidityRateRays(
      this.before.collateral.data, // collateralAssetData,
      p.collateral.asset,
      0, // no changes
      this.before.collateral.reserveData.totalStableDebt,
      this.before.collateral.reserveData.totalVariableDebt,
    );
    const brRaysCurrentCalculated = (await libFacade.getVariableBorrowRateRays(
      this.before.borrow.data, // borrowAssetData,
      p.borrow.asset,
      0, // no changes
      this.before.borrow.reserveData.totalStableDebt,
      this.before.borrow.reserveData.totalVariableDebt,
    ));
    console.log(`Current: liquidityRateRays=${liquidityRateRaysCurrentCalculated.toString()} brRays=${brRaysCurrentCalculated.toString()}`);

    // make borrow
    const borrowResults = await makeBorrow(deployer
      , p
      , amountToBorrow0
      , new Aave3PlatformFabric()
    );
    this.userAddress = borrowResults.poolAdapter;
    this.borrowAmount = borrowResults.borrowAmount;
    console.log(`userAddress=${this.userAddress} borrowAmount=${this.borrowAmount}`);

    // predict borrow and supply rates after borrow
    const liquidityRateRaysPredicted = await libFacade.getLiquidityRateRays(
      this.before.collateral.data, // collateralAssetData,
      p.collateral.asset,
      amountCollateral,
      collateralReserveData.totalStableDebt,
      collateralReserveData.totalVariableDebt,
    );
    const brRaysPredicted = (await libFacade.getVariableBorrowRateRays(
      this.before.borrow.data, // borrowAssetData,
      p.borrow.asset,
      this.borrowAmount,
      borrowReserveData.totalStableDebt,
      borrowReserveData.totalVariableDebt
    ));
    console.log(`Predicted: liquidityRateRays=${liquidityRateRaysPredicted.toString()} brRays=${brRaysPredicted.toString()}`);

    // this.next => this.last
    this.next = await getAave3StateInfo(deployer, aavePool, dp, p.collateral.asset, p.borrow.asset, this.userAddress);
    await TimeUtils.advanceNBlocks(p.countBlocks);
    this.last = await getAave3StateInfo(deployer, aavePool, dp, p.collateral.asset, p.borrow.asset, this.userAddress);

    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;
    console.log("before", this.before);
    console.log("next", this.next);
    console.log("last", this.last);

    const keyValues: IAaveKeyTestValues = {
      borrowRatePredicted: brRaysPredicted,
      liquidityRatePredicted: liquidityRateRaysPredicted,

      liquidity: {
        beforeBorrow: {
          block: this.before.block,
          blockTimeStamp: this.before.blockTimestamp,
          rate: this.before.collateral.data.currentLiquidityRate,
          liquidityIndex: this.before.collateral.data.liquidityIndex,
          scaledBalance: BigNumber.from(0),
          reserveNormalized: this.before.collateral.reserveNormalized,
          userBalanceBase: BigNumber.from(0),
          lastUpdateTimestamp: this.before.collateral.data.lastUpdateTimestamp
        },
        next: {
          block: this.next.block,
          blockTimeStamp: this.next.blockTimestamp,
          rate: this.next.collateral.data.currentLiquidityRate,
          liquidityIndex: this.next.collateral.data.liquidityIndex,
          scaledBalance: this.next.collateral.scaledBalance,
          reserveNormalized: this.next.collateral.reserveNormalized,
          userBalanceBase: this.next.userAccount!.totalCollateralBase,
          lastUpdateTimestamp: this.next.collateral.data.lastUpdateTimestamp
        },
        last: {
          block: this.last.block,
          blockTimeStamp: this.last.blockTimestamp,
          rate: this.last.collateral.data.currentLiquidityRate,
          liquidityIndex: this.last.collateral.data.liquidityIndex,
          scaledBalance: this.last.collateral.scaledBalance,
          reserveNormalized: this.last.collateral.reserveNormalized,
          userBalanceBase: this.last.userAccount!.totalCollateralBase,
          lastUpdateTimestamp: this.last.collateral.data.lastUpdateTimestamp
        }
      },
      borrow: {
        beforeBorrow: {
          block: this.before.block,
          blockTimeStamp: this.before.blockTimestamp,
          rate: this.before.borrow.data.currentVariableBorrowRate,
          liquidityIndex: this.before.borrow.data.variableBorrowIndex,
          scaledBalance: BigNumber.from(0),
          reserveNormalized: this.before.borrow.reserveNormalized,
          userBalanceBase: BigNumber.from(0),
          lastUpdateTimestamp: this.before.borrow.data.lastUpdateTimestamp
        },
        next: {
          block: this.next.block,
          blockTimeStamp: this.next.blockTimestamp,
          rate: this.next.borrow.data.currentVariableBorrowRate,
          liquidityIndex: this.next.borrow.data.variableBorrowIndex,
          scaledBalance: this.next.borrow.scaledBalance,
          reserveNormalized: this.next.borrow.reserveNormalized,
          userBalanceBase: this.next.userAccount!.totalDebtBase,
          lastUpdateTimestamp: this.next.borrow.data.lastUpdateTimestamp
        },
        last: {
          block: this.last.block,
          blockTimeStamp: this.last.blockTimestamp,
          rate: this.last.borrow.data.currentVariableBorrowRate,
          liquidityIndex: this.last.borrow.data.variableBorrowIndex,
          scaledBalance: this.last.borrow.scaledBalance,
          reserveNormalized: this.last.borrow.reserveNormalized,
          userBalanceBase: this.last.userAccount!.totalDebtBase,
          lastUpdateTimestamp: this.last.borrow.data.lastUpdateTimestamp
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

    this.supplyAprBaseExact = await getAprAAVE3Base(
      libFacade
      , amountCollateral
      , this.next.collateral.data.currentLiquidityRate
      , priceCollateral
      , countBlocks
      , keyValues.liquidity.next
      , blocksPerDay
      , collateralToken.decimals
    );
    console.log("supplyAprExactRay", this.supplyAprBaseExact);
    this.borrowAprBaseExact = await getAprAAVE3Base(
      libFacade
      , this.borrowAmount
      , this.next.borrow.data.currentVariableBorrowRate
      , priceBorrow
      , countBlocks
      , keyValues.borrow.next
      , blocksPerDay
      , borrowToken.decimals
    );
    console.log("borrowAprExact", this.borrowAprBaseExact);

    // calculate approx values of supply/borrow APR
    // we use state-values "this.before-borrow" and predicted values of supply/borrow rates after borrow
    this.supplyAprBaseApprox = await getAprBeforeAAVE3Base(
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
    console.log("supplyAprBaseApprox", this.supplyAprBaseApprox);

    this.borrowAprBaseApprox = await getAprBeforeAAVE3Base(
      libFacade
      , this.borrowAmount
      , brRaysPredicted
      , priceBorrow
      , countBlocks
      , keyValues.borrow.beforeBorrow
      , blocksPerDay
      , keyValues.borrow.next.blockTimeStamp
      , borrowToken.decimals
    );
    console.log("borrowAprBaseApprox", this.borrowAprBaseApprox);

    this.totalCollateralBaseDelta = this.last.userAccount!.totalCollateralBase.sub(
      this.next.userAccount!.totalCollateralBase
    );
    this.totalDebtBaseDelta = this.last.userAccount!.totalDebtBase.sub(
      this.next.userAccount!.totalDebtBase
    );
    console.log("totalCollateralBaseDelta", this.totalCollateralBaseDelta);
    console.log("totalDebtBaseDelta", this.totalDebtBaseDelta);

    const bbp: IBaseToBorrowParams = {
      baseCurrencyDecimals: baseCurrencyDecimals,
      priceBaseCurrency: priceBorrow,
      priceDecimals: baseCurrencyDecimals // all prices in AAVE v3 are in base currency
    }

    const pointsResults: IPointResults[] = [];
    let prev = this.last;
    for (const period of additionalPoints) {
      await TimeUtils.advanceNBlocks(period);
      let current = await getAave3StateInfo(deployer, aavePool, dp, p.collateral.asset, p.borrow.asset, this.userAddress);

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
      init: {
        borrowAmount: this.borrowAmount,
        collateralAmount: amountCollateral,
        collateralAmountBT18: convertUnits(
          amountCollateral
          , priceCollateral, collateralToken.decimals
          , priceBorrow, 18
        )
      }, predicted: {
        aprBT18: {
          collateral: baseToBorrow18(this.supplyAprBaseApprox, bbp),
          borrow: baseToBorrow18(this.borrowAprBaseApprox, bbp)
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
          block0: this.next.block,
          blockTimestamp0: this.next.blockTimestamp,
          block1: this.last.block,
          blockTimestamp1: this.last.blockTimestamp,
        },
        rates: {
          borrowRate: this.next.borrow.data.currentVariableBorrowRate,
          supplyRate: this.next.collateral.data.currentLiquidityRate
        },
        aprBT18: {
          collateral: baseToBorrow18(this.totalCollateralBaseDelta, bbp),
          borrow: baseToBorrow18(this.totalDebtBaseDelta, bbp)
        }
      },
      points: pointsResults
    }
  }
}