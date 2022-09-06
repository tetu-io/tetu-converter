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
import {BorrowRepayUsesCase} from "../baseUT/uses-cases/BorrowRepayUsesCase";
import {AaveTwoPlatformFabric} from "../baseUT/fabrics/AaveTwoPlatformFabric";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {Aave3Helper} from "../../scripts/integration/helpers/Aave3Helper";
import {
  Aave3AprLib__factory,
  Aave3AprLibFacade,
  AaveTwoAprLibFacade,
  IAavePool,
  IAaveToken__factory, IAaveTwoPool
} from "../../typechain";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import exp from "constants";
import {expect} from "chai";
import {AaveTwoHelper} from "../../scripts/integration/helpers/AaveTwoHelper";
import {DForceHelper} from "../../scripts/integration/helpers/DForceHelper";
import {Aave3DataTypes} from "../../typechain/contracts/integrations/aave3/IAavePool";
import {DataTypes} from "../../typechain/contracts/integrations/aaveTwo/IAaveTwoPool";

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

//region Making borrow impl
  async function makeBorrow (
    deployer: SignerWithAddress,
    p: TestSingleBorrowParams,
    amountToBorrow: BigNumber,
    fabric: ILendingPlatformFabric,
  ) : Promise<string> {
    const {controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
    const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.healthFactor2, p.countBlocks);

    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const c0 = await setInitialBalance(deployer, collateralToken.address
      , p.collateral.holder, p.collateral.initialLiquidity, uc.address);
    const b0 = await setInitialBalance(deployer, borrowToken.address
      , p.borrow.holder, p.borrow.initialLiquidity, uc.address);
    const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

    // borrow max allowed amount
    await uc.makeBorrowExactAmount(p.collateral.asset, collateralAmount, p.borrow.asset, uc.address, amountToBorrow);

    const poolAdapters = await uc.getBorrows(p.collateral.asset, p.borrow.asset);
    return poolAdapters[0];
  }
//endregion Making borrow impl

//region Aave data type and utils
  interface IAaveKeyState {
    rate: BigNumber;
    liquidityIndex: BigNumber;
    reserveNormalized: BigNumber;
    block: number;
    blockTimeStamp: number;
    scaledBalance: BigNumber;
    userBalanceBase: BigNumber
    lastUpdateTimestamp: number;
  }

  interface IAaveKeyTestValues {
    borrowRatePredicted: BigNumber;
    liquidityRatePredicted: BigNumber;

    liquidity: {
      beforeBorrow: IAaveKeyState,
      afterBorrow: IAaveKeyState,
      next: IAaveKeyState,
      last: IAaveKeyState
    },
    borrow: {
      beforeBorrow: IAaveKeyState,
      afterBorrow: IAaveKeyState,
      next: IAaveKeyState,
      last: IAaveKeyState
    },
  }

//region AAVE3
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

  async function getAave3StateInfo(
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

  /** Calc APR in the state BEFORE the supply/borrow operation
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
//endregion AAVE3

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

//endregion Aave data type and utils

  describe("DAI => WETH", () => {
    const ASSET_COLLATERAL = MaticAddresses.DAI;
    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
    const ASSET_BORROW = MaticAddresses.WETH;
    const HOLDER_BORROW = MaticAddresses.HOLDER_WETH;
    const AMOUNT_COLLATERAL = 200_000;
    const INITIAL_LIQUIDITY_COLLATERAL = 1_000_000;
    const INITIAL_LIQUIDITY_BORROW = 100;
    const HEALTH_FACTOR2 = 200;
    const COUNT_BLOCKS = 1;
    const AMOUNT_TO_BORROW = 40;

    describe("AAVE3", () => {
      it("predicted APR should be equal to real APR", async () => {
        if (!await isPolygonForkInUse()) return;

        const collateralToken = await TokenDataTypes.Build(deployer, ASSET_COLLATERAL);
        const borrowToken = await TokenDataTypes.Build(deployer, ASSET_BORROW);

        const h: Aave3Helper = new Aave3Helper(deployer);
        const aavePool = await Aave3Helper.getAavePool(deployer);
        const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);
        const priceOracle = await Aave3Helper.getAavePriceOracle(deployer);

        const borrowReserveData = await dp.getReserveData(ASSET_BORROW);
        const collateralReserveData = await dp.getReserveData(ASSET_COLLATERAL);

        const amountToBorrow = getBigNumberFrom(AMOUNT_TO_BORROW, borrowToken.decimals);
        const amountCollateral = getBigNumberFrom(AMOUNT_COLLATERAL, collateralToken.decimals);
        console.log(`amountCollateral=${amountCollateral.toString()} amountToBorrow=${amountToBorrow.toString()}`);

        // prices
        const prices = await priceOracle.getAssetsPrices([ASSET_COLLATERAL, ASSET_BORROW]);
        const priceCollateral = prices[0];
        const priceBorrow = prices[1];

        // predict APR
        const libFacade = await DeployUtils.deployContract(deployer, "Aave3AprLibFacade") as Aave3AprLibFacade;

        // start point: we estimate APR in this point before borrow and supply
        const before = await getAave3StateInfo(aavePool, ASSET_COLLATERAL, ASSET_BORROW);

        const liquidityRateRaysPredicted = await libFacade.getLiquidityRateRays(
          before.collateral.data, // collateralAssetData,
          ASSET_COLLATERAL,
          amountCollateral,
          collateralReserveData.totalStableDebt,
          collateralReserveData.totalVariableDebt,
        );
        const brRaysPredicted = (await libFacade.getVariableBorrowRateRays(
          before.borrow.data, // borrowAssetData,
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
          , new Aave3PlatformFabric()
        );

        const afterBorrow = await getAave3StateInfo(aavePool, ASSET_COLLATERAL, ASSET_BORROW, userAddress);

        // next => last
        const next = afterBorrow;
        await TimeUtils.advanceNBlocks(1);
        const last = await getAave3StateInfo(aavePool, ASSET_COLLATERAL, ASSET_BORROW, userAddress);

        const deltaCollateralBase = last.userAccount!.totalCollateralBase.sub(next.userAccount!.totalCollateralBase);
        const deltaBorrowBase = last.userAccount!.totalDebtBase.sub(next.userAccount!.totalDebtBase);
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
              userBalanceBase: afterBorrow.userAccount!.totalCollateralBase,
              lastUpdateTimestamp: afterBorrow.collateral.data.lastUpdateTimestamp
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

        const supplyApr = await getAprAAVE3Base(
          libFacade
          , amountCollateral
          , liquidityRateRaysPredicted
          , priceCollateral
          , countBlocks
          , keyValues.liquidity.afterBorrow
          , blocksPerDay
        );
        console.log("supplyAprExact", supplyApr);
        const borrowApr = await getAprAAVE3Base(
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
        const supplyAprApprox = await getAprBeforeAAVE3Base(
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

        const borrowAprApprox = await getAprBeforeAAVE3Base(
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
        const ret = [
          last.userAccount!.totalCollateralBase.sub(next.userAccount!.totalCollateralBase).toString(),
          last.userAccount!.totalDebtBase.sub(next.userAccount!.totalDebtBase).toString(),

          last.userAccount!.totalCollateralBase.sub(next.userAccount!.totalCollateralBase).toString(),
          last.userAccount!.totalDebtBase.sub(next.userAccount!.totalDebtBase).toString()
        ].join();

        // these differences must be equal to exact supply/borrow APR
        const expected = [
          supplyApr.toString(), borrowApr.toString(),

          supplyAprApprox.toString(), borrowAprApprox.toString()
        ].join();

        expect(ret).equals(expected);
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

    describe("DeForce", () => {
      it("predicted APR should be equal to real APR", async () => {
        if (!await isPolygonForkInUse()) return;
TODO
        const collateralToken = await TokenDataTypes.Build(deployer, ASSET_COLLATERAL);
        const borrowToken = await TokenDataTypes.Build(deployer, ASSET_BORROW);

        const h: Aave3Helper = new Aave3Helper(deployer);
        const aavePool = await Aave3Helper.getAavePool(deployer);
        const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);
        const priceOracle = await Aave3Helper.getAavePriceOracle(deployer);

        const borrowReserveData = await dp.getReserveData(ASSET_BORROW);
        const collateralReserveData = await dp.getReserveData(ASSET_COLLATERAL);

        const amountToBorrow = getBigNumberFrom(AMOUNT_TO_BORROW, borrowToken.decimals);
        const amountCollateral = getBigNumberFrom(AMOUNT_COLLATERAL, collateralToken.decimals);
        console.log(`amountCollateral=${amountCollateral.toString()} amountToBorrow=${amountToBorrow.toString()}`);

        // prices
        const prices = await priceOracle.getAssetsPrices([ASSET_COLLATERAL, ASSET_BORROW]);
        const priceCollateral = prices[0];
        const priceBorrow = prices[1];

        // predict APR
        const libFacade = await DeployUtils.deployContract(deployer, "Aave3AprLibFacade") as Aave3AprLibFacade;

        // start point: we estimate APR in this point before borrow and supply
        const before = await getAave3StateInfo(aavePool, ASSET_COLLATERAL, ASSET_BORROW);

        const liquidityRateRaysPredicted = await libFacade.getLiquidityRateRays(
          before.collateral.data, // collateralAssetData,
          ASSET_COLLATERAL,
          amountCollateral,
          collateralReserveData.totalStableDebt,
          collateralReserveData.totalVariableDebt,
        );
        const brRaysPredicted = (await libFacade.getVariableBorrowRateRays(
          before.borrow.data, // borrowAssetData,
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
          , new Aave3PlatformFabric()
        );

        const afterBorrow = await getAave3StateInfo(aavePool, ASSET_COLLATERAL, ASSET_BORROW, userAddress);

        // next => last
        const next = afterBorrow;
        await TimeUtils.advanceNBlocks(1);
        const last = await getAave3StateInfo(aavePool, ASSET_COLLATERAL, ASSET_BORROW, userAddress);

        const deltaCollateralBase = last.userAccount!.totalCollateralBase.sub(next.userAccount!.totalCollateralBase);
        const deltaBorrowBase = last.userAccount!.totalDebtBase.sub(next.userAccount!.totalDebtBase);
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
              userBalanceBase: afterBorrow.userAccount!.totalCollateralBase,
              lastUpdateTimestamp: afterBorrow.collateral.data.lastUpdateTimestamp
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

        const supplyApr = await getAprAAVE3Base(
          libFacade
          , amountCollateral
          , liquidityRateRaysPredicted
          , priceCollateral
          , countBlocks
          , keyValues.liquidity.afterBorrow
          , blocksPerDay
        );
        console.log("supplyAprExact", supplyApr);
        const borrowApr = await getAprAAVE3Base(
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
        const supplyAprApprox = await getAprBeforeAAVE3Base(
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

        const borrowAprApprox = await getAprBeforeAAVE3Base(
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
        const ret = [
          last.userAccount!.totalCollateralBase.sub(next.userAccount!.totalCollateralBase).toString(),
          last.userAccount!.totalDebtBase.sub(next.userAccount!.totalDebtBase).toString(),

          last.userAccount!.totalCollateralBase.sub(next.userAccount!.totalCollateralBase).toString(),
          last.userAccount!.totalDebtBase.sub(next.userAccount!.totalDebtBase).toString()
        ].join();

        // these differences must be equal to exact supply/borrow APR
        const expected = [
          supplyApr.toString(), borrowApr.toString(),

          supplyAprApprox.toString(), borrowAprApprox.toString()
        ].join();

        expect(ret).equals(expected);
      });
    });

  });
});

