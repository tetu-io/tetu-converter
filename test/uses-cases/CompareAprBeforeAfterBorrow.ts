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
  IERC20__factory
} from "../../typechain";
import {expect} from "chai";
import {DForceHelper} from "../../scripts/integration/helpers/DForceHelper";
import {AprAave3} from "../baseUT/apr/aprAave3";
import {AprAaveTwo} from "../baseUT/apr/aprAaveTwo";
import {AprDForce} from "../baseUT/apr/aprDForce";
import {Misc} from "../../scripts/utils/Misc";
import {AprHundredFinance} from "../baseUT/apr/aprHundredFinance";

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

  describe("DAI-18 => WETH-18", () => {
//region Constants
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
            }, borrow: {
              asset: ASSET_BORROW,
              holder: HOLDER_BORROW,
              initialLiquidity: INITIAL_LIQUIDITY_BORROW,
            }, collateralAmount: AMOUNT_COLLATERAL
            , healthFactor2: HEALTH_FACTOR2
            , countBlocks: COUNT_BLOCKS
          }
          , [] // no additional points
        );
        console.log("ret", ret);

        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          ret.details.totalCollateralBaseDelta.toString(), ret.details.totalDebtBaseDelta.toString(),
          ret.details.totalCollateralBaseDelta.toString(), ret.details.totalDebtBaseDelta.toString(),
          ret.details.predictedSupplyAprBt36.toString(), ret.details.predictedBorrowAprBt36.toString(),
          ret.results.resultsBlock.aprBt36.collateral.toString(), ret.results.resultsBlock.aprBt36.borrow.toString(),
        ].join("\n");

        const rays = getBigNumberFrom(1, 36);
        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          ret.details.supplyAprBaseExactMul18.div(rays).toString(), ret.details.borrowAprBaseExactMul18.div(rays).toString(),
          ret.details.supplyAprBaseApprox.div(rays).toString(), ret.details.borrowAprBaseApprox.div(rays).toString(),
          ret.results.predicted.aprBt36.collateral.toString(), ret.results.predicted.aprBt36.borrow.toString(),
          ret.results.predicted.aprBt36.collateral.toString(), ret.results.predicted.aprBt36.borrow.toString()
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

        const ret = await AprAaveTwo.makeBorrowTest(
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
          , [] // no additional points
        );
        console.log("ret", ret);

        const sret = [
          areAlmostEqual(ret.details.totalCollateralETH!, ret.details.supplyAprBaseExact!, 6),
          areAlmostEqual(ret.details.totalDebtETH!, ret.details.borrowAprBaseExact!, 8),
          ret.details.supplyAprBaseExact.toString(),
          ret.details.keyValues.liquidity.next.liquidityIndex,

          // borrowApr.toString(),
          // keyValues.borrow.afterBorrow.liquidityIndex
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true,
          true,
          ret.details.supplyAprBaseApprox.aprBase18.toString(),
          ret.details.supplyAprBaseApprox.nextLiquidityIndex.toString(),

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
        if (!await isPolygonForkInUse()) return;

        const ret = await AprDForce.makeBorrowTest(
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
          , [] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.details.deltaCollateralBtMul18!, ret.details.supplyApr!, 4)
          , areAlmostEqual(ret.details.deltaBorrowBalance!, ret.details.borrowApr!, 5)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.details.deltaCollateralBtMul18!, ret.details.supplyAprExact!, 9)
          , areAlmostEqual(ret.details.deltaBorrowBalance!, ret.details.borrowAprExact!, 9)
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
        if (!await isPolygonForkInUse()) return;

        const ret = await AprAave3.makeBorrowTest(
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
          , [] // no additional points
        );
        console.log("ret", ret);

        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          ret.details.totalCollateralBaseDelta.toString(), ret.details.totalDebtBaseDelta.toString(),
          ret.details.totalCollateralBaseDelta.toString(), ret.details.totalDebtBaseDelta.toString(),
          ret.details.predictedSupplyAprBt36.toString(), ret.details.predictedBorrowAprBt36.toString(),
          ret.results.resultsBlock.aprBt36.collateral.toString(), ret.results.resultsBlock.aprBt36.borrow.toString(),
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          ret.details.supplyAprBaseExactMul18.toString(), ret.details.borrowAprBaseExactMul18.toString(),
          ret.details.supplyAprBaseApprox.toString(), ret.details.borrowAprBaseApprox.toString(),
          ret.results.predicted.aprBt36.collateral.toString(), ret.results.predicted.aprBt36.borrow.toString(),
          ret.results.predicted.aprBt36.collateral.toString(), ret.results.predicted.aprBt36.borrow.toString(),
        ].join("\n");

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
            }, borrow: {
              asset: ASSET_BORROW,
              holder: HOLDER_BORROW,
              initialLiquidity: INITIAL_LIQUIDITY_BORROW,
            }, collateralAmount: AMOUNT_COLLATERAL
            , healthFactor2: HEALTH_FACTOR2
            , countBlocks: COUNT_BLOCKS
          }
          , [] // no additional points
        );
        console.log("ret", ret);

        const sret = [
          areAlmostEqual(ret.details.totalCollateralETH!, ret.details.supplyAprBaseExact!, 3),
          areAlmostEqual(ret.details.totalDebtETH!, ret.details.borrowAprBaseExact!, 8),
          ret.details.supplyAprBaseExact.toString(),
          ret.details.keyValues.liquidity.next.liquidityIndex,

          // borrowApr.toString(),
          // keyValues.borrow.afterBorrow.liquidityIndex
        ].join("\n");

        // these differences must be equal to exact supply/borrow APR
        const sexpected = [
          true,
          true,
          ret.details.supplyAprBaseApprox.aprBase18.toString(),
          ret.details.supplyAprBaseApprox.nextLiquidityIndex.toString(),

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
        if (!await isPolygonForkInUse()) return;

        const ret = await AprDForce.makeBorrowTest(
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
          , [] // no additional points
        );
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.details.deltaCollateralBtMul18!, ret.details.supplyApr!, 4)
          , areAlmostEqual(ret.details.deltaBorrowBalance!, ret.details.borrowApr!, 5)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.details.deltaCollateralBtMul18!, ret.details.supplyAprExact!, 9)
          , areAlmostEqual(ret.details.deltaBorrowBalance!, ret.details.borrowAprExact!, 9)
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
        if (!await isPolygonForkInUse()) return;

        const ret = await AprDForce.makeBorrowTest(
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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);

        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyApr!, 2)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowApr!, 2)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyAprExact!, 2)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowAprExact!, 2)
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
        console.log("predicted.aprBt36", ret.results.predicted.aprBt36);
        console.log("results.aprBt36", ret.results.resultsBlock.aprBt36);

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
            }, borrow: {
              asset: ASSET_BORROW,
              holder: HOLDER_BORROW,
              initialLiquidity: INITIAL_LIQUIDITY_BORROW,
            }, collateralAmount: AMOUNT_COLLATERAL
            , healthFactor2: HEALTH_FACTOR2
            , countBlocks: COUNT_BLOCKS
          }
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyApr!, 2)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowApr!, 2)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyAprExact!, 2)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowAprExact!, 2)
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
        console.log("predicted.aprBt36", ret.results.predicted.aprBt36);
        console.log("results.aprBt36", ret.results.resultsBlock.aprBt36);

        expect(sret).equals(sexpected);
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
        if (!await isPolygonForkInUse()) return;

        const ret = await AprDForce.makeBorrowTest(
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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyApr!, 4)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowApr!, 5)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyAprExact!, 9)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowAprExact!, 9)
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
        if (!await isPolygonForkInUse()) return;

        const ret = await AprHundredFinance.makeBorrowTest(
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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyApr!, 4)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowApr!, 5)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyAprExact!, 9)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowAprExact!, 9)
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
        if (!await isPolygonForkInUse()) return;

        const ret = await AprDForce.makeBorrowTest(
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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyApr!, 4)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowApr!, 5)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyAprExact!, 9)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowAprExact!, 9)
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
        if (!await isPolygonForkInUse()) return;

        const ret = await AprHundredFinance.makeBorrowTest(
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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyApr!, 4)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowApr!, 5)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyAprExact!, 9)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowAprExact!, 9)
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
        if (!await isPolygonForkInUse()) return;

        const ret = await AprDForce.makeBorrowTest(
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
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);

        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyApr!, 2)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowApr!, 2)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyAprExact!, 2)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowAprExact!, 2)
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
        console.log("predicted.aprBt36", ret.results.predicted.aprBt36);
        console.log("results.aprBt36", ret.results.resultsBlock.aprBt36);

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
            }, borrow: {
              asset: ASSET_BORROW,
              holder: HOLDER_BORROW,
              initialLiquidity: INITIAL_LIQUIDITY_BORROW,
            }, collateralAmount: AMOUNT_COLLATERAL
            , healthFactor2: HEALTH_FACTOR2
            , countBlocks: COUNT_BLOCKS
          }
          , [2000] // no additional points
        );

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;
        console.log("ret", ret);


        // calculate real differences in user-account-balances for period [next block, last block]
        const sret = [
          areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyApr!, 2)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowApr!, 2)

          // not exact because real supply and borrow rate are rounded
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.collateral, ret.details.supplyAprExact!, 2)
          , areAlmostEqual(ret.results.resultsBlock.aprBt36.borrow, ret.details.borrowAprExact!, 2)
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
        console.log("predicted.aprBt36", ret.results.predicted.aprBt36);
        console.log("results.aprBt36", ret.results.resultsBlock.aprBt36);

        expect(sret).equals(sexpected);
      });
    });
  });
});

