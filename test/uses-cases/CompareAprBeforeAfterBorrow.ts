import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {TokenDataTypes} from "../baseUT/types/TokenDataTypes";
import {areAlmostEqual, setInitialBalance} from "../baseUT/utils/CommonUtils";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {TestSingleBorrowParams} from "../baseUT/types/BorrowRepayDataTypes";
import {ILendingPlatformFabric} from "../baseUT/fabrics/ILendingPlatformFabric";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";
import {AaveTwoPlatformFabric} from "../baseUT/fabrics/AaveTwoPlatformFabric";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {Aave3Helper} from "../../scripts/integration/helpers/Aave3Helper";
import {
  Aave3AprLibFacade,
  AaveTwoAprLibFacade,
  DForceAprLibFacade, DForceInterestRateModelMock__factory,
  IAavePool,
  IAaveToken__factory,
  IAaveTwoPool,
  IDForceController,
  IDForceCToken,
  IDForceCToken__factory,
  IDForceInterestRateModel__factory,
  IDForceRewardDistributor, IERC20__factory, IHfCToken__factory
} from "../../typechain";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {expect} from "chai";
import {AaveTwoHelper} from "../../scripts/integration/helpers/AaveTwoHelper";
import {DForceHelper} from "../../scripts/integration/helpers/DForceHelper";
import {Aave3DataTypes} from "../../typechain/contracts/integrations/aave3/IAavePool";
import {DataTypes} from "../../typechain/contracts/integrations/aaveTwo/IAaveTwoPool";
import {
  ISnapshotCollateralToken,
  ISnapshotBorrowToken,
  SupplyBorrowUsingDForce
} from "../baseUT/uses-cases/dforce/SupplyBorrowUsingDForce";
import {DForcePlatformFabric} from "../baseUT/fabrics/DForcePlatformFabric";
import {totalmem} from "os";
import {HundredFinanceHelper} from "../../scripts/integration/helpers/HundredFinanceHelper";
import {makeBorrow} from "../baseUT/apr/aprUtils";
import {AprAave3} from "../baseUT/apr/aprAave3";
import {IAaveKeyState, IAaveKeyTestValues} from "../baseUT/apr/aprDataTypes";

/**
 * For any landing platform:
 * 1. Get APR: borrow apr, supply apr (we don't check rewards in this test)
 * 2. Make supply+borrow inside single block
 * 3. Get current amount of borrow-debt-1 and supply-profit-1
 * 4. Advance 1 block
 * 5. Get current amount of borrow-debt-2 and supply-profit-2
 * 6. Ensure, that
 *        (borrow-debt-2 - borrow-debt-1) == borrow apr
 *        (supply-profit-2 - supply-profit-1) = supply apr
 */
describe("CompareAprBeforeAfterBorrow", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

  beforeEach(async function () {
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
  });
//endregion before, after

//region Data type
  interface ITestResults {
    borrowApr18: BigNumber;
    supplyApr18BT: BigNumber;
    deltaBorrowDebt18: BigNumber;
    deltaSupplyProfit18CT: BigNumber;
  }
//endregion Data type

//region AAVE Two
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

  async function getAaveTwoStateInfo(
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
    price18: BigNumber,
    countBlocks: number,
    state: IAaveKeyState,
    blocksPerDay: number
  ) : Promise<BigNumber> {
    return (await libFacade.getAprForPeriodAfter(
      amount,
      state.reserveNormalized,
      state.liquidityIndex,
      predictedRate,
      countBlocks,
      blocksPerDay,
    )).mul(price18).div(getBigNumberFrom(1, 18));
  }

  /** Calc APR in the state BEFORE the supply/borrow operation
   * Return value in terms of base currency
   * */
  async function getAprBeforeAAVETwoBase(
    libFacade: AaveTwoAprLibFacade,
    amount: BigNumber,
    predictedRate: BigNumber,
    price18: BigNumber,
    countBlocks: number,
    state: IAaveKeyState,
    blocksPerDay: number,
    operationTimestamp: number
  ) : Promise<{
    apr: BigNumber,
    nextLiquidityIndex: BigNumber
  }> {
    const st = {
      liquidityIndex: state.liquidityIndex,
      rate: state.rate,
      lastUpdateTimestamp: state.lastUpdateTimestamp
    };

    const nextLiquidityIndex = await libFacade.getNextLiquidityIndex(st, operationTimestamp);
    const apr = (await libFacade.getAprForPeriodBefore(
      st,
      amount,
      predictedRate,
      countBlocks,
      blocksPerDay,
      operationTimestamp
    )).mul(price18).div(getBigNumberFrom(1, 18));

    return {apr, nextLiquidityIndex};
  }
//endregion AAVE Two

//region DForce data types and utils
  interface IDForceMarketState {
    accrualBlockNumber: BigNumber;
    borrowIndex: BigNumber;
    borrowRatePerBlock: BigNumber;
    exchangeRateStored: BigNumber;
    cash: BigNumber;
    reserveRatio: BigNumber;
    supplyRatePerBlock: BigNumber;
    totalBorrows: BigNumber;
    totalReserves: BigNumber;
    totalSupply: BigNumber;
  }

  interface IDForceUserAccountState {
    balance: BigNumber;
    borrowBalanceStored: BigNumber;
    borrowPrincipal: BigNumber;
    borrowInterestIndex: BigNumber;

    // calcAccountEquity
    accountEquity: BigNumber;
    accountShortfall: BigNumber;
    accountCollateralValue: BigNumber;
    accountBorrowedValue: BigNumber;
  }

  interface IDForceState {
    block: number,
    collateral: {
      market: IDForceMarketState,
      account: IDForceUserAccountState
    },
    borrow: {
      market: IDForceMarketState,
      account: IDForceUserAccountState
    },
  }

  async function getDForceMarketState(token: IDForceCToken): Promise<IDForceMarketState> {
    return {
      accrualBlockNumber: await token.accrualBlockNumber(),
      borrowIndex: await token.borrowIndex(),
      cash: await token.getCash(),
      borrowRatePerBlock: await token.borrowRatePerBlock(),
      exchangeRateStored: await token.exchangeRateStored(),
      reserveRatio: await token.reserveRatio(),
      supplyRatePerBlock: await token.supplyRatePerBlock(),
      totalBorrows: await token.totalBorrows(),
      totalReserves: await token.totalReserves(),
      totalSupply: await token.totalSupply()
    }
  }

  async function getDForceUserAccountState(
    comptroller: IDForceController,
    token: IDForceCToken,
    user: string
  ): Promise<IDForceUserAccountState> {
    const snapshot = await token.borrowSnapshot(user);
    const e = await comptroller.calcAccountEquity(user);
    return {
      balance: await token.balanceOf(user),
      borrowBalanceStored: await token.borrowBalanceStored(user),
      borrowInterestIndex: snapshot.interestIndex,
      borrowPrincipal: snapshot.principal,

      accountEquity: e.accountEquity,
      accountShortfall: e.shortfall,
      accountBorrowedValue: e.borrowedValue,
      accountCollateralValue: e.collateralValue
    }
  }

  async function getDForceStateInfo(
    comptroller: IDForceController
    , cTokenCollateral: IDForceCToken
    , cTokenBorrow: IDForceCToken
    , user: string
  ) : Promise<IDForceState> {
    return {
      block: (await hre.ethers.provider.getBlock("latest")).number,
      collateral: {
        market: await getDForceMarketState(cTokenCollateral),
        account: await getDForceUserAccountState(comptroller, cTokenCollateral, user),
      }, borrow: {
        market: await getDForceMarketState(cTokenBorrow),
        account: await getDForceUserAccountState(comptroller, cTokenBorrow, user),
      }
    }
  }
//endregion DForce data types and utils

  describe("DAI => WETH", () => {
//region Constants
    const ASSET_COLLATERAL = MaticAddresses.DAI;
    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
    const ASSET_COLLATERAL_DFORCE_CTOKEN = MaticAddresses.dForce_iDAI;
    const ASSET_COLLATERAL_HUNDRED_FINANCE_CTOKEN = MaticAddresses.hDAI;
    const ASSET_BORROW = MaticAddresses.WETH;
    const HOLDER_BORROW = MaticAddresses.HOLDER_WETH;
    const ASSET_BORROW_DFORCE_CTOREN = MaticAddresses.dForce_iWETH;
    const ASSET_BORROW_HUNDRED_FINANCE_CTOREN = MaticAddresses.hETH;
    const AMOUNT_COLLATERAL = 200_000;
    const INITIAL_LIQUIDITY_COLLATERAL = 1_000_000;
    const INITIAL_LIQUIDITY_BORROW = 100;
    const HEALTH_FACTOR2 = 200;
    const COUNT_BLOCKS = 1;
    const AMOUNT_TO_BORROW = 40;
//endregion Constants

    describe("AAVE3", () => {
      it("predicted APR should be equal to real APR", async () => {
        if (!await isPolygonForkInUse()) return;

        const h: AprAave3 = new AprAave3();
        const ret = await h.makeBorrowTest(
          deployer
          , AMOUNT_TO_BORROW
          , {
            collateral: {
              asset: ASSET_COLLATERAL,
              holder: HOLDER_COLLATERAL,
              initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
            }, borrow: {
              asset: ASSET_BORROW,
              holder: HOLDER_BORROW,
              initialLiquidity: INITIAL_LIQUIDITY_BORROW,
            }, collateralAmount: AMOUNT_COLLATERAL
            , healthFactor2: HEALTH_FACTOR2
            , countBlocks: COUNT_BLOCKS
          }
        );

        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          ret.resultsBlock.aprBT.collateral.toString(), ret.resultsBlock.aprBT.borrow.toString(),
          ret.resultsBlock.aprBT.collateral.toString(), ret.resultsBlock.aprBT.borrow.toString(),
          ret.resultsBlock.aprBT.collateral.toString(), ret.resultsBlock.aprBT.borrow.toString(),
        ].join();

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          h.supplyAprExact!.toString(), h.borrowAprExact!.toString(),
          h.supplyAprApprox!.toString(), h.borrowAprApprox!.toString(),
          ret.predicted.aprBT.collateral.toString(), ret.predicted.aprBT.borrow.toString()
        ].join();

        expect(sret).equals(sexpected);
      });

      it.skip("temp_calc", () => {
        // user balance = SB * N * PA
        // N = rayMul(RAY + rate * dT / Sy, LI)
        // rayMul(x, y) => (x * y + HALF_RAY) / RAY
        const sb = BigNumber.from("198546852895226759875119");
        const price = BigNumber.from("100022717");
        const RAY = getBigNumberFrom(1, 27);
        const HR = getBigNumberFrom(1, 27).div(2);
        const dT = 8;
        const rate = BigNumber.from("7236951445177009250849459");
        const Sy = BigNumber.from("31536000");
        const liquidityIndex = BigNumber.from("1007318912808656132837500551");
        const reserveNormalizedIncomeLast = BigNumber.from("1007318914657950415385632913");
        const wei = getBigNumberFrom(1, 18);

        const r1 = sb.mul(price).mul(reserveNormalizedIncomeLast).div(RAY).div(wei);
        console.log(r1);

        const r2 = RAY.add(
          rate.mul(dT).div(Sy)
        );
        const r3 = r2.mul(liquidityIndex).add(HR).div(RAY);
        console.log(r2, r3);

        const r4 = sb.mul(price).mul(r3).div(RAY).div(wei);

        const amount0 = BigNumber.from("200000000000000000000000");
        const reserveNormalizedIncomeNext = BigNumber.from("1007318912550956886897761986");
        const borrowLiquidityIndexBeforeBorrow = BigNumber.from("1007318597384779102597497472");
        const borrowLiquidityIndexAfterBorrow = BigNumber.from("1007318912550956886897761986");
        const borrowRatePredicted = BigNumber.from("7236951438851701416682451");
        const sb0 = amount0.mul(RAY).div(reserveNormalizedIncomeNext);
        const r5 = RAY.add(borrowRatePredicted.mul(8).div(Sy));
        const nextN = r5.mul(borrowLiquidityIndexAfterBorrow).add(HR).div(RAY);
        const userBalance = sb0.mul(nextN).mul(price).div(RAY);
        const income = userBalance.sub(amount0.mul(price));
        console.log("sb0", sb0);
        console.log("r5", r5);
        console.log("nextN", nextN);
        console.log("userBalance0", sb0.mul(reserveNormalizedIncomeNext).mul(price).div(RAY));
        console.log("userBalance", userBalance);
        console.log("income", income);

        const reserveNormalizedLast = BigNumber.from("1007318914400251167356457733");
        const r5required = reserveNormalizedLast.mul(RAY).sub(HR).div(borrowLiquidityIndexAfterBorrow);
        console.log("r5required", r5required);

        expect(r1.toString()).eq("20004543436725");
        expect(r4.toString()).eq("20004543436725");
      });
    });

    describe("AAVE2", () => {
      it("predicted APR should be equal to real APR", async () => {
        if (!await isPolygonForkInUse()) return;

        const collateralToken = await TokenDataTypes.Build(deployer, ASSET_COLLATERAL);
        const borrowToken = await TokenDataTypes.Build(deployer, ASSET_BORROW);

        const aavePool = await AaveTwoHelper.getAavePool(deployer);
        const dp = await AaveTwoHelper.getAaveProtocolDataProvider(deployer);
        const priceOracle = await AaveTwoHelper.getAavePriceOracle(deployer);

        const borrowReserveData = await dp.getReserveData(ASSET_BORROW);
        const collateralReserveData = await dp.getReserveData(ASSET_COLLATERAL);

        const amountToBorrow = getBigNumberFrom(AMOUNT_TO_BORROW, borrowToken.decimals);
        const amountCollateral = getBigNumberFrom(AMOUNT_COLLATERAL, collateralToken.decimals);
        const blockBeforeBorrow = await hre.ethers.provider.getBlock("latest");
        console.log(`amountCollateral=${amountCollateral.toString()} amountToBorrow=${amountToBorrow.toString()}`);

        // prices
        const prices = await priceOracle.getAssetsPrices([ASSET_COLLATERAL, ASSET_BORROW]);
        const priceCollateral = prices[0];
        const priceBorrow = prices[1];

        // predict APR
        const libFacade = await DeployUtils.deployContract(deployer, "AaveTwoAprLibFacade") as AaveTwoAprLibFacade;

        // start point: we estimate APR in this point before borrow and supply
        const before = await getAaveTwoStateInfo(aavePool, ASSET_COLLATERAL, ASSET_BORROW);

        const liquidityRateRaysPredicted = await libFacade.getLiquidityRateRays(
          before.collateral.data,
          ASSET_COLLATERAL,
          amountCollateral,
          collateralReserveData.totalStableDebt,
          collateralReserveData.totalVariableDebt,
        );
        const brRaysPredicted = (await libFacade.getVariableBorrowRateRays(
          before.borrow.data,
          ASSET_BORROW,
          amountToBorrow,
          borrowReserveData.totalStableDebt,
          borrowReserveData.totalVariableDebt
        ));
        console.log(`Predicted: liquidityRateRays=${liquidityRateRaysPredicted.toString()} brRays=${brRaysPredicted.toString()}`);

        // make borrow
        const userAddress = await makeBorrow(deployer
          , {
            collateral: {
              asset: ASSET_COLLATERAL,
              holder: HOLDER_COLLATERAL,
              initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
            }, borrow: {
              asset: ASSET_BORROW,
              holder: HOLDER_BORROW,
              initialLiquidity: INITIAL_LIQUIDITY_BORROW,
            }, collateralAmount: AMOUNT_COLLATERAL
            , healthFactor2: HEALTH_FACTOR2
            , countBlocks: COUNT_BLOCKS
          }
          , amountToBorrow
          , new AaveTwoPlatformFabric()
        );

        const afterBorrow = await getAaveTwoStateInfo(aavePool, ASSET_COLLATERAL, ASSET_BORROW, userAddress);
        const next = afterBorrow; // await aavePool.getUserAccountData(userAddress);
        await TimeUtils.advanceNBlocks(1);
        const last = await getAaveTwoStateInfo(aavePool, ASSET_COLLATERAL, ASSET_BORROW, userAddress);

        const deltaCollateralBase = last.userAccount!.totalCollateralETH.sub(next.userAccount!.totalCollateralETH);
        const deltaBorrowBase = last.userAccount!.totalDebtETH.sub(next.userAccount!.totalDebtETH);
        console.log("deltaCollateralBase", deltaCollateralBase);
        console.log("deltaBorrowBase", deltaBorrowBase);
        console.log("priceBorrow", priceBorrow);

        console.log("before", before);
        console.log("afterBorrow=next", afterBorrow);
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
            afterBorrow: {
              block: afterBorrow.block,
              blockTimeStamp: afterBorrow.blockTimestamp,
              rate: afterBorrow.collateral.data.currentLiquidityRate,
              liquidityIndex: afterBorrow.collateral.data.liquidityIndex,
              scaledBalance: afterBorrow.collateral.scaledBalance,
              reserveNormalized: afterBorrow.collateral.reserveNormalized,
              userBalanceBase: afterBorrow.userAccount!.totalCollateralETH,
              lastUpdateTimestamp: afterBorrow.collateral.data.lastUpdateTimestamp
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
            afterBorrow: {
              block: afterBorrow.block,
              blockTimeStamp: afterBorrow.blockTimestamp,
              rate: afterBorrow.borrow.data.currentVariableBorrowRate,
              liquidityIndex: afterBorrow.borrow.data.variableBorrowIndex,
              scaledBalance: afterBorrow.borrow.scaledBalance,
              reserveNormalized: afterBorrow.borrow.reserveNormalized,
              userBalanceBase: afterBorrow.userAccount!.totalDebtETH,
              lastUpdateTimestamp: afterBorrow.borrow.data.lastUpdateTimestamp
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

        const supplyApr = await getAprAAVETwoBase(
          libFacade
          , amountCollateral
          , liquidityRateRaysPredicted
          , priceCollateral
          , countBlocks
          , keyValues.liquidity.afterBorrow
          , blocksPerDay
        );
        console.log("supplyAprExact", supplyApr);
        const borrowApr = await getAprAAVETwoBase(
          libFacade
          , amountToBorrow
          , afterBorrow.borrow.data.currentVariableBorrowRate
          , priceBorrow
          , countBlocks
          , keyValues.borrow.afterBorrow
          , blocksPerDay
        );
        console.log("borrowAprExact", borrowApr);

        // calculate approx values of supply/borrow APR
        // we use state-values "before-borrow" and predicted values of supply/borrow rates after borrow
        const supplyAprApprox = await getAprBeforeAAVETwoBase(
          libFacade
          , amountCollateral
          , keyValues.liquidityRatePredicted
          , priceCollateral
          , countBlocks
          , keyValues.liquidity.beforeBorrow
          , blocksPerDay
          , keyValues.liquidity.afterBorrow.blockTimeStamp
        );
        console.log("supplyAprApprox", supplyAprApprox);
        const borrowAprApprox = await getAprBeforeAAVETwoBase(
          libFacade
          , amountToBorrow
          , keyValues.borrowRatePredicted
          , priceBorrow
          , countBlocks
          , keyValues.borrow.beforeBorrow
          , blocksPerDay
          , keyValues.borrow.afterBorrow.blockTimeStamp
        );
        console.log("borrowAprApprox", borrowAprApprox);

        // calculate real differences in user-account-balances for period [next block, last block]
        const collateralAprETH = last.userAccount!.totalCollateralETH.sub(next.userAccount!.totalCollateralETH);
        const borrowAprETH = last.userAccount!.totalDebtETH.sub(next.userAccount!.totalDebtETH);
        console.log("collateralAprETH", collateralAprETH);
        console.log("borrowAprETH", borrowAprETH);

        const ret = [
          areAlmostEqual(collateralAprETH, supplyApr, 6),
          areAlmostEqual(borrowAprETH, borrowApr, 8),
          supplyApr.toString(),
          keyValues.liquidity.afterBorrow.liquidityIndex,

          // borrowApr.toString(),
          // keyValues.borrow.afterBorrow.liquidityIndex
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const expected = [
          true,
          true,
          supplyAprApprox.apr.toString(),
          supplyAprApprox.nextLiquidityIndex.toString(),

          /////////////////////////////////////////////////////////////////////
          // TODO: nextLiquidityIndex for borrow is a bit different from expected
          // The difference appears because we need to take into account compound effect
          // see aave-v2, MathUtils.sol, calculateCompoundedInterest
          ////////////////////////////////////////////////////////////////////
          // borrowAprApprox.apr.toString(),
          // borrowAprApprox.nextLiquidityIndex.toString()
          ////////////////////////////////////////////////////////////////////
        ].join("\n");

        expect(ret).equals(expected);
      });
    });

    describe("DForce", () => {
      it("predicted APR should be equal to real APR", async () => {
        if (!await isPolygonForkInUse()) return;
        const collateralToken = await TokenDataTypes.Build(deployer, ASSET_COLLATERAL);
        const borrowToken = await TokenDataTypes.Build(deployer, ASSET_BORROW);

        const comptroller = await DForceHelper.getController(deployer);
        const cTokenCollateral = IDForceCToken__factory.connect(ASSET_COLLATERAL_DFORCE_CTOKEN, deployer);
        const cTokenBorrow = IDForceCToken__factory.connect(ASSET_BORROW_DFORCE_CTOREN, deployer);
        const priceOracle = await DForceHelper.getPriceOracle(comptroller, deployer);

        const marketCollateralData = await DForceHelper.getCTokenData(deployer, comptroller, cTokenCollateral);
        const marketBorrowData = await DForceHelper.getCTokenData(deployer, comptroller, cTokenBorrow);

        console.log("marketCollateralData", marketCollateralData);
        console.log("marketBorrowData", marketBorrowData);

        const amountToBorrow = getBigNumberFrom(AMOUNT_TO_BORROW, borrowToken.decimals);
        const amountCollateral = getBigNumberFrom(AMOUNT_COLLATERAL, collateralToken.decimals);
        console.log(`amountCollateral=${amountCollateral.toString()} amountToBorrow=${amountToBorrow.toString()}`);

        // prices
        const priceCollateral = await priceOracle.getUnderlyingPrice(ASSET_COLLATERAL_DFORCE_CTOKEN);
        const priceBorrow = await priceOracle.getUnderlyingPrice(ASSET_BORROW_DFORCE_CTOREN);
        console.log("priceCollateral", priceCollateral);
        console.log("priceBorrow", priceBorrow);

        // predict APR
        const libFacade = await DeployUtils.deployContract(deployer, "DForceAprLibFacade") as DForceAprLibFacade;

        // start point: we estimate APR in this point before borrow and supply
        const before = await getDForceStateInfo(comptroller
          , cTokenCollateral
          , cTokenBorrow
          // we don't have user address at this moment
          // so, use dummy address (and get dummy balance values - we don't use them)
          , ethers.Wallet.createRandom().address
        );

        const borrowRatePredicted = await libFacade.getEstimatedBorrowRate(
          await cTokenBorrow.interestRateModel()
          , cTokenBorrow.address
          , amountToBorrow
        );

        const supplyRatePredicted = await libFacade.getEstimatedSupplyRatePure(
          before.collateral.market.totalSupply
          , amountCollateral
          , before.collateral.market.cash
          , before.collateral.market.totalBorrows
          , before.collateral.market.totalReserves
          , marketCollateralData.interestRateModel
          , before.collateral.market.reserveRatio
          , before.collateral.market.exchangeRateStored
        );

        console.log(`Predicted: supplyRate=${supplyRatePredicted.toString()} br=${borrowRatePredicted.toString()}`);

        // make borrow
        const userAddress = await makeBorrow(deployer
          , {
            collateral: {
              asset: ASSET_COLLATERAL,
              holder: HOLDER_COLLATERAL,
              initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
            }, borrow: {
              asset: ASSET_BORROW,
              holder: HOLDER_BORROW,
              initialLiquidity: INITIAL_LIQUIDITY_BORROW,
            }, collateralAmount: AMOUNT_COLLATERAL
            , healthFactor2: HEALTH_FACTOR2
            , countBlocks: COUNT_BLOCKS
          }
          , amountToBorrow
          , new DForcePlatformFabric()
        );

        const afterBorrow = await getDForceStateInfo(comptroller
          , cTokenCollateral
          , cTokenBorrow
          , userAddress
        );

        // next => last
        const next = afterBorrow;

        // For collateral: move ahead on single block
        await cTokenCollateral.updateInterest(); //await TimeUtils.advanceNBlocks(1);

        const middle = await getDForceStateInfo(comptroller
          , cTokenCollateral
          , cTokenBorrow
          , userAddress
        );

        // For borrow: move ahead on one more block
        await cTokenBorrow.updateInterest();

        const last = await getDForceStateInfo(comptroller
          , cTokenCollateral
          , cTokenBorrow
          , userAddress
        );
        const base = getBigNumberFrom(1, 18);

        const collateralNextV = DForceHelper.getCollateralValue(
          next.collateral.account.balance
          , priceCollateral
          , next.collateral.market.exchangeRateStored
          , marketCollateralData.collateralFactorMantissa
        );
        const collateralLastV = DForceHelper.getCollateralValue(
          last.collateral.account.balance
          , priceCollateral
          , last.collateral.market.exchangeRateStored
          , marketCollateralData.collateralFactorMantissa
        );

        const collateralNext = collateralNextV
          .mul(base)
          .div(priceCollateral)
          .div(marketCollateralData.collateralFactorMantissa);
        const collateralLast = collateralLastV
          .mul(base)
          .div(priceCollateral)
          .div(marketCollateralData.collateralFactorMantissa);
        console.log("collateralNext", collateralNext);
        console.log("collateralLast", collateralLast);

        const deltaCollateralV = collateralLastV.sub(collateralNextV);
        const deltaCollateral = collateralLast.sub(collateralNext);

        const deltaBorrowBalance = last.borrow.account.borrowBalanceStored.sub(next.borrow.account.borrowBalanceStored);

        console.log("before", before);
        console.log("afterBorrow=next", afterBorrow);
        console.log("middle", middle);
        console.log("last", last);

        // calculate exact values of supply/borrow APR
        // we use state-values "after-borrow" and exact values of supply/borrow rates after borrow
        const countBlocksSupply = 1; // after next, we call UpdateInterest for supply token...
        const countBlocksBorrow = 2; // ...then for the borrow token

        console.log("deltaCollateral", deltaCollateral);
        console.log("deltaCollateralV", deltaCollateralV);
        console.log("deltaBorrowBalance", deltaBorrowBalance);

        const supplyApr = await libFacade.getSupplyApr18(
          supplyRatePredicted
          , countBlocksSupply
          , await cTokenCollateral.decimals()
          , priceCollateral
          , priceBorrow
          , amountCollateral
        );
        console.log("supplyApr", supplyApr);
        const supplyAprExact = await libFacade.getSupplyApr18(
          next.collateral.market.supplyRatePerBlock
          , countBlocksSupply
          , await cTokenCollateral.decimals()
          , priceCollateral
          , priceBorrow
          , amountCollateral
        );
        console.log("supplyAprExact", supplyAprExact);

        const borrowApr = await libFacade.getBorrowApr18(
          borrowRatePredicted
          , amountToBorrow
          , countBlocksBorrow
          , await cTokenBorrow.decimals()
        );
        console.log("borrowApr", borrowApr);

        const borrowAprExact = await libFacade.getBorrowApr18(
          middle.borrow.market.borrowRatePerBlock
          , amountToBorrow
          , countBlocksBorrow
          , await cTokenBorrow.decimals()
        );
        console.log("borrowAprExact", borrowApr);

        const deltaCollateralBT = deltaCollateral.mul(priceCollateral).div(priceBorrow);

        // calculate real differences in user-account-balances for period [next block, last block]
        const ret = [
          areAlmostEqual(deltaCollateralBT, supplyApr, 4)
          , areAlmostEqual(deltaBorrowBalance, borrowApr, 5)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(deltaCollateralBT, supplyAprExact, 9)
          , areAlmostEqual(deltaBorrowBalance, borrowAprExact, 9)
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const expected = [
          true
          , true
          , true
          , true
        ].join("\n");

        expect(ret).equals(expected);


      });

      describe.skip("Temp calcs for DForce", () => {
        it("apr", () => {
          const borrowBalanceMiddle = BigNumber.from("58035600000000000000000000000000000000000");
          const borrowBalanceLast = BigNumber.from("58035600197395749574642710000000000000000");
          const collateralBalanceNext = BigNumber.from("169985288199999999999999838023644809698004");
          const collateralBalanceMiddle = BigNumber.from("169985288469050133207406287966044900859892");
          const collateralFactorMantissa = BigNumber.from("850000000000000000");
          const borrowFactorMantissa = BigNumber.from("1000000000000000000")
          const borrowTotalBorrowsMiddle = BigNumber.from("52239880587431260022");
          const borrowTotalBorrowsLast = BigNumber.from("52239880765114102730");

          const priceCollateral = BigNumber.from("999913460000000000");
          const priceBorrow = BigNumber.from("1450890000000000000000");

          const base = getBigNumberFrom(1, 18);
          const double = getBigNumberFrom(1, 36);

          const collateralExchangeRateNext = BigNumber.from("1006072989394821668");
          const collateralExchangeRateMiddle = BigNumber.from("1006072990987218720");

          const c2 = collateralBalanceMiddle.mul(base).div(priceCollateral).div(collateralFactorMantissa);
          const c1 = collateralBalanceNext.mul(base).div(priceCollateral).div(collateralFactorMantissa);
          console.log("c2", c2);
          console.log("c1", c1);

          const cDelta = c2.sub(c1);
          console.log("cDelta", cDelta);

          const b2 = borrowBalanceLast.mul(base).div(priceBorrow).div(borrowFactorMantissa);
          const b1 = borrowBalanceMiddle.mul(base).div(priceBorrow).div(borrowFactorMantissa);
          console.log("b2", b2);
          console.log("b1", b1);

          const bDelta = b2.sub(b1);
          console.log("cDelta", bDelta);
        });

        it.skip("supply rate", async () => {
          const comptroller = await DForceHelper.getController(deployer);
          const im = DForceInterestRateModelMock__factory.connect("0x6Bf21BF8cB213997ac0F3A3b1feD431E2BD0C45a", deployer);

          const totalSupply = BigNumber.from("950110374878895912732010");
          const amountToSupply = BigNumber.from("198862327947469607502699");
          const amountToSupplyExact = BigNumber.from("200000000000000000000000");
          const cash = BigNumber.from("207457975647111909044867");

          const totalBorrow = BigNumber.from("748722543290648981048813");
          const borrowInterest = BigNumber.from("17485895962232384280");
          const reserveInterest = BigNumber.from("1748589596223238428");
          const totalReserves = BigNumber.from("650392243307287326761");
          const borrowRatePerBlock = BigNumber.from("3174864977");
          const borrowRatePerBlockAfter = BigNumber.from("2625382581");
          const reserveRatio = BigNumber.from("100000000000000000");

          const balance = await IERC20__factory.connect(MaticAddresses.DAI, deployer).balanceOf(
            MaticAddresses.dForce_iDAI
          )
          console.log("balance", balance);

          const totalSupplyUpdated = totalSupply.add(amountToSupply);
          console.log("totalSupplyUpdated", totalSupplyUpdated);

          const totalBorrowUpdated = totalBorrow.add(borrowInterest);
          console.log("totalBorrowUpdated", totalBorrowUpdated);

          const totalReservesUpdated = totalReserves.add(reserveInterest);
          console.log("totalReservesUpdated", totalReservesUpdated);

          const cashUpdated = cash.add(amountToSupplyExact);
          console.log("cashUpdated", cashUpdated);

          const br = await im.getBorrowRate(
            cashUpdated,
            totalBorrowUpdated,
            totalReservesUpdated
          );
          console.log("br", br);

          const exchangeRateInternal = DForceHelper.rdiv(
            cashUpdated.add(totalBorrowUpdated).sub(totalReservesUpdated)
            , totalSupplyUpdated
          );
          console.log("exchangeRateInternal", exchangeRateInternal);

          const underlyingScaled = totalSupplyUpdated.mul(exchangeRateInternal);
          console.log("underlyingScaled", underlyingScaled);

          const base = getBigNumberFrom(1, 18);
          const totalBorrowsScaled = totalBorrowUpdated.mul(base);
          console.log("totalBorrowsScaled", totalBorrowsScaled);

          console.log("reserveRatio", reserveRatio)
          console.log("1e18 - reserveRatio", base.sub(reserveRatio))
          console.log("DForceHelper.rdiv(totalBorrowsScaled, underlyingScaled)", DForceHelper.rdiv(totalBorrowsScaled, underlyingScaled))

          const estimatedSupplyRate = DForceHelper.tmul(
            borrowRatePerBlockAfter,
            base.sub(reserveRatio),
            DForceHelper.rdiv(totalBorrowsScaled, underlyingScaled)
          );

          console.log("estimatedSupplyRate", estimatedSupplyRate);
        });
      })
    });

    // describe("Hundred finance", () => {
    //   it("predicted APR should be equal to real APR", async () => {
    //     if (!await isPolygonForkInUse()) return;
    //     const collateralToken = await TokenDataTypes.Build(deployer, ASSET_COLLATERAL);
    //     const borrowToken = await TokenDataTypes.Build(deployer, ASSET_BORROW);
    //
    //     const comptroller = await HundredFinanceHelper.getComptroller(deployer);
    //     const cTokenCollateral = IHfCToken__factory.connect(ASSET_COLLATERAL_HUNDRED_FINANCE_CTOKEN, deployer);
    //     const cTokenBorrow = IHfCToken__factory.connect(ASSET_BORROW_HUNDRED_FINANCE_CTOREN, deployer);
    //     const priceOracle = await HundredFinanceHelper.getPriceOracle(deployer);
    //
    //     const marketCollateralData = await HundredFinanceHelper.getCTokenData(deployer, comptroller, cTokenCollateral);
    //     const marketBorrowData = await HundredFinanceHelper.getCTokenData(deployer, comptroller, cTokenBorrow);
    //
    //     console.log("marketCollateralData", marketCollateralData);
    //     console.log("marketBorrowData", marketBorrowData);
    //
    //     const amountToBorrow = getBigNumberFrom(AMOUNT_TO_BORROW, borrowToken.decimals);
    //     const amountCollateral = getBigNumberFrom(AMOUNT_COLLATERAL, collateralToken.decimals);
    //     console.log(`amountCollateral=${amountCollateral.toString()} amountToBorrow=${amountToBorrow.toString()}`);
    //
    //     // prices
    //     const priceCollateral = await priceOracle.getUnderlyingPrice(ASSET_COLLATERAL_HUNDRED_FINANCE_CTOKEN);
    //     const priceBorrow = await priceOracle.getUnderlyingPrice(ASSET_BORROW_HUNDRED_FINANCE_CTOREN);
    //     console.log("priceCollateral", priceCollateral);
    //     console.log("priceBorrow", priceBorrow);
    //
    //     // predict APR
    //     const libFacade = await DeployUtils.deployContract(deployer, "DForceAprLibFacade") as DForceAprLibFacade;
    //
    //     // start point: we estimate APR in this point before borrow and supply
    //     const before = await getDForceStateInfo(comptroller
    //       , cTokenCollateral
    //       , cTokenBorrow
    //       // we don't have user address at this moment
    //       // so, use dummy address (and get dummy balance values - we don't use them)
    //       , ethers.Wallet.createRandom().address
    //     );
    //
    //     const borrowRatePredicted = await libFacade.getEstimatedBorrowRate(
    //       await cTokenBorrow.interestRateModel()
    //       , cTokenBorrow.address
    //       , amountToBorrow
    //     );
    //
    //     const supplyRatePredicted = await libFacade.getEstimatedSupplyRatePure(
    //       before.collateral.market.totalSupply
    //       , amountCollateral
    //       , before.collateral.market.cash
    //       , before.collateral.market.totalBorrows
    //       , before.collateral.market.totalReserves
    //       , marketCollateralData.interestRateModel
    //       , before.collateral.market.reserveRatio
    //       , before.collateral.market.exchangeRateStored
    //     );
    //
    //     console.log(`Predicted: supplyRate=${supplyRatePredicted.toString()} br=${borrowRatePredicted.toString()}`);
    //
    //     // make borrow
    //     const userAddress = await makeBorrow(deployer
    //       , {
    //         collateral: {
    //           asset: ASSET_COLLATERAL,
    //           holder: HOLDER_COLLATERAL,
    //           initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
    //         }, borrow: {
    //           asset: ASSET_BORROW,
    //           holder: HOLDER_BORROW,
    //           initialLiquidity: INITIAL_LIQUIDITY_BORROW,
    //         }, collateralAmount: AMOUNT_COLLATERAL
    //         , healthFactor2: HEALTH_FACTOR2
    //         , countBlocks: COUNT_BLOCKS
    //       }
    //       , amountToBorrow
    //       , new DForcePlatformFabric()
    //     );
    //
    //     const afterBorrow = await getDForceStateInfo(comptroller
    //       , cTokenCollateral
    //       , cTokenBorrow
    //       , userAddress
    //     );
    //
    //     // next => last
    //     const next = afterBorrow;
    //
    //     // For collateral: move ahead on single block
    //     await cTokenCollateral.updateInterest(); //await TimeUtils.advanceNBlocks(1);
    //
    //     const middle = await getDForceStateInfo(comptroller
    //       , cTokenCollateral
    //       , cTokenBorrow
    //       , userAddress
    //     );
    //
    //     // For borrow: move ahead on one more block
    //     await cTokenBorrow.updateInterest();
    //
    //     const last = await getDForceStateInfo(comptroller
    //       , cTokenCollateral
    //       , cTokenBorrow
    //       , userAddress
    //     );
    //     const base = getBigNumberFrom(1, 18);
    //
    //     const collateralNextV = DForceHelper.getCollateralValue(
    //       next.collateral.account.balance
    //       , priceCollateral
    //       , next.collateral.market.exchangeRateStored
    //       , marketCollateralData.collateralFactorMantissa
    //     );
    //     const collateralLastV = DForceHelper.getCollateralValue(
    //       last.collateral.account.balance
    //       , priceCollateral
    //       , last.collateral.market.exchangeRateStored
    //       , marketCollateralData.collateralFactorMantissa
    //     );
    //
    //     const collateralNext = collateralNextV
    //       .mul(base)
    //       .div(priceCollateral)
    //       .div(marketCollateralData.collateralFactorMantissa);
    //     const collateralLast = collateralLastV
    //       .mul(base)
    //       .div(priceCollateral)
    //       .div(marketCollateralData.collateralFactorMantissa);
    //     console.log("collateralNext", collateralNext);
    //     console.log("collateralLast", collateralLast);
    //
    //     const deltaCollateralV = collateralLastV.sub(collateralNextV);
    //     const deltaCollateral = collateralLast.sub(collateralNext);
    //
    //     const deltaBorrowBalance = last.borrow.account.borrowBalanceStored.sub(next.borrow.account.borrowBalanceStored);
    //
    //     console.log("before", before);
    //     console.log("afterBorrow=next", afterBorrow);
    //     console.log("middle", middle);
    //     console.log("last", last);
    //
    //     // calculate exact values of supply/borrow APR
    //     // we use state-values "after-borrow" and exact values of supply/borrow rates after borrow
    //     const countBlocksSupply = 1; // after next, we call UpdateInterest for supply token...
    //     const countBlocksBorrow = 2; // ...then for the borrow token
    //
    //     console.log("deltaCollateral", deltaCollateral);
    //     console.log("deltaCollateralV", deltaCollateralV);
    //     console.log("deltaBorrowBalance", deltaBorrowBalance);
    //
    //     const supplyApr = await libFacade.getSupplyApr18(
    //       supplyRatePredicted
    //       , countBlocksSupply
    //       , await cTokenCollateral.decimals()
    //       , priceCollateral
    //       , priceBorrow
    //       , amountCollateral
    //     );
    //     console.log("supplyApr", supplyApr);
    //     const supplyAprExact = await libFacade.getSupplyApr18(
    //       next.collateral.market.supplyRatePerBlock
    //       , countBlocksSupply
    //       , await cTokenCollateral.decimals()
    //       , priceCollateral
    //       , priceBorrow
    //       , amountCollateral
    //     );
    //     console.log("supplyAprExact", supplyAprExact);
    //
    //     const borrowApr = await libFacade.getBorrowApr18(
    //       borrowRatePredicted
    //       , amountToBorrow
    //       , countBlocksBorrow
    //       , await cTokenBorrow.decimals()
    //     );
    //     console.log("borrowApr", borrowApr);
    //
    //     const borrowAprExact = await libFacade.getBorrowApr18(
    //       middle.borrow.market.borrowRatePerBlock
    //       , amountToBorrow
    //       , countBlocksBorrow
    //       , await cTokenBorrow.decimals()
    //     );
    //     console.log("borrowAprExact", borrowApr);
    //
    //     const deltaCollateralBT = deltaCollateral.mul(priceCollateral).div(priceBorrow);
    //
    //     // calculate real differences in user-account-balances for period [next block, last block]
    //     const ret = [
    //       areAlmostEqual(deltaCollateralBT, supplyApr, 4)
    //       , areAlmostEqual(deltaBorrowBalance, borrowApr, 5)
    //
    //       // not exact because real supply and borrow rate are rounded
    //       , areAlmostEqual(deltaCollateralBT, supplyAprExact, 9)
    //       , areAlmostEqual(deltaBorrowBalance, borrowAprExact, 9)
    //     ].join("\n");
    //
    //     // these differences must be equal to exact supply/borrow APR
    //     const expected = [
    //       true
    //       , true
    //       , true
    //       , true
    //     ].join("\n");
    //
    //     expect(ret).equals(expected);
    //
    //
    //   });
    // });
  });
});

