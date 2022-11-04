import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {areAlmostEqual} from "../baseUT/utils/CommonUtils";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {
  DForceInterestRateModelMock__factory,
  IERC20__factory, IERC20Extended__factory
} from "../../typechain";
import {expect} from "chai";
import {DForceHelper} from "../../scripts/integration/helpers/DForceHelper";
import {AprAave3} from "../baseUT/apr/aprAave3";
import {AprAaveTwo} from "../baseUT/apr/aprAaveTwo";
import {AprDForce} from "../baseUT/apr/aprDForce";
import {Misc} from "../../scripts/utils/Misc";
import {AprHundredFinance} from "../baseUT/apr/aprHundredFinance";
import {AprSwap} from "../baseUT/apr/aprSwap";
import {TokenDataTypes} from "../baseUT/types/TokenDataTypes";
import {BalanceUtils} from "../baseUT/utils/BalanceUtils";
import {parseUnits} from "ethers/lib/utils";
import {ITetuLiquidator__factory} from "../../typechain/factories/contracts/interfaces";

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

  describe("DAI-18 => USDC-6", () => {
//region Constants
    const ASSET_COLLATERAL = MaticAddresses.DAI;
    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
    const ASSET_BORROW = MaticAddresses.USDC;
    const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
    const AMOUNT_COLLATERAL = 200_000;
    const INITIAL_LIQUIDITY_COLLATERAL = 200_000;
    const INITIAL_LIQUIDITY_BORROW = 700;
    const HEALTH_FACTOR2 = 200;
    const COUNT_BLOCKS = 1;
    const AMOUNT_TO_BORROW = 50_000;
//endregion Constants

    describe("AAVE3", () => {
      it("predicted APR should be equal to real APR", async () => {
        if (!await isPolygonForkInUse()) return;

        const ret = await AprAave3.makeBorrowTest(
          deployer
          , AMOUNT_TO_BORROW
          , {
            collateral: {
              asset: ASSET_COLLATERAL,
              holder: HOLDER_COLLATERAL,
              initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
            },
            borrow: {
              asset: ASSET_BORROW,
              holder: HOLDER_BORROW,
              initialLiquidity: INITIAL_LIQUIDITY_BORROW,
            },
            collateralAmount: AMOUNT_COLLATERAL,
            healthFactor2: HEALTH_FACTOR2,
            countBlocks: COUNT_BLOCKS
          }
          , [] // no additional points
        );
        console.log("ret", ret);

        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          ret.details.totalCollateralBaseDelta, ret.details.totalDebtBaseDelta,
          ret.details.totalCollateralBaseDelta, ret.details.totalDebtBaseDelta,
          ret.results.resultRates.supplyRate, ret.results.resultRates.borrowRate,
          ret.results.resultAmounts.supplyIncomeInBorrowTokens36,
          ret.results.resultAmounts.costBorrow36,
          ret.results.resultAmounts.apr18
        ].map(x => BalanceUtils.toString(x)).join("\r");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          ret.details.supplyAprBaseExactMul18.div(Misc.WEI), ret.details.borrowAprBaseExactMul18.div(Misc.WEI),
          ret.details.supplyAprBaseApprox, ret.details.borrowAprBaseApprox,
          ret.results.predictedRates.supplyRate, ret.results.predictedRates.borrowRate,
          ret.results.predictedAmounts.supplyIncomeInBorrowTokens36,
          ret.results.predictedAmounts.costBorrow36,
          ret.results.predictedAmounts.apr18
        ].map(x => BalanceUtils.toString(x)).join("\r");

        expect(sret).equals(sexpected);
      });
    });

    describe("AAVE2", () => {
      it("predicted APR should be equal to real APR", async () => {
        if (!await isPolygonForkInUse()) return;

        const ret = await AprAaveTwo.makeBorrowTest(
          deployer
          , AMOUNT_TO_BORROW
          , {
            collateral: {
              asset: ASSET_COLLATERAL,
              holder: HOLDER_COLLATERAL,
              initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
            },
            borrow: {
              asset: ASSET_BORROW,
              holder: HOLDER_BORROW,
              initialLiquidity: INITIAL_LIQUIDITY_BORROW,
            },
            collateralAmount: AMOUNT_COLLATERAL,
            healthFactor2: HEALTH_FACTOR2,
            countBlocks: COUNT_BLOCKS
          }
          , [] // no additional points
        );
        console.log("ret", ret);

        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          ret.details.totalCollateralETH,
          ret.details.totalDebtETH,
          ret.details.totalCollateralETH,
          ret.details.totalDebtETH,

          ret.results.resultRates.supplyRate, ret.results.resultRates.borrowRate,
          ret.results.resultAmounts.supplyIncomeInBorrowTokens36,
          ret.results.resultAmounts.costBorrow36,
          ret.results.resultAmounts.apr18
        ].map(x => BalanceUtils.toString(x)).join("\r");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          ret.details.supplyIncomeBaseExactMul18.div(Misc.WEI),
          ret.details.borrowCostBaseExactMul18.div(Misc.WEI),
          ret.details.supplyIncomeBaseApprox.valueBase,
          ret.details.borrowCostBaseApprox.valueBase,

          ret.results.predictedRates.supplyRate, ret.results.predictedRates.borrowRate,
          ret.results.predictedAmounts.supplyIncomeInBorrowTokens36,
          ret.results.predictedAmounts.costBorrow36,
          ret.results.predictedAmounts.apr18
        ].map(x => BalanceUtils.toString(x)).join("\r");

        expect(sret).equals(sexpected);
      });
    });

    describe("DForce", () => {
      it("predicted APR should be equal to real APR", async () => {
        if (!await isPolygonForkInUse()) return;

        const ret = await AprDForce.makeBorrowTest(
          deployer
          , AMOUNT_TO_BORROW
          , {
            collateral: {
              asset: ASSET_COLLATERAL,
              holder: HOLDER_COLLATERAL,
              initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
            },
            borrow: {
              asset: ASSET_BORROW,
              holder: HOLDER_BORROW,
              initialLiquidity: INITIAL_LIQUIDITY_BORROW,
            },
            collateralAmount: AMOUNT_COLLATERAL,
            healthFactor2: HEALTH_FACTOR2,
            countBlocks: COUNT_BLOCKS
          }
          , [] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          ret.details.deltaCollateralMul18,
          ret.details.deltaBorrowBalance,
          ret.details.deltaCollateralMul18,
          ret.details.deltaBorrowBalance,

          ret.results.resultRates.supplyRate, ret.results.resultRates.borrowRate,
          ret.results.resultAmounts.supplyIncomeInBorrowTokens36,
          ret.results.resultAmounts.costBorrow36,
          ret.results.resultAmounts.apr18
        ].map(x => BalanceUtils.toString(x)).join("\r");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          ret.details.supplyIncomeInBorrowAsset36Exact,
          ret.details.borrowCost36Exact,
          ret.details.supplyIncomeInBorrowAsset36,
          ret.details.borrowCost36,

          ret.results.predictedRates.supplyRate, ret.results.predictedRates.borrowRate,
          ret.results.predictedAmounts.supplyIncomeInBorrowTokens36,
          ret.results.predictedAmounts.costBorrow36,
          ret.results.predictedAmounts.apr18
        ].map(x => BalanceUtils.toString(x)).join("\r");

        expect(sret).equals(sexpected);
      });
    });

    describe("HundredFinance", () => {
      it("predicted APR should be equal to real APR", async () => {
        if (!await isPolygonForkInUse()) return;

        const ret = await AprHundredFinance.makeBorrowTest(
          deployer
          , AMOUNT_TO_BORROW
          , {
            collateral: {
              asset: ASSET_COLLATERAL,
              holder: HOLDER_COLLATERAL,
              initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
            },
            borrow: {
              asset: ASSET_BORROW,
              holder: HOLDER_BORROW,
              initialLiquidity: INITIAL_LIQUIDITY_BORROW,
            },
            collateralAmount: AMOUNT_COLLATERAL,
            healthFactor2: HEALTH_FACTOR2,
            countBlocks: COUNT_BLOCKS
          }
          , [] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          ret.details.deltaCollateralMul18,
          ret.details.deltaBorrowBalance,
          ret.details.deltaCollateralMul18,
          ret.details.deltaBorrowBalance,

          ret.results.resultRates.supplyRate, ret.results.resultRates.borrowRate,
          ret.results.resultAmounts.supplyIncomeInBorrowTokens36,
          ret.results.resultAmounts.costBorrow36,
          ret.results.resultAmounts.apr18
        ].map(x => BalanceUtils.toString(x)).join("\r");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          ret.details.supplyIncomeInBorrowAsset36Exact,
          ret.details.borrowCost36Exact,
          ret.details.supplyIncomeInBorrowAsset36,
          ret.details.borrowCost36,

          ret.results.predictedRates.supplyRate, ret.results.predictedRates.borrowRate,
          ret.results.predictedAmounts.supplyIncomeInBorrowTokens36,
          ret.results.predictedAmounts.costBorrow36,
          ret.results.predictedAmounts.apr18
        ].map(x => BalanceUtils.toString(x)).join("\r");

        expect(sret).equals(sexpected);
      });
    });

    describe("SWAP", () => {
      it("predicted APR should be equal to real APR", async () => {
        if (!await isPolygonForkInUse()) return;

        const collateralAmountNum = 1_000; // AMOUNT_COLLATERAL
        const collateralToken = await TokenDataTypes.Build(deployer, ASSET_COLLATERAL);
        const borrowToken = await TokenDataTypes.Build(deployer, ASSET_BORROW);
        const collateralAmount = getBigNumberFrom(collateralAmountNum, collateralToken.decimals);

        const ret = await AprSwap.makeSwapTest(
          deployer,
          collateralToken,
          [HOLDER_COLLATERAL],
          collateralAmount,
          borrowToken,
        );
        console.log(ret);

        const sret = [
          ret.strategyToConvert.converter
        ].map(x => BalanceUtils.toString(x)).join("\n");

        const sexpected = [
          ret.swapManagerAddress
        ].map(x => BalanceUtils.toString(x)).join("\n");

        expect(sret).equals(sexpected);
      });
    });
  });

  it.skip("Debug. liquidate tokenIn => tokenOut", async () => {
    const assetIn = MaticAddresses.DAI;
    const assetInHolder = MaticAddresses.HOLDER_DAI_5;
    const assetOut = MaticAddresses.WETH;

    const tokenIn = IERC20Extended__factory.connect(assetIn, deployer);
    const tokenOut = IERC20Extended__factory.connect(assetOut, deployer);

    const amountIn = parseUnits('1000', await tokenIn.decimals());

    const liquidator = ITetuLiquidator__factory.connect(MaticAddresses.TETU_LIQUIDATOR, deployer);
    const price = await liquidator.getPrice(assetIn, assetOut, amountIn);
    const priceBack = await liquidator.getPrice(assetOut, assetIn, price);

    await IERC20__factory.connect(assetIn, await Misc.impersonate(assetInHolder)).transfer(deployer.address, amountIn);
    await IERC20__factory.connect(assetIn, deployer).approve(liquidator.address, amountIn);
    await liquidator.liquidate(assetIn, assetOut, amountIn, 10_000);

    const receivedAmountOut = await tokenOut.balanceOf(deployer.address);
    console.log("price", price);
    console.log("priceBack", priceBack);
    console.log("receivedAmountOut", receivedAmountOut);

    await IERC20__factory.connect(assetOut, deployer).approve(liquidator.address, receivedAmountOut);
    const daiBalBefore = await tokenIn.balanceOf(deployer.address);
    await liquidator.liquidate(assetOut, assetIn, receivedAmountOut, 10_000);
    const daiBalAfter = await tokenIn.balanceOf(deployer.address);
    const receivedAmountInBack = daiBalAfter.sub(daiBalBefore);

    console.log("receivedAmountInBack", receivedAmountInBack);
    console.log("receivedAmountOut", receivedAmountOut);
  });
});

