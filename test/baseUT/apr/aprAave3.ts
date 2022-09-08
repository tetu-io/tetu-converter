import {TokenDataTypes} from "../types/TokenDataTypes";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {Aave3AprLibFacade, IAavePool, IAaveToken__factory} from "../../../typechain";
import {convertUnits, makeBorrow} from "./aprUtils";
import {Aave3PlatformFabric} from "../fabrics/Aave3PlatformFabric";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {Aave3DataTypes} from "../../../typechain/contracts/integrations/aave3/IAavePool";
import hre from "hardhat";
import {IAaveKeyState, IAaveKeyTestValues, IBorrowResults} from "./aprDataTypes";

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
  assetCollateral: string,
  assetBorrow: string,
  userAddress?: string,
) : Promise<IAave3StateInfo> {
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
 *  Return value in terms of base currency
 * */
async function getAprAAVE3Base(
  libFacade: Aave3AprLibFacade,
  amount: BigNumber,
  predictedRate: BigNumber,
  price18: BigNumber,
  countBlocks: number,
  state: IAaveKeyState,
  blocksPerDay: number
) : Promise<BigNumber> {
  console.log("getAprAAVE3Base");
  console.log("amount", amount);
  console.log("predictedRate", predictedRate);
  console.log("price18", price18);
  console.log("countBlocks", countBlocks);
  console.log("state", state);
  console.log("blocksPerDay", blocksPerDay);
  return (await libFacade.getAprForPeriodAfter(
    amount,
    state.reserveNormalized,
    state.liquidityIndex,
    predictedRate,
    countBlocks,
    blocksPerDay
  )).mul(price18).div(getBigNumberFrom(1, 18));
}

/** Calc APR in the state this.before the supply/borrow operation
 * Return value in terms of base currency
 * */
async function getAprBeforeAAVE3Base(
  libFacade: Aave3AprLibFacade,
  amount: BigNumber,
  predictedRate: BigNumber,
  price18: BigNumber,
  countBlocks: number,
  state: IAaveKeyState,
  blocksPerDay: number,
  operationTimestamp: number
) : Promise<BigNumber> {
  return (await libFacade.getAprForPeriodBefore(
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
  )).mul(price18).div(getBigNumberFrom(1, 18));
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
  /** Supply APR calculated using predicted supply rate */
  supplyAprExact: BigNumber | undefined;
  /** Supply APR calculated using exact supply rate taken from next step */
  supplyAprApprox: BigNumber | undefined;
  /** Borrow APR calculated using predicted borrow rate */
  borrowAprExact: BigNumber | undefined;
  /** borrow APR calculated using exact borrow rate taken from next step */
  borrowAprApprox: BigNumber | undefined;

  async makeBorrowTest(
    deployer: SignerWithAddress
    , amountToBorrow0: number
    , p: TestSingleBorrowParams
  ) : Promise<IBorrowResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const h: Aave3Helper = new Aave3Helper(deployer);
    const aavePool = await Aave3Helper.getAavePool(deployer);
    const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);
    const priceOracle = await Aave3Helper.getAavePriceOracle(deployer);

    const borrowReserveData = await dp.getReserveData(p.borrow.asset);
    const collateralReserveData = await dp.getReserveData(p.collateral.asset);

    const amountToBorrow = getBigNumberFrom(amountToBorrow0, borrowToken.decimals);
    const amountCollateral = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);
    console.log(`amountCollateral=${amountCollateral.toString()} amountToBorrow=${amountToBorrow.toString()}`);

    // prices
    const prices = await priceOracle.getAssetsPrices([p.collateral.asset, p.borrow.asset]);
    const priceCollateral = prices[0];
    const priceBorrow = prices[1];

    // predict APR
    const libFacade = await DeployUtils.deployContract(deployer, "Aave3AprLibFacade") as Aave3AprLibFacade;

    // start point: we estimate APR in this point this.before borrow and supply
    this.before = await getAave3StateInfo(deployer, aavePool, p.collateral.asset, p.borrow.asset);

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
      amountToBorrow,
      borrowReserveData.totalStableDebt,
      borrowReserveData.totalVariableDebt
    ));
    console.log(`Predicted: liquidityRateRays=${liquidityRateRaysPredicted.toString()} brRays=${brRaysPredicted.toString()}`);

    // make borrow
    this.userAddress = await makeBorrow(deployer, p, amountToBorrow, new Aave3PlatformFabric());
    const afterBorrow = await getAave3StateInfo(deployer, aavePool, p.collateral.asset, p.borrow.asset, this.userAddress);

    // this.next => this.last
    this.next = afterBorrow;
    await TimeUtils.advanceNBlocks(1);
    this.last = await getAave3StateInfo(deployer, aavePool, p.collateral.asset, p.borrow.asset, this.userAddress);

    const deltaCollateralBase = this.last.userAccount!.totalCollateralBase.sub(this.next.userAccount!.totalCollateralBase);
    const deltaBorrowBase = this.last.userAccount!.totalDebtBase.sub(this.next.userAccount!.totalDebtBase);
    console.log("deltaCollateralBase", deltaCollateralBase);
    console.log("deltaBorrowBase", deltaBorrowBase);
    console.log("priceBorrow", priceBorrow);

    console.log("before", this.before);
    console.log("afterBorrow=next", afterBorrow);
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
        afterBorrow: {
          block: afterBorrow.block,
          blockTimeStamp: afterBorrow.blockTimestamp,
          rate: afterBorrow.collateral.data.currentLiquidityRate,
          liquidityIndex: afterBorrow.collateral.data.liquidityIndex,
          scaledBalance: afterBorrow.collateral.scaledBalance,
          reserveNormalized: afterBorrow.collateral.reserveNormalized,
          userBalanceBase: afterBorrow.userAccount!.totalCollateralBase,
          lastUpdateTimestamp: afterBorrow.collateral.data.lastUpdateTimestamp
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
        afterBorrow: {
          block: afterBorrow.block,
          blockTimeStamp: afterBorrow.blockTimestamp,
          rate: afterBorrow.borrow.data.currentVariableBorrowRate,
          liquidityIndex: afterBorrow.borrow.data.variableBorrowIndex,
          scaledBalance: afterBorrow.borrow.scaledBalance,
          reserveNormalized: afterBorrow.borrow.reserveNormalized,
          userBalanceBase: afterBorrow.userAccount!.totalDebtBase,
          lastUpdateTimestamp: afterBorrow.borrow.data.lastUpdateTimestamp
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

    this.supplyAprExact = await getAprAAVE3Base(
      libFacade
      , amountCollateral
      , liquidityRateRaysPredicted
      , priceCollateral
      , countBlocks
      , keyValues.liquidity.afterBorrow
      , blocksPerDay
    );
    console.log("supplyAprExact", this.supplyAprExact);
    this.borrowAprExact = await getAprAAVE3Base(
      libFacade
      , amountToBorrow
      , afterBorrow.borrow.data.currentVariableBorrowRate
      , priceBorrow
      , countBlocks
      , keyValues.borrow.afterBorrow
      , blocksPerDay
    );
    console.log("borrowAprExact", this.borrowAprExact);

    // calculate approx values of supply/borrow APR
    // we use state-values "this.before-borrow" and predicted values of supply/borrow rates after borrow
    this.supplyAprApprox = await getAprBeforeAAVE3Base(
      libFacade
      , amountCollateral
      , keyValues.liquidityRatePredicted
      , priceCollateral
      , countBlocks
      , keyValues.liquidity.beforeBorrow
      , blocksPerDay
      , keyValues.liquidity.afterBorrow.blockTimeStamp
    );
    console.log("supplyAprApprox", this.supplyAprApprox);

    this.borrowAprApprox = await getAprBeforeAAVE3Base(
      libFacade
      , amountToBorrow
      , keyValues.borrowRatePredicted
      , priceBorrow
      , countBlocks
      , keyValues.borrow.beforeBorrow
      , blocksPerDay
      , keyValues.borrow.afterBorrow.blockTimeStamp
    );
    console.log("borrowAprApprox", this.borrowAprApprox);

    return {
      init: {
        borrowAmount: amountToBorrow,
        collateralAmount: amountCollateral,
        collateralAmountBT: convertUnits(amountCollateral, collateralToken, priceCollateral, borrowToken, priceBorrow)
      }, predicted: {
        aprBT: {
          collateral: this.supplyAprApprox,
          borrow: this.borrowAprApprox,
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
        aprBT: {
          collateral: this.last.userAccount!.totalCollateralBase.sub(this.next.userAccount!.totalCollateralBase),
          borrow: this.last.userAccount!.totalDebtBase.sub(this.next.userAccount!.totalDebtBase)
        }

      }
    }
  }
}