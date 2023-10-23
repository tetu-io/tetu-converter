import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {
  DForceInterestRateModelMock__factory,
  IERC20__factory
} from "../../../typechain";
import {expect} from "chai";
import {DForceHelper} from "../../../scripts/integration/dforce/DForceHelper";
import {AprAave3} from "../../baseUT/protocols/aave3/aprAave3";
import {AprAaveTwo} from "../../baseUT/protocols/aaveTwo/aprAaveTwo";
import {AprDForce} from "../../baseUT/protocols/dforce/aprDForce";
import {Misc} from "../../../scripts/utils/Misc";
import {AprHundredFinance} from "../../baseUT/protocols/hundred-finance/aprHundredFinance";
import {AprSwap} from "../../baseUT/protocols/shared/aprSwap";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {parseUnits} from "ethers/lib/utils";
import {BorrowRepayUsesCase} from "../../baseUT/uses-cases/app/BorrowRepayUsesCase";
import {DForceChangePriceUtils} from "../../baseUT/protocols/dforce/DForceChangePriceUtils";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {TetuConverterApp} from "../../baseUT/app/TetuConverterApp";
import {HundredFinancePlatformFabric} from "../../baseUT/logic/fabrics/HundredFinancePlatformFabric";
import {DForcePlatformFabric} from "../../baseUT/logic/fabrics/DForcePlatformFabric";
import {MaticCore} from "../../baseUT/chains/polygon/maticCore";

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
describe.skip("CompareAprBeforeAfterBorrow @skip-on-coverage", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
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
    const AMOUNT_COLLATERAL = 5_000;
    const INITIAL_LIQUIDITY_COLLATERAL = 10_000;
    const INITIAL_LIQUIDITY_BORROW = 700;
    const HEALTH_FACTOR2 = 200;
    const COUNT_BLOCKS = 1;
    const AMOUNT_TO_BORROW = 250;
//endregion Constants

    describe("AAVE3", () => {
      it("predicted APR should be equal to real APR", async () => {
        const core = MaticCore.getCoreAave3();
        const ret = await AprAave3.makeBorrowTest(
          deployer,
          core,
          AMOUNT_TO_BORROW,
          {
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
          },
          [] // no additional points
        );
        console.log("ret", ret);

        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          ret.details.totalCollateralBaseDelta.toString(), ret.details.totalDebtBaseDelta.toString(),
          ret.details.totalCollateralBaseDelta.toString(), ret.details.totalDebtBaseDelta.toString(),
          ret.details.predictedSupplyIncomeRays.toString(), ret.details.predictedBorrowIncomeRays.toString(),
          ret.results.resultAmounts.supplyIncomeInBorrowTokens36.toString(),
          ret.results.resultAmounts.costBorrow36.toString(),
          ret.results.resultAmounts.apr18.toString()
        ].join("\n");

        const rays = getBigNumberFrom(1, 36);
        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          ret.details.supplyAprBaseExactMul18.div(rays).toString(), ret.details.borrowAprBaseExactMul18.div(rays).toString(),
          ret.details.supplyAprBaseApprox.div(rays).toString(), ret.details.borrowAprBaseApprox.div(rays).toString(),
          ret.results.predictedRates.supplyRate.toString(), ret.results.predictedRates.borrowRate.toString(),
          ret.results.predictedAmounts.supplyIncomeInBorrowTokens36.toString(),
          ret.results.predictedAmounts.costBorrow36.toString(),
          ret.results.predictedAmounts.apr18.toString()
        ].join("\n");

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
        const wei = Misc.WEI;

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

        const sret = [
          areAlmostEqual(ret.details.totalCollateralETH, ret.details.supplyIncomeBaseExactMul18, 6),
          areAlmostEqual(ret.details.totalDebtETH, ret.details.borrowCostBaseExactMul18, 8),
          ret.details.supplyIncomeBaseExactMul18.toString(),
          ret.details.keyValues.liquidity.next.liquidityIndex,

          // borrowApr.toString(),
          // keyValues.borrow.afterBorrow.liquidityIndex
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true,
          true,
          ret.details.supplyIncomeBaseApprox.valueBase.toString(),
          ret.details.supplyIncomeBaseApprox.nextLiquidityIndex.toString(),

          /////////////////////////////////////////////////////////////////////
          // TODO: nextLiquidityIndex for borrow is a bit different from expected
          // The difference appears because we need to take into account compound effect
          // see aave-v2, MathUtils.sol, calculateCompoundedInterest
          ////////////////////////////////////////////////////////////////////
          // borrowAprApprox.apr.toString(),
          // borrowAprApprox.nextLiquidityIndex.toString()
          ////////////////////////////////////////////////////////////////////
        ].join("\n");

        expect(sret).equals(sexpected);
      });
    });

    describe("DForce", () => {
      it("predicted APR should be equal to real APR", async () => {
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
          areAlmostEqual(ret.details.deltaCollateralBtMul18, ret.details.supplyIncomeInBorrowAsset36, 4)
          , areAlmostEqual(ret.details.deltaBorrowBalance, ret.details.borrowCost36, 5)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.details.deltaCollateralBtMul18, ret.details.supplyIncomeInBorrowAsset36Exact, 9)
          , areAlmostEqual(ret.details.deltaBorrowBalance, ret.details.borrowCost36Exact, 9)
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true
          , true
          , true
          , true
        ].join("\n");

        expect(sret).equals(sexpected);
      });

      describe.skip("Temp calcs for DForce", () => {
        it("apr", () => {
          const borrowBalanceMiddle = BigNumber.from("58035600000000000000000000000000000000000");
          const borrowBalanceLast = BigNumber.from("58035600197395749574642710000000000000000");
          const collateralBalanceNext = BigNumber.from("169985288199999999999999838023644809698004");
          const collateralBalanceMiddle = BigNumber.from("169985288469050133207406287966044900859892");
          const collateralFactorMantissa = BigNumber.from("850000000000000000");
          const borrowFactorMantissa = BigNumber.from("1000000000000000000")
          // const borrowTotalBorrowsMiddle = BigNumber.from("52239880587431260022");
          // const borrowTotalBorrowsLast = BigNumber.from("52239880765114102730");

          const priceCollateral = BigNumber.from("999913460000000000");
          const priceBorrow = BigNumber.from("1450890000000000000000");

          const base = getBigNumberFrom(1, 18);
          // const double = getBigNumberFrom(1, 36);
          //
          // const collateralExchangeRateNext = BigNumber.from("1006072989394821668");
          // const collateralExchangeRateMiddle = BigNumber.from("1006072990987218720");

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
          const im = DForceInterestRateModelMock__factory.connect("0x6Bf21BF8cB213997ac0F3A3b1feD431E2BD0C45a", deployer);

          const totalSupply = BigNumber.from("950110374878895912732010");
          const amountToSupply = BigNumber.from("198862327947469607502699");
          const amountToSupplyExact = BigNumber.from("200000000000000000000000");
          const cash = BigNumber.from("207457975647111909044867");

          const totalBorrow = BigNumber.from("748722543290648981048813");
          const borrowInterest = BigNumber.from("17485895962232384280");
          const reserveInterest = BigNumber.from("1748589596223238428");
          const totalReserves = BigNumber.from("650392243307287326761");
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

          const base = Misc.WEI;
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

    describe("SWAP", () => {
      it("predicted APR should be equal to real APR", async () => {
        const collateralAsset = MaticAddresses.DAI;
        const collateralHolders = [ MaticAddresses.HOLDER_DAI ];
        const borrowAsset = MaticAddresses.WETH;
        const collateralAmountNum = 100_000;

        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
        const collateralAmount = getBigNumberFrom(collateralAmountNum, collateralToken.decimals);

        const ret = await AprSwap.makeSwapTest(
          deployer,
          collateralToken,
          collateralHolders,
          collateralAmount,
          borrowToken,
        );

        const sret = [
          ret.swapResults?.borrowedAmount || BigNumber.from(0),
          ret.strategyToConvert.converter
        ].map(x => BalanceUtils.toString(x)).join("\n");

        const sexpected = [
          ret.strategyToConvert.maxTargetAmount,
          ret.swapManagerAddress
        ].map(x => BalanceUtils.toString(x)).join("\n");

        expect(sret).equals(sexpected);
      });
    });

  });

  describe("USDC-6 => WBTC-8", () => {
//region Constants
    const ASSET_COLLATERAL = MaticAddresses.USDC;
    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_USDC;
    const ASSET_BORROW = MaticAddresses.WBTC;
    const HOLDER_BORROW = MaticAddresses.HOLDER_WBTC;
    const AMOUNT_COLLATERAL = 4_000_000;
    const INITIAL_LIQUIDITY_COLLATERAL = 5_000_000;
    const INITIAL_LIQUIDITY_BORROW = 1;
    const HEALTH_FACTOR2 = 200;
    const COUNT_BLOCKS = 1;
    const AMOUNT_TO_BORROW = 10;
//endregion Constants

    describe("AAVE3", () => {
      it("predicted APR should be equal to real APR", async () => {
        const core = MaticCore.getCoreAave3();
        const ret = await AprAave3.makeBorrowTest(
          deployer,
          core,
          AMOUNT_TO_BORROW,
          {
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
          },
          [] // no additional points
        );
        console.log("ret", ret);

        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          ret.details.totalCollateralBaseDelta.toString(), ret.details.totalDebtBaseDelta.toString(),
          ret.details.totalCollateralBaseDelta.toString(), ret.details.totalDebtBaseDelta.toString(),
          ret.results.resultRates.supplyRate.toString(), ret.results.resultRates.borrowRate.toString(),
          ret.results.resultAmounts.supplyIncomeInBorrowTokens36.toString(),
          ret.results.resultAmounts.costBorrow36.toString(),
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          ret.details.supplyAprBaseExactMul18.toString(), ret.details.borrowAprBaseExactMul18.toString(),
          ret.details.supplyAprBaseApprox.toString(), ret.details.borrowAprBaseApprox.toString(),
          ret.results.predictedRates.supplyRate.toString(), ret.results.predictedRates.borrowRate.toString(),
          ret.results.predictedAmounts.supplyIncomeInBorrowTokens36.toString(),
          ret.results.predictedAmounts.costBorrow36.toString(),
        ].join("\n");

        expect(sret).equals(sexpected);
      });
    });

    describe("AAVE2", () => {
      it("predicted APR should be equal to real APR", async () => {
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

        const sret = [
          areAlmostEqual(ret.details.totalCollateralETH, ret.details.supplyIncomeBaseExactMul18, 3),
          areAlmostEqual(ret.details.totalDebtETH, ret.details.borrowCostBaseExactMul18, 8),
          ret.details.supplyIncomeBaseExactMul18.toString(),
          ret.details.keyValues.liquidity.next.liquidityIndex,

          // borrowApr.toString(),
          // keyValues.borrow.afterBorrow.liquidityIndex
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true,
          true,
          ret.details.supplyIncomeBaseApprox.valueBase.toString(),
          ret.details.supplyIncomeBaseApprox.nextLiquidityIndex.toString(),

          /////////////////////////////////////////////////////////////////////
          // TODO: nextLiquidityIndex for borrow is a bit different from expected
          // The difference appears because we need to take into account compound effect
          // see aave-v2, MathUtils.sol, calculateCompoundedInterest
          ////////////////////////////////////////////////////////////////////
          // borrowAprApprox.apr.toString(),
          // borrowAprApprox.nextLiquidityIndex.toString()
          ////////////////////////////////////////////////////////////////////
        ].join("\n");

        expect(sret).equals(sexpected);
      });
    });

    describe.skip("DForce: currently Dforce has only few WBTC...", () => {
      it("predicted APR should be equal to real APR", async () => {
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
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.details.deltaCollateralBtMul18, ret.details.supplyIncomeInBorrowAsset36, 4)
          , areAlmostEqual(ret.details.deltaBorrowBalance, ret.details.borrowCost36, 5)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.details.deltaCollateralBtMul18, ret.details.supplyIncomeInBorrowAsset36Exact, 9)
          , areAlmostEqual(ret.details.deltaBorrowBalance, ret.details.borrowCost36Exact, 9)
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true
          , true
          , true
          , true
        ].join("\n");

        expect(sret).equals(sexpected);


      });
    });
  });

  describe("USDC-6 => USDT-6", () => {
//region Constants
    const ASSET_COLLATERAL = MaticAddresses.USDC;
    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_USDC;
    const ASSET_BORROW = MaticAddresses.USDT;
    const HOLDER_BORROW = MaticAddresses.HOLDER_USDT;
    const AMOUNT_COLLATERAL = 80_000;
    const INITIAL_LIQUIDITY_COLLATERAL = 1_000_000;
    const INITIAL_LIQUIDITY_BORROW = 100;
    const HEALTH_FACTOR2 = 200;
    const COUNT_BLOCKS = 1;
    const AMOUNT_TO_BORROW = 20_000;
//endregion Constants
    describe("DForce", () => {
      it("predicted APR should be equal to real APR", async () => {
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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);

        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36, 2)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36, 2)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36Exact, 2)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36Exact, 2)
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true
          , true
          , true
          , true
        ].join("\n");

        expect(sret).equals(sexpected);
      });
    });
    describe("HundredFinance", () => {
      it("predicted APR should be equal to real APR", async () => {
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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36, 2)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36, 2)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36Exact, 2)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36Exact, 2)
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true
          , true
          , true
          , true
        ].join("\n");

        console.log("next.balance", ret.details.next.collateral.account.balance);
        console.log("next.exchangeRateStored", ret.details.next.collateral.market.exchangeRateStored);
        console.log("last.balance", ret.details.last.collateral.account.balance);
        console.log("last.exchangeRateStored", ret.details.last.collateral.market.exchangeRateStored);

        expect(sret).equals(sexpected);
      });
    });
    describe("SWAP", () => {
      describe("1 USDC", () => {
        it("predicted APR should be equal to real APR", async () => {
          const collateralAmountNum = 1;

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

          const sret = [
            ret.swapResults?.borrowedAmount || BigNumber.from(0),
            ret.strategyToConvert.converter
          ].map(x => BalanceUtils.toString(x)).join("\n");

          const sexpected = [
            ret.strategyToConvert.maxTargetAmount,
            ret.swapManagerAddress
          ].map(x => BalanceUtils.toString(x)).join("\n");

          expect(sret).equals(sexpected);
        });
      });
      describe("1_000_000 USDC", () => {
        it("predicted APR should be equal to real APR", async () => {
          const collateralAmountNum = 1_000_000;

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

          const sret = [
            ret.swapResults?.borrowedAmount || BigNumber.from(0),
            ret.strategyToConvert.converter
          ].map(x => BalanceUtils.toString(x)).join("\n");

          const sexpected = [
            ret.strategyToConvert.maxTargetAmount,
            ret.swapManagerAddress
          ].map(x => BalanceUtils.toString(x)).join("\n");

          expect(sret).equals(sexpected);
        });
      });
    });
  });

  describe("WMATIC-18 => USDC-6", () => {
//region Constants
    const ASSET_COLLATERAL = MaticAddresses.WMATIC;
    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_WMATIC;
    const ASSET_BORROW = MaticAddresses.USDC;
    const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
    const AMOUNT_COLLATERAL = 10_000;
    const INITIAL_LIQUIDITY_COLLATERAL = 25_000;
    const INITIAL_LIQUIDITY_BORROW = 1;
    const HEALTH_FACTOR2 = 200;
    const COUNT_BLOCKS = 1;
    const AMOUNT_TO_BORROW = 1000;
//endregion Constants
    describe("DForce", () => {
      it("predicted APR should be equal to real APR", async () => {

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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36, 4)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36, 5)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36Exact, 9)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36Exact, 9)
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true
          , true
          , true
          , true
        ].join("\n");

        expect(sret).equals(sexpected);
      });
    });
    describe("HundredFinance", () => {
      it("predicted APR should be equal to real APR", async () => {
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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36, 4)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36, 5)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36Exact, 9)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36Exact, 9)
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true
          , true
          , true
          , true
        ].join("\n");

        expect(sret).equals(sexpected);
      });
    });
  });

  describe("USDT-6 => DAI-18", () => {
//region Constants
    const ASSET_COLLATERAL = MaticAddresses.USDT;
    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_USDT;
    const ASSET_BORROW = MaticAddresses.DAI;
    const HOLDER_BORROW = MaticAddresses.HOLDER_DAI;
    const AMOUNT_COLLATERAL = 1000;
    const INITIAL_LIQUIDITY_COLLATERAL = 25_000;
    const INITIAL_LIQUIDITY_BORROW = 1;
    const HEALTH_FACTOR2 = 200;
    const COUNT_BLOCKS = 1;
    const AMOUNT_TO_BORROW = 200;
//endregion Constants
    describe("DForce", () => {
      it("predicted APR should be equal to real APR", async () => {

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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36, 4)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36, 5)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36Exact, 9)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36Exact, 9)
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true
          , true
          , true
          , true
        ].join("\n");

        expect(sret).equals(sexpected);
      });
    });
    describe("HundredFinance", () => {
      it("predicted APR should be equal to real APR", async () => {
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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36, 4)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36, 5)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36Exact, 9)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36Exact, 9)
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true
          , true
          , true
          , true
        ].join("\n");

        expect(sret).equals(sexpected);
      });
    });
  });

  describe("WMATIC-18 => WBTC-8", () => {
//region Constants
    const ASSET_COLLATERAL = MaticAddresses.WMATIC;
    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_WMATIC;
    const ASSET_BORROW = MaticAddresses.WBTC;
    const HOLDER_BORROW = MaticAddresses.HOLDER_WBTC;
    const AMOUNT_COLLATERAL = 10_000;
    const INITIAL_LIQUIDITY_COLLATERAL = 1_000_000;
    const INITIAL_LIQUIDITY_BORROW = 100;
    const HEALTH_FACTOR2 = 200;
    const COUNT_BLOCKS = 1;
    const AMOUNT_TO_BORROW = BigNumber.from("6800000");
//endregion Constants
    describe("DForce", () => {
      it("predicted APR should be equal to real APR", async () => {
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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);

        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36, 2)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36, 2)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36Exact, 2)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36Exact, 2)
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true
          , true
          , true
          , true
        ].join("\n");

        console.log("next.balance", ret.details.next.collateral.account.balance);
        console.log("next.exchangeRateStored", ret.details.next.collateral.market.exchangeRateStored);
        console.log("last.balance", ret.details.last.collateral.account.balance);
        console.log("last.exchangeRateStored", ret.details.last.collateral.market.exchangeRateStored);

        expect(sret).equals(sexpected);
      });
    });
    describe("HundredFinance", () => {
      it("predicted APR should be equal to real APR", async () => {
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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36, 2)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36, 2)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultAmounts.supplyIncomeInBorrowTokens36, ret.details.supplyIncomeInBorrowAsset36Exact, 2)
          , areAlmostEqual(ret.results.resultAmounts.costBorrow36, ret.details.borrowCost36Exact, 2)
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true
          , true
          , true
          , true
        ].join("\n");

        console.log("next.balance", ret.details.next.collateral.account.balance);
        console.log("next.exchangeRateStored", ret.details.next.collateral.market.exchangeRateStored);
        console.log("last.balance", ret.details.last.collateral.account.balance);
        console.log("last.exchangeRateStored", ret.details.last.collateral.market.exchangeRateStored);

        expect(sret).equals(sexpected);
      });
    });
  });

  describe("DAI-18 => USDT-6", () => {
//region Constants
    const ASSET_COLLATERAL = MaticAddresses.DAI;
    const HOLDER_COLLATERAL = [
      MaticAddresses.HOLDER_DAI,
      MaticAddresses.HOLDER_DAI_2,
      MaticAddresses.HOLDER_DAI_3,
      MaticAddresses.HOLDER_DAI_4,
      MaticAddresses.HOLDER_DAI_5,
      MaticAddresses.HOLDER_DAI_6
    ];
    const ASSET_BORROW = MaticAddresses.USDT;
//endregion Constants

    describe("SWAP", () => {
      async function makeSwapTest(collateralAmountNum: number) : Promise<{ret: string, expected: string}> {
        const collateralAsset = ASSET_COLLATERAL;
        const collateralHolders = HOLDER_COLLATERAL;
        const borrowAsset = ASSET_BORROW;

        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
        const collateralAmount = getBigNumberFrom(collateralAmountNum, collateralToken.decimals);

        const r = await AprSwap.makeSwapTest(
          deployer,
          collateralToken,
          collateralHolders,
          collateralAmount,
          borrowToken,
        );

        const ret = [
          r.swapResults?.borrowedAmount || BigNumber.from(0),
          r.strategyToConvert.converter
        ].map(x => BalanceUtils.toString(x)).join("\n");

        const expected = [
          r.strategyToConvert.maxTargetAmount,
          r.swapManagerAddress
        ].map(x => BalanceUtils.toString(x)).join("\n");

        return {ret, expected};
      }
      describe("500", () => {
        it("predicted APR should be equal to real APR", async () => {
          const r = await makeSwapTest(500);
          expect(r.ret).equals(r.expected);
        });
      });
      describe("1_000", () => {
        it("predicted APR should be equal to real APR", async () => {
          const r = await makeSwapTest(1_000);
          expect(r.ret).equals(r.expected);
        });
      });
      describe("25000", () => {
        it("predicted APR should be equal to real APR", async () => {
          const r = await makeSwapTest(35_000);
          expect(r.ret).equals(r.expected);
        });
      });
      describe("100_000", () => {
        it("predicted APR should be equal to real APR", async () => {
          const r = await makeSwapTest(100_000);
          expect(r.ret).equals(r.expected);
        });
      });
      describe("5_000_000", () => {
        it("predicted APR should be equal to real APR", async () => {
          const r = await makeSwapTest(5_000_000);
          expect(r.ret).equals(r.expected);
        });
      });
    });
  });

  describe("Direct tests", () => {
    it("Swap USDT => DAI", async () => {
      const r = await AprSwap.makeSwapTest(
        deployer,
        await TokenDataTypes.Build(deployer, MaticAddresses.USDT),
        [MaticAddresses.HOLDER_USDT],
        parseUnits("100", 6),
        await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
      );
      console.log(r);
    });

    it("Swap USDT => WBTC", async () => {
      const r = await AprSwap.makeSwapTest(
        deployer,
        await TokenDataTypes.Build(deployer, MaticAddresses.USDT),
        [MaticAddresses.HOLDER_USDT],
        parseUnits("100", 6),
        await TokenDataTypes.Build(deployer, MaticAddresses.WBTC),
      );
      console.log(r);
    });

    describe("HundredFinance DAI => USDT", () => {
      it("predicted APR should be equal to real APR", async () => {
        const {controller} = await TetuConverterApp.buildApp(deployer,
          {networkId: POLYGON_NETWORK_ID,}, // disable swap
          [new HundredFinancePlatformFabric()],
        );
        const r = await BorrowRepayUsesCase.makeSingleBorrowSingleFullRepayBase(
          deployer,
          {
            borrow: {asset: MaticAddresses.USDT, holder: MaticAddresses.HOLDER_USDT, initialLiquidity: parseUnits("100000", 6)},
            collateral: {asset: MaticAddresses.DAI, holder: MaticAddresses.HOLDER_DAI, initialLiquidity: parseUnits("100000")},
            healthFactor2: 400,
            collateralAmount: parseUnits("1000"),
            countBlocks: 20000
          },
          controller,
          20000
        );
        console.log(r);
      });
    });

    describe("DForce DAI => USDT", () => {
      it("predicted APR should be equal to real APR", async () => {
        const {controller} = await TetuConverterApp.buildApp(deployer,
            {networkId: POLYGON_NETWORK_ID,}, // disable swap
          [new DForcePlatformFabric()],
        );
        await DForceChangePriceUtils.setupPriceOracleMock(deployer, true);
        const r = await BorrowRepayUsesCase.makeSingleBorrowSingleFullRepayBase(
          deployer,
          {
            collateral: {asset: MaticAddresses.DAI, holder: MaticAddresses.HOLDER_DAI, initialLiquidity: parseUnits("100000")},
            borrow: {asset: MaticAddresses.USDT, holder: MaticAddresses.HOLDER_USDT, initialLiquidity: parseUnits("100000", 6)},
            healthFactor2: 400,
            collateralAmount: parseUnits("1000"),
            countBlocks: 20000
          },
          controller,
          20000
        );
        console.log(r);
      });
    });

    describe("Swap DAI => USDT", () => {
      it("predicted APR should be equal to real APR", async () => {
        const {controller} = await TetuConverterApp.buildApp(deployer,
          {networkId: POLYGON_NETWORK_ID, tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}, // disable swap
          [],
        );
        await DForceChangePriceUtils.setupPriceOracleMock(deployer, true);
        const r = await BorrowRepayUsesCase.makeSingleBorrowSingleFullRepayBase(
          deployer,
          {
            collateral: {asset: MaticAddresses.DAI, holder: MaticAddresses.HOLDER_DAI, initialLiquidity: parseUnits("100000")},
            borrow: {asset: MaticAddresses.USDT, holder: MaticAddresses.HOLDER_USDT, initialLiquidity: parseUnits("1000", 6)},
            healthFactor2: 400,
            collateralAmount: parseUnits("1000"),
            countBlocks: 20000
          },
          controller,
          20000
        );
        console.log(r);
      });
    });
  });

});

