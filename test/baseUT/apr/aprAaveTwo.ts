import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {IAaveKeyState, IAaveKeyTestValues, IBorrowResults, IPointResults} from "./aprDataTypes";
import {DataTypes, IAaveTwoPool} from "../../../typechain/contracts/integrations/aaveTwo/IAaveTwoPool";
import hre from "hardhat";
import {AaveTwoAprLibFacade, IAaveToken__factory, IERC20__factory, IERC20Extended__factory} from "../../../typechain";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {AaveTwoHelper} from "../../../scripts/integration/helpers/AaveTwoHelper";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {baseToBorrow18, ConfigurableAmountToBorrow, convertUnits, IBaseToBorrowParams, makeBorrow} from "./aprUtils";
import {AaveTwoPlatformFabric} from "../fabrics/AaveTwoPlatformFabric";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";

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
  /** State before borrow */
  before: IAaveTwoStateInfo | undefined;
  /** State just after borrow */
  next: IAaveTwoStateInfo | undefined;
  /** State just after borrow + 1 block */
  last: IAaveTwoStateInfo | undefined;
  /** Borrower address */
  userAddress: string | undefined;
  /** Exact value of the borrowed amount */
  borrowAmount: BigNumber = BigNumber.from(0);

//// next : last  results

  /** Supply APR in terms of base currency calculated using predicted supply rate */
  supplyAprBaseExact: BigNumber | undefined;
  /** Supply APR in terms of base currency calculated using exact supply rate taken from next step */
  supplyAprBaseApprox: IAprData | undefined;
  /** Borrow APR in terms of base currency calculated using predicted borrow rate */
  borrowAprBaseExact: BigNumber | undefined;
  /** borrow APR in terms of base currency calculated using exact borrow rate taken from next step */
  borrowAprBaseApprox: IAprData | undefined;
  /** total increment of collateral amount from NEXT to LAST in terms of base currency */
  totalCollateralETH: BigNumber | undefined;
  /** total increment of borrowed amount from NEXT to LAST in terms of base currency */
  totalDebtETH: BigNumber | undefined;


  keyValues: IAaveKeyTestValues | undefined;
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
    this.before = await getAaveTwoStateInfo(deployer, aavePool, p.collateral.asset, p.borrow.asset);

    // make borrow
    const borrowResults = await makeBorrow(
      deployer
      , p
      , amountToBorrow0
      , new AaveTwoPlatformFabric()
    );
    this.userAddress = borrowResults.poolAdapter;
    this.borrowAmount = borrowResults.borrowAmount;
    console.log(`userAddress=${this.userAddress} borrowAmount=${this.borrowAmount}`);

    const liquidityRateRaysPredicted = await libFacade.getLiquidityRateRays(
      this.before.collateral.data,
      p.collateral.asset,
      amountCollateral,
      collateralReserveData.totalStableDebt,
      collateralReserveData.totalVariableDebt,
    );
    const brRaysPredicted = (await libFacade.getVariableBorrowRateRays(
      this.before.borrow.data,
      p.borrow.asset,
      this.borrowAmount,
      borrowReserveData.totalStableDebt,
      borrowReserveData.totalVariableDebt
    ));
    console.log(`Predicted: liquidityRateRays=${liquidityRateRaysPredicted.toString()} brRays=${brRaysPredicted.toString()}`);

    this.next = await getAaveTwoStateInfo(deployer, aavePool, p.collateral.asset, p.borrow.asset, this.userAddress);
    await TimeUtils.advanceNBlocks(p.countBlocks);
    this.last = await getAaveTwoStateInfo(deployer, aavePool, p.collateral.asset, p.borrow.asset, this.userAddress);

    // we need to display full objects
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;
    console.log("before", this.before);
    console.log("next", this.next);
    console.log("last", this.last);

    this.keyValues = {
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
          userBalanceBase: this.next.userAccount!.totalCollateralETH,
          lastUpdateTimestamp: this.next.collateral.data.lastUpdateTimestamp
        },
        last: {
          block: this.last.block,
          blockTimeStamp: this.last.blockTimestamp,
          rate: this.last.collateral.data.currentLiquidityRate,
          liquidityIndex: this.last.collateral.data.liquidityIndex,
          scaledBalance: this.last.collateral.scaledBalance,
          reserveNormalized: this.last.collateral.reserveNormalized,
          userBalanceBase: this.last.userAccount!.totalCollateralETH,
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
          userBalanceBase: this.next.userAccount!.totalDebtETH,
          lastUpdateTimestamp: this.next.borrow.data.lastUpdateTimestamp
        },
        last: {
          block: this.last.block,
          blockTimeStamp: this.last.blockTimestamp,
          rate: this.last.borrow.data.currentVariableBorrowRate,
          liquidityIndex: this.last.borrow.data.variableBorrowIndex,
          scaledBalance: this.last.borrow.scaledBalance,
          reserveNormalized: this.last.borrow.reserveNormalized,
          userBalanceBase: this.last.userAccount!.totalDebtETH,
          lastUpdateTimestamp: this.last.borrow.data.lastUpdateTimestamp
        }
      },
    };
    console.log("key", this.keyValues);

    // calculate exact values of supply/borrow APR
    // we use state-values "after-borrow" and exact values of supply/borrow rates after borrow
    const countBlocks = this.keyValues.liquidity.last.blockTimeStamp - this.keyValues.liquidity.next.blockTimeStamp;
    // for test purpose assume that we have exactly 1 block per 1 second
    const blocksPerDay = 86400;
    console.log("countBlocks", countBlocks);

    this.supplyAprBaseExact = await getAprAAVETwoBase(
      libFacade
      , amountCollateral
      , liquidityRateRaysPredicted
      , priceCollateral
      , countBlocks
      , this.keyValues.liquidity.next
      , blocksPerDay
      , collateralToken.decimals
    );
    console.log("supplyAprBaseExact", this.supplyAprBaseExact);
    this.borrowAprBaseExact = await getAprAAVETwoBase(
      libFacade
      , this.borrowAmount
      , this.next.borrow.data.currentVariableBorrowRate
      , priceBorrow
      , countBlocks
      , this.keyValues.borrow.next
      , blocksPerDay
      , borrowToken.decimals
    );
    console.log("borrowAprBaseExact", this.borrowAprBaseExact);

    // calculate approx values of supply/borrow APR
    // we use state-values "before-borrow" and predicted values of supply/borrow rates after borrow
    this.supplyAprBaseApprox = await getAprBeforeAAVETwoBase(
      libFacade
      , amountCollateral
      , this.keyValues.liquidityRatePredicted
      , priceCollateral
      , countBlocks
      , this.keyValues.liquidity.beforeBorrow
      , blocksPerDay
      , this.keyValues.liquidity.next.blockTimeStamp
      , collateralToken.decimals
    );
    console.log("supplyAprApprox", this.supplyAprBaseApprox);
    this.borrowAprBaseApprox = await getAprBeforeAAVETwoBase(
      libFacade
      , this.borrowAmount
      , this.keyValues.borrowRatePredicted
      , priceBorrow
      , countBlocks
      , this.keyValues.borrow.beforeBorrow
      , blocksPerDay
      , this.keyValues.borrow.next.blockTimeStamp
      , borrowToken.decimals
    );
    console.log("borrowAprApprox", this.borrowAprBaseApprox);

    // calculate real differences in user-account-balances for period [next block, last block]
    this.totalCollateralETH = this.last.userAccount!.totalCollateralETH.sub(this.next.userAccount!.totalCollateralETH);
    this.totalDebtETH = this.last.userAccount!.totalDebtETH.sub(this.next.userAccount!.totalDebtETH);
    console.log("collateralAprETH", this.totalCollateralETH);
    console.log("borrowAprETH", this.totalDebtETH);

    const bbp: IBaseToBorrowParams = {
      baseCurrencyDecimals: baseCurrencyDecimals,
      priceBaseCurrency: priceBorrow,
      priceDecimals: baseCurrencyDecimals // all prices in AAVE TWO are in ETH
    }

    const pointsResults: IPointResults[] = [];
    let prev = this.last;
    for (const period of additionalPoints) {
      await TimeUtils.advanceNBlocks(period);
      let current = await getAaveTwoStateInfo(deployer, aavePool, p.collateral.asset, p.borrow.asset, this.userAddress);

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
          collateral: baseToBorrow18(this.supplyAprBaseApprox.apr, bbp),
          borrow: baseToBorrow18(this.borrowAprBaseApprox.apr, bbp)
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
          collateral: baseToBorrow18(this.totalCollateralETH, bbp),
          borrow: baseToBorrow18(this.totalDebtETH, bbp)
        }
      },
      points: pointsResults
    }
  }
}
