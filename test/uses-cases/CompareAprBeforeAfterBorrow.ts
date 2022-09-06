import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {TokenDataTypes} from "../baseUT/types/TokenDataTypes";
import {setInitialBalance} from "../baseUT/utils/CommonUtils";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {TestSingleBorrowParams} from "../baseUT/types/BorrowRepayDataTypes";
import {ILendingPlatformFabric} from "../baseUT/fabrics/ILendingPlatformFabric";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";
import {BorrowRepayUsesCase} from "../baseUT/uses-cases/BorrowRepayUsesCase";
import {AaveTwoPlatformFabric} from "../baseUT/fabrics/AaveTwoPlatformFabric";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {Aave3Helper} from "../../scripts/integration/helpers/Aave3Helper";
import {Aave3AprLib__factory, Aave3AprLibFacade, AaveTwoAprLibFacade, IAaveToken__factory} from "../../typechain";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import exp from "constants";
import {expect} from "chai";
import {AaveTwoHelper} from "../../scripts/integration/helpers/AaveTwoHelper";

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
  interface IKeyState {
    rate: BigNumber;
    liquidityIndex: BigNumber;
    reserveNormalized: BigNumber;
    block: number;
    blockTimeStamp: number;
    scaledBalance: BigNumber;
    userBalanceBase: BigNumber
    lastUpdateTimestamp: number;
  }

  interface IKeyTestValues {
    borrowRatePredicted: BigNumber;
    liquidityRatePredicted: BigNumber;

    liquidity: {
      beforeBorrow: IKeyState,
      afterBorrow: IKeyState,
      next: IKeyState,
      last: IKeyState
    },
    borrow: {
      beforeBorrow: IKeyState,
      afterBorrow: IKeyState,
      next: IKeyState,
      last: IKeyState
    },
  }
//endregion Data type

//region Test impl

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
//endregion Test impl

//region Get APR, AAVE v3
  /** Calc APR in the state AFTER the supply/borrow operation */
  async function getAprAAVE3(
    libFacade: Aave3AprLibFacade,
    amount: BigNumber,
    predictedRate: BigNumber,
    price18: BigNumber,
    countBlocks: number,
    state: IKeyState,
    blocksPerDay: number
  ) : Promise<BigNumber> {
    return await libFacade.getAprForPeriodAfter(
      amount,
      state.reserveNormalized,
      state.liquidityIndex,
      predictedRate,
      countBlocks,
      blocksPerDay,
      price18
    );
  }

  /** Calc APR in the state BEFORE the supply/borrow operation */
  async function getAprBeforeAAVE3(
    libFacade: Aave3AprLibFacade,
    amount: BigNumber,
    predictedRate: BigNumber,
    price18: BigNumber,
    countBlocks: number,
    state: IKeyState,
    blocksPerDay: number,
    operationTimestamp: number
  ) : Promise<BigNumber> {
    return await libFacade.getAprForPeriodBefore(
      {
        liquidityIndex: state.liquidityIndex,
        rate: state.rate,
        lastUpdateTimestamp: state.lastUpdateTimestamp
      },
      amount,
      predictedRate,
      countBlocks,
      blocksPerDay,
      price18,
      operationTimestamp
    );
  }
//endregion Get APR, AAVE v3

//region Get APR, AAVE v2
  /** Calc APR in the state AFTER the supply/borrow operation */
  async function getAprAAVETwo(
    libFacade: AaveTwoAprLibFacade,
    amount: BigNumber,
    predictedRate: BigNumber,
    price18: BigNumber,
    countBlocks: number,
    state: IKeyState,
    blocksPerDay: number
  ) : Promise<BigNumber> {
    return await libFacade.getAprForPeriodAfter(
      amount,
      state.reserveNormalized,
      state.liquidityIndex,
      predictedRate,
      countBlocks,
      blocksPerDay,
      price18
    );
  }

  /** Calc APR in the state BEFORE the supply/borrow operation */
  async function getAprBeforeAAVETwo(
    libFacade: AaveTwoAprLibFacade,
    amount: BigNumber,
    predictedRate: BigNumber,
    price18: BigNumber,
    countBlocks: number,
    state: IKeyState,
    blocksPerDay: number,
    operationTimestamp: number
  ) : Promise<BigNumber> {
    return await libFacade.getAprForPeriodBefore(
      {
        liquidityIndex: state.liquidityIndex,
        rate: state.rate,
        lastUpdateTimestamp: state.lastUpdateTimestamp
      },
      amount,
      predictedRate,
      countBlocks,
      blocksPerDay,
      price18,
      operationTimestamp
    );
  }
//endregion Get APR, AAVE v2

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

        const collateralAssetData = await aavePool.getReserveData(ASSET_COLLATERAL);
        const borrowAssetData = await aavePool.getReserveData(ASSET_BORROW);
        const reserveNormalizedBeforeBorrow = await aavePool.getReserveNormalizedIncome(ASSET_COLLATERAL);
        const borrowReserveNormalizedBeforeBorrow = await aavePool.getReserveNormalizedVariableDebt(ASSET_BORROW);

        console.log("collateralAssetData", collateralAssetData);
        console.log("borrowAssetData", borrowAssetData);

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
        const libFacade = await DeployUtils.deployContract(deployer, "Aave3AprLibFacade") as Aave3AprLibFacade;

        const brRaysPredicted = (await libFacade.getVariableBorrowRateRays(
          borrowAssetData,
          ASSET_BORROW,
          amountToBorrow,
          borrowReserveData.totalStableDebt,
          borrowReserveData.totalVariableDebt
        ));
        const liquidityRateRaysPredicted = await libFacade.getLiquidityRateRays(
          collateralAssetData,
          ASSET_COLLATERAL,
          amountCollateral,
          collateralReserveData.totalStableDebt,
          collateralReserveData.totalVariableDebt,
        );
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

        const afterBorrow = await aavePool.getUserAccountData(userAddress);
        const collateralAssetDataAfterBorrow = await aavePool.getReserveData(ASSET_COLLATERAL);
        const borrowAssetDataAfterBorrow = await aavePool.getReserveData(ASSET_BORROW);
        const reserveNormalizedAfterBorrow = await aavePool.getReserveNormalizedIncome(ASSET_COLLATERAL);
        const borrowReserveNormalizedAfterBorrow = await aavePool.getReserveNormalizedVariableDebt(ASSET_BORROW);
        const collateralScaledBalanceAfterBorrow = await IAaveToken__factory.connect(collateralAssetData.aTokenAddress, deployer)
          .scaledBalanceOf(userAddress);
        const borrowScaledBalanceAfterBorrow = await IAaveToken__factory.connect(borrowAssetDataAfterBorrow.variableDebtTokenAddress, deployer)
          .scaledBalanceOf(userAddress);
        const blockAfterBorrow = await hre.ethers.provider.getBlock("latest");

        console.log("collateralAssetDataAfterBorrow", collateralAssetData);
        console.log("borrowAssetDataAfterBorrow", borrowAssetData);


        // how user account balances are changed after 1 block
        const next = await aavePool.getUserAccountData(userAddress);
        const reserveNormalizedIncomeNext = await aavePool.getReserveNormalizedIncome(ASSET_COLLATERAL);
        const borrowReserveNormalizedNext = await aavePool.getReserveNormalizedVariableDebt(ASSET_BORROW);
        const collateralScaledBalanceNext = await IAaveToken__factory.connect(collateralAssetData.aTokenAddress, deployer)
            .scaledBalanceOf(userAddress);
        const borrowScaledBalanceNext = await IAaveToken__factory.connect(borrowAssetDataAfterBorrow.variableDebtTokenAddress, deployer)
          .scaledBalanceOf(userAddress);

        const blockNext = await hre.ethers.provider.getBlock("latest");

        await TimeUtils.advanceNBlocks(1);
        const last = await aavePool.getUserAccountData(userAddress);
        const reserveNormalizedIncomeLast = await aavePool.getReserveNormalizedIncome(ASSET_COLLATERAL);
        const borrowReserveNormalizedLast = await aavePool.getReserveNormalizedVariableDebt(ASSET_BORROW);
        const collateralScaledBalanceLast = await IAaveToken__factory.connect(collateralAssetData.aTokenAddress, deployer)
          .scaledBalanceOf(userAddress);
        const borrowScaledBalanceLast = await IAaveToken__factory.connect(borrowAssetDataAfterBorrow.variableDebtTokenAddress, deployer)
          .scaledBalanceOf(userAddress);

        const blockLast = await hre.ethers.provider.getBlock("latest");

        console.log("user account before", next);
        console.log("user account after", last);

        const deltaCollateralBase = last.totalCollateralBase.sub(next.totalCollateralBase);
        const deltaBorrowBase = last.totalDebtBase.sub(next.totalDebtBase);
        console.log("deltaCollateralBase", deltaCollateralBase);
        console.log("deltaBorrowBase", deltaBorrowBase);
        console.log("priceBorrow", priceBorrow);

        const keyValues: IKeyTestValues = {
          borrowRatePredicted: brRaysPredicted,
          liquidityRatePredicted: liquidityRateRaysPredicted,

          liquidity: {
            beforeBorrow: {
              block: blockBeforeBorrow.number,
              blockTimeStamp: blockBeforeBorrow.timestamp,
              rate: collateralAssetData.currentLiquidityRate,
              liquidityIndex: collateralAssetData.liquidityIndex,
              scaledBalance: BigNumber.from(0),
              reserveNormalized: reserveNormalizedBeforeBorrow,
              userBalanceBase: BigNumber.from(0),
              lastUpdateTimestamp: collateralAssetData.lastUpdateTimestamp
            },
            afterBorrow: {
              block: blockAfterBorrow.number,
              blockTimeStamp: blockAfterBorrow.timestamp,
              rate: collateralAssetDataAfterBorrow.currentLiquidityRate,
              liquidityIndex: collateralAssetDataAfterBorrow.liquidityIndex,
              scaledBalance: collateralScaledBalanceAfterBorrow,
              reserveNormalized: reserveNormalizedAfterBorrow,
              userBalanceBase: afterBorrow.totalCollateralBase,
              lastUpdateTimestamp: collateralAssetDataAfterBorrow.lastUpdateTimestamp
            },
            next: {
              block: blockNext.number,
              blockTimeStamp: blockNext.timestamp,
              rate: collateralAssetDataAfterBorrow.currentLiquidityRate,
              liquidityIndex: collateralAssetDataAfterBorrow.liquidityIndex,
              scaledBalance: collateralScaledBalanceNext,
              reserveNormalized: reserveNormalizedIncomeNext,
              userBalanceBase: next.totalCollateralBase,
              lastUpdateTimestamp: collateralAssetDataAfterBorrow.lastUpdateTimestamp
            },
            last: {
              block: blockLast.number,
              blockTimeStamp: blockLast.timestamp,
              rate: collateralAssetDataAfterBorrow.currentLiquidityRate,
              liquidityIndex: collateralAssetDataAfterBorrow.liquidityIndex,
              scaledBalance: collateralScaledBalanceLast,
              reserveNormalized: reserveNormalizedIncomeLast,
              userBalanceBase: last.totalCollateralBase,
              lastUpdateTimestamp: collateralAssetDataAfterBorrow.lastUpdateTimestamp
            }
          },
          borrow: {
            beforeBorrow: {
              block: blockBeforeBorrow.number,
              blockTimeStamp: blockBeforeBorrow.timestamp,
              rate: borrowAssetData.currentVariableBorrowRate,
              liquidityIndex: borrowAssetData.variableBorrowIndex,
              scaledBalance: BigNumber.from(0),
              reserveNormalized: borrowReserveNormalizedBeforeBorrow,
              userBalanceBase: BigNumber.from(0),
              lastUpdateTimestamp: borrowAssetData.lastUpdateTimestamp
            },
            afterBorrow: {
              block: blockAfterBorrow.number,
              blockTimeStamp: blockAfterBorrow.timestamp,
              rate: borrowAssetDataAfterBorrow.currentVariableBorrowRate,
              liquidityIndex: borrowAssetDataAfterBorrow.variableBorrowIndex,
              scaledBalance: borrowScaledBalanceAfterBorrow,
              reserveNormalized: borrowReserveNormalizedAfterBorrow,
              userBalanceBase: afterBorrow.totalDebtBase,
              lastUpdateTimestamp: borrowAssetDataAfterBorrow.lastUpdateTimestamp,
            },
            next: {
              block: blockNext.number,
              blockTimeStamp: blockNext.timestamp,
              rate: borrowAssetDataAfterBorrow.currentVariableBorrowRate,
              liquidityIndex: borrowAssetDataAfterBorrow.variableBorrowIndex,
              scaledBalance: borrowScaledBalanceNext,
              reserveNormalized: borrowReserveNormalizedNext,
              userBalanceBase: next.totalDebtBase,
              lastUpdateTimestamp: borrowAssetDataAfterBorrow.lastUpdateTimestamp,
            },
            last: {
              block: blockLast.number,
              blockTimeStamp: blockLast.timestamp,
              rate: borrowAssetData.currentVariableBorrowRate,
              liquidityIndex: borrowAssetData.variableBorrowIndex,
              scaledBalance: borrowScaledBalanceLast,
              reserveNormalized: borrowReserveNormalizedLast,
              userBalanceBase: last.totalDebtBase,
              lastUpdateTimestamp: borrowAssetDataAfterBorrow.lastUpdateTimestamp,
            }
          },
        };

        console.log("key", keyValues);

        const ray = getBigNumberFrom(1, 27);
        const hr = ray.div(2);
        const resultBalance = collateralScaledBalanceNext
          .mul(priceCollateral)
          .mul(
            ray.add(
              collateralAssetDataAfterBorrow.currentLiquidityRate
                .mul(1)
                .div(31536000)
            )
            .mul(collateralAssetDataAfterBorrow.liquidityIndex)
            .div(ray)
          );
        console.log("result", resultBalance);

        // calculate exact values of supply/borrow APR
        // we use state-values "after-borrow" and exact values of supply/borrow rates after borrow
        const countBlocks = keyValues.liquidity.last.blockTimeStamp - keyValues.liquidity.next.blockTimeStamp;
        // for test purpose assume that we have exactly 1 block per 1 second
        const blocksPerDay = 86400;
        console.log("countBlocks", countBlocks);

        const supplyApr = await getAprAAVE3(
          libFacade
          , amountCollateral
          , liquidityRateRaysPredicted
          , priceCollateral
          , countBlocks
          , keyValues.liquidity.afterBorrow
          , blocksPerDay
        );
        console.log("supplyAprExact", supplyApr);
        const borrowApr = await getAprAAVE3(
          libFacade
          , amountToBorrow
          , borrowAssetDataAfterBorrow.currentVariableBorrowRate
          , priceBorrow
          , countBlocks
          , keyValues.borrow.afterBorrow
          , blocksPerDay
        );
        console.log("borrowAprExact", borrowApr);

        // calculate approx values of supply/borrow APR
        // we use state-values "before-borrow" and predicted values of supply/borrow rates after borrow
        const supplyAprApprox = await getAprBeforeAAVE3(
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
        const borrowAprApprox = await getAprBeforeAAVE3(
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
          last.totalCollateralBase.sub(next.totalCollateralBase).toString(),
          last.totalDebtBase.sub(next.totalDebtBase).toString(),

          last.totalCollateralBase.sub(next.totalCollateralBase).toString(),
          last.totalDebtBase.sub(next.totalDebtBase).toString()
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

        const collateralAssetData = await aavePool.getReserveData(ASSET_COLLATERAL);
        const borrowAssetData = await aavePool.getReserveData(ASSET_BORROW);
        const reserveNormalizedBeforeBorrow = await aavePool.getReserveNormalizedIncome(ASSET_COLLATERAL);
        const borrowReserveNormalizedBeforeBorrow = await aavePool.getReserveNormalizedVariableDebt(ASSET_BORROW);

        console.log("collateralAssetData", collateralAssetData);
        console.log("borrowAssetData", borrowAssetData);

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

        const brRaysPredicted = (await libFacade.getVariableBorrowRateRays(
          borrowAssetData,
          ASSET_BORROW,
          amountToBorrow,
          borrowReserveData.totalStableDebt,
          borrowReserveData.totalVariableDebt
        ));
        const liquidityRateRaysPredicted = await libFacade.getLiquidityRateRays(
          collateralAssetData,
          ASSET_COLLATERAL,
          amountCollateral,
          collateralReserveData.totalStableDebt,
          collateralReserveData.totalVariableDebt,
        );
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

        const afterBorrow = await aavePool.getUserAccountData(userAddress);
        const collateralAssetDataAfterBorrow = await aavePool.getReserveData(ASSET_COLLATERAL);
        const borrowAssetDataAfterBorrow = await aavePool.getReserveData(ASSET_BORROW);
        const reserveNormalizedAfterBorrow = await aavePool.getReserveNormalizedIncome(ASSET_COLLATERAL);
        const borrowReserveNormalizedAfterBorrow = await aavePool.getReserveNormalizedVariableDebt(ASSET_BORROW);
        const collateralScaledBalanceAfterBorrow = await IAaveToken__factory.connect(collateralAssetData.aTokenAddress, deployer)
          .scaledBalanceOf(userAddress);
        const borrowScaledBalanceAfterBorrow = await IAaveToken__factory.connect(borrowAssetDataAfterBorrow.variableDebtTokenAddress, deployer)
          .scaledBalanceOf(userAddress);
        const blockAfterBorrow = await hre.ethers.provider.getBlock("latest");

        console.log("collateralAssetDataAfterBorrow", collateralAssetData);
        console.log("borrowAssetDataAfterBorrow", borrowAssetData);


        // how user account balances are changed after 1 block
        const next = await aavePool.getUserAccountData(userAddress);
        const reserveNormalizedIncomeNext = await aavePool.getReserveNormalizedIncome(ASSET_COLLATERAL);
        const borrowReserveNormalizedNext = await aavePool.getReserveNormalizedVariableDebt(ASSET_BORROW);
        const collateralScaledBalanceNext = await IAaveToken__factory.connect(collateralAssetData.aTokenAddress, deployer)
          .scaledBalanceOf(userAddress);
        const borrowScaledBalanceNext = await IAaveToken__factory.connect(borrowAssetDataAfterBorrow.variableDebtTokenAddress, deployer)
          .scaledBalanceOf(userAddress);

        const blockNext = await hre.ethers.provider.getBlock("latest");

        await TimeUtils.advanceNBlocks(1);
        const last = await aavePool.getUserAccountData(userAddress);
        const reserveNormalizedIncomeLast = await aavePool.getReserveNormalizedIncome(ASSET_COLLATERAL);
        const borrowReserveNormalizedLast = await aavePool.getReserveNormalizedVariableDebt(ASSET_BORROW);
        const collateralScaledBalanceLast = await IAaveToken__factory.connect(collateralAssetData.aTokenAddress, deployer)
          .scaledBalanceOf(userAddress);
        const borrowScaledBalanceLast = await IAaveToken__factory.connect(borrowAssetDataAfterBorrow.variableDebtTokenAddress, deployer)
          .scaledBalanceOf(userAddress);

        const blockLast = await hre.ethers.provider.getBlock("latest");

        console.log("user account before", next);
        console.log("user account after", last);

        const deltaCollateralBase = last.totalCollateralETH.sub(next.totalCollateralETH);
        const deltaBorrowBase = last.totalDebtETH.sub(next.totalDebtETH);
        console.log("deltaCollateralBase", deltaCollateralBase);
        console.log("deltaBorrowBase", deltaBorrowBase);
        console.log("priceBorrow", priceBorrow);

        const keyValues: IKeyTestValues = {
          borrowRatePredicted: brRaysPredicted,
          liquidityRatePredicted: liquidityRateRaysPredicted,

          liquidity: {
            beforeBorrow: {
              block: blockBeforeBorrow.number,
              blockTimeStamp: blockBeforeBorrow.timestamp,
              rate: collateralAssetData.currentLiquidityRate,
              liquidityIndex: collateralAssetData.liquidityIndex,
              scaledBalance: BigNumber.from(0),
              reserveNormalized: reserveNormalizedBeforeBorrow,
              userBalanceBase: BigNumber.from(0),
              lastUpdateTimestamp: collateralAssetData.lastUpdateTimestamp
            },
            afterBorrow: {
              block: blockAfterBorrow.number,
              blockTimeStamp: blockAfterBorrow.timestamp,
              rate: collateralAssetDataAfterBorrow.currentLiquidityRate,
              liquidityIndex: collateralAssetDataAfterBorrow.liquidityIndex,
              scaledBalance: collateralScaledBalanceAfterBorrow,
              reserveNormalized: reserveNormalizedAfterBorrow,
              userBalanceBase: afterBorrow.totalCollateralETH,
              lastUpdateTimestamp: collateralAssetDataAfterBorrow.lastUpdateTimestamp
            },
            next: {
              block: blockNext.number,
              blockTimeStamp: blockNext.timestamp,
              rate: collateralAssetDataAfterBorrow.currentLiquidityRate,
              liquidityIndex: collateralAssetDataAfterBorrow.liquidityIndex,
              scaledBalance: collateralScaledBalanceNext,
              reserveNormalized: reserveNormalizedIncomeNext,
              userBalanceBase: next.totalCollateralETH,
              lastUpdateTimestamp: collateralAssetDataAfterBorrow.lastUpdateTimestamp
            },
            last: {
              block: blockLast.number,
              blockTimeStamp: blockLast.timestamp,
              rate: collateralAssetDataAfterBorrow.currentLiquidityRate,
              liquidityIndex: collateralAssetDataAfterBorrow.liquidityIndex,
              scaledBalance: collateralScaledBalanceLast,
              reserveNormalized: reserveNormalizedIncomeLast,
              userBalanceBase: last.totalCollateralETH,
              lastUpdateTimestamp: collateralAssetDataAfterBorrow.lastUpdateTimestamp
            }
          },
          borrow: {
            beforeBorrow: {
              block: blockBeforeBorrow.number,
              blockTimeStamp: blockBeforeBorrow.timestamp,
              rate: borrowAssetData.currentVariableBorrowRate,
              liquidityIndex: borrowAssetData.variableBorrowIndex,
              scaledBalance: BigNumber.from(0),
              reserveNormalized: borrowReserveNormalizedBeforeBorrow,
              userBalanceBase: BigNumber.from(0),
              lastUpdateTimestamp: borrowAssetData.lastUpdateTimestamp
            },
            afterBorrow: {
              block: blockAfterBorrow.number,
              blockTimeStamp: blockAfterBorrow.timestamp,
              rate: borrowAssetDataAfterBorrow.currentVariableBorrowRate,
              liquidityIndex: borrowAssetDataAfterBorrow.variableBorrowIndex,
              scaledBalance: borrowScaledBalanceAfterBorrow,
              reserveNormalized: borrowReserveNormalizedAfterBorrow,
              userBalanceBase: afterBorrow.totalDebtETH,
              lastUpdateTimestamp: borrowAssetDataAfterBorrow.lastUpdateTimestamp,
            },
            next: {
              block: blockNext.number,
              blockTimeStamp: blockNext.timestamp,
              rate: borrowAssetDataAfterBorrow.currentVariableBorrowRate,
              liquidityIndex: borrowAssetDataAfterBorrow.variableBorrowIndex,
              scaledBalance: borrowScaledBalanceNext,
              reserveNormalized: borrowReserveNormalizedNext,
              userBalanceBase: next.totalDebtETH,
              lastUpdateTimestamp: borrowAssetDataAfterBorrow.lastUpdateTimestamp,
            },
            last: {
              block: blockLast.number,
              blockTimeStamp: blockLast.timestamp,
              rate: borrowAssetData.currentVariableBorrowRate,
              liquidityIndex: borrowAssetData.variableBorrowIndex,
              scaledBalance: borrowScaledBalanceLast,
              reserveNormalized: borrowReserveNormalizedLast,
              userBalanceBase: last.totalDebtETH,
              lastUpdateTimestamp: borrowAssetDataAfterBorrow.lastUpdateTimestamp,
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

        const supplyApr = await getAprAAVETwo(
          libFacade
          , amountCollateral
          , liquidityRateRaysPredicted
          , priceCollateral
          , countBlocks
          , keyValues.liquidity.afterBorrow
          , blocksPerDay
        );
        console.log("supplyAprExact", supplyApr);
        const borrowApr = await getAprAAVETwo(
          libFacade
          , amountToBorrow
          , borrowAssetDataAfterBorrow.currentVariableBorrowRate
          , priceBorrow
          , countBlocks
          , keyValues.borrow.afterBorrow
          , blocksPerDay
        );
        console.log("borrowAprExact", borrowApr);

        // calculate approx values of supply/borrow APR
        // we use state-values "before-borrow" and predicted values of supply/borrow rates after borrow
        const supplyAprApprox = await getAprBeforeAAVETwo(
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
        const borrowAprApprox = await getAprBeforeAAVETwo(
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
          last.totalCollateralETH.sub(next.totalCollateralETH).toString(),
          last.totalDebtETH.sub(next.totalDebtETH).toString(),

          last.totalCollateralETH.sub(next.totalCollateralETH).toString(),
          last.totalDebtETH.sub(next.totalDebtETH).toString()
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

