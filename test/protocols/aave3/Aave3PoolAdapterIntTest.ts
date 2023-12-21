import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {IAave3ReserveInfo} from "../../../scripts/integration/aave3/Aave3Helper";
import {BalanceUtils, IUserBalances} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {Misc} from "../../../scripts/utils/Misc";
import {IAave3UserAccountDataResults} from "../../baseUT/protocols/aave3/aprAave3";
import {
  AaveMakeBorrowAndRepayUtils, IBorrowAndRepayBadParams,
  IMakeBorrowAndRepayResults
} from "../../baseUT/protocols/aaveShared/aaveBorrowAndRepayUtils";
import {AaveBorrowUtils, IMakeBorrowTestResults} from "../../baseUT/protocols/aaveShared/aaveBorrowUtils";
import {transferAndApprove} from "../../baseUT/utils/transferUtils";
import {
  Aave3TestUtils,
  IPrepareToBorrowResults,
} from "../../baseUT/protocols/aave3/Aave3TestUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {GAS_LIMIT} from "../../baseUT/types/GasLimit";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {MaticCore} from "../../baseUT/chains/polygon/MaticCore";
import {TetuConverterApp} from "../../baseUT/app/TetuConverterApp";
import {ConverterController, IERC20Metadata__factory, IPoolAdapter__factory} from "../../../typechain";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";

describe("Aave3PoolAdapterIntTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let deployer: SignerWithAddress;
  let converterInstance: ConverterController;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    converterInstance = await TetuConverterApp.createController(deployer, {networkId: POLYGON_NETWORK_ID,});
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Unit tests
  describe("borrow", () => {
    async function makeBorrowTest(
      converter: ConverterController,
      collateralToken: TokenDataTypes,
      collateralAmountRequired: BigNumber,
      borrowToken: TokenDataTypes,
      borrowAmountRequired: BigNumber | undefined
    ): Promise<IMakeBorrowTestResults> {
      const d = await Aave3TestUtils.prepareToBorrow(
        deployer,
        MaticCore.getCoreAave3(),
        converter,
        collateralToken.address,
        collateralAmountRequired,
        borrowToken.address,
        false
      );
      const ret = await Aave3TestUtils.makeBorrow(
          deployer,
          d,
          {
            borrowAmountRequired: borrowAmountRequired === undefined
              ? undefined
              : formatUnits(borrowAmountRequired, await IERC20Metadata__factory.connect(borrowToken.address, deployer).decimals())
          }
      );
      return {
        borrowedAmount: ret.borrowedAmount,
        priceBorrow: d.priceBorrow,
        borrowAssetDecimals: borrowToken.decimals,

        collateralAmount: d.collateralAmount,
        priceCollateral: d.priceCollateral,
        collateraAssetDecimals: collateralToken.decimals,

        userBalanceBorrowedAsset: await borrowToken.token.balanceOf(d.userContract.address),
        poolAdapterBalanceCollateralAsset: await IERC20Metadata__factory.connect(
            ret.collateralData.data.aTokenAddress,
            deployer
          ).balanceOf(d.aavePoolAdapterAsTC.address),
        totalCollateralBase: ret.accountDataAfterBorrow.totalCollateralBase,
        totalDebtBase: ret.accountDataAfterBorrow.totalDebtBase,
      }
    }

    /** Replaced by BorrowRepayCaseTest */
    describe.skip("Good paths", () => {
      describe("Borrow fixed small amount", () => {
        describe("DAI-18 : matic-18", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });
          async function testMakeBorrowDaiWMatic() : Promise<IMakeBorrowTestResults> {
            return AaveBorrowUtils.daiWMatic(deployer, converterInstance, makeBorrowTest, 100_000, 10);
          }
          it("should send borrowed amount to user", async () => {
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            // Not exact equal. npm run test can produce small differences in results sometime, i.e.
            // 56879332146581 vs 56879332146481 (WBTC-8 : Tether-6, big amounts)
            // 886499999 vs 886500000 (DAI-18 : matic-18, small amounts)
            expect(areAlmostEqual(
              r.totalDebtBase,
              r.borrowedAmount.mul(r.priceBorrow).div(parseUnits("1", r.borrowAssetDecimals))
            )).eq(true);
          });
          it("should set expected totalCollateralBase", async () => {
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            expect(areAlmostEqual(
              r.totalCollateralBase,
              r.collateralAmount.mul(r.priceCollateral).div(parseUnits("1", r.collateraAssetDecimals))
            ));
          });
        });
        /**
         * Currently vars.rcDebtCeiling < vars.rc.isolationModeTotalDebt,
         * so new borrows are not possible
         */
        describe.skip("STASIS EURS-2 : Tether-6", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });
          async function testMakeBorrowEursTether() : Promise<IMakeBorrowTestResults> {
            return AaveBorrowUtils.eursTether(deployer, converterInstance, makeBorrowTest, 100_000, 10);
          }
          it("should send borrowed amount to user", async () => {
            const r = await loadFixture(testMakeBorrowEursTether);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            const r = await loadFixture(testMakeBorrowEursTether);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            const r = await loadFixture(testMakeBorrowEursTether);
            // Not exact equal. npm run test can produce small differences in results sometime, i.e.
            // 56879332146581 vs 56879332146481 (WBTC-8 : Tether-6, big amounts)
            // 886499999 vs 886500000 (DAI-18 : matic-18, small amounts)
            expect(areAlmostEqual(
              r.totalDebtBase,
              r.borrowedAmount.mul(r.priceBorrow).div(parseUnits("1", r.borrowAssetDecimals))
            )).eq(true);
          });
          it("should set expected totalCollateralBase", async () => {
            const r = await loadFixture(testMakeBorrowEursTether);
            expect(areAlmostEqual(
              r.totalCollateralBase,
              r.collateralAmount.mul(r.priceCollateral).div(parseUnits("1", r.collateraAssetDecimals))
            ));
          });
        });
        describe("WBTC-8 : Tether-6", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });
          async function testMakeBorrowWbtcTether() : Promise<IMakeBorrowTestResults> {
            return AaveBorrowUtils.wbtcTether(deployer, converterInstance, makeBorrowTest, 100_000, 10);
          }
          it("should send borrowed amount to user", async () => {
            const r = await loadFixture(testMakeBorrowWbtcTether);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            const r = await loadFixture(testMakeBorrowWbtcTether);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            const r = await loadFixture(testMakeBorrowWbtcTether);
            // Not exact equal. npm run test can produce small differences in results sometime, i.e.
            // 56879332146581 vs 56879332146481 (WBTC-8 : Tether-6, big amounts)
            // 886499999 vs 886500000 (DAI-18 : matic-18, small amounts)
            expect(r.totalDebtBase).approximately(
              r.borrowedAmount.mul(r.priceBorrow).div(parseUnits("1", r.borrowAssetDecimals)),
              1000
            );
          });
          it("should set expected totalCollateralBase", async () => {
            const r = await loadFixture(testMakeBorrowWbtcTether);
            expect(areAlmostEqual(
              r.totalCollateralBase,
              r.collateralAmount.mul(r.priceCollateral).div(parseUnits("1", r.collateraAssetDecimals))
            ));
          });
        });
      });

      describe("Borrow max available amount using all available collateral", () => {
        describe("DAI-18 : matic-18", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });
          async function testMakeBorrowDaiWMatic() : Promise<IMakeBorrowTestResults> {
            return AaveBorrowUtils.daiWMatic(deployer, converterInstance, makeBorrowTest, undefined, undefined);
          }
          it("should send borrowed amount to user", async () => {
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            // Not exact equal. npm run test can produce small differences in results sometime, i.e.
            // 56879332146581 vs 56879332146481 (WBTC-8 : Tether-6, big amounts)
            // 886499999 vs 886500000 (DAI-18 : matic-18, small amounts)
            expect(areAlmostEqual(
              r.totalDebtBase,
              r.borrowedAmount.mul(r.priceBorrow).div(parseUnits("1", r.borrowAssetDecimals))
            )).eq(true);
          });
          it("should set expected totalCollateralBase", async () => {
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            expect(areAlmostEqual(
              r.totalCollateralBase,
              r.collateralAmount.mul(r.priceCollateral).div(parseUnits("1", r.collateraAssetDecimals))
            ));
          });
        });

        /**
         * Currently vars.rcDebtCeiling < vars.rc.isolationModeTotalDebt,
         * so new borrows are not possible
         */
        describe.skip("STASIS EURS-2 : Tether-6", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });
          async function testMakeBorrowEursTether() : Promise<IMakeBorrowTestResults> {
            return AaveBorrowUtils.eursTether(deployer, converterInstance, makeBorrowTest, undefined, undefined);
          }
          it("should send borrowed amount to user", async () => {
            const r = await loadFixture(testMakeBorrowEursTether);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            const r = await loadFixture(testMakeBorrowEursTether);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            const r = await loadFixture(testMakeBorrowEursTether);
            // Not exact equal. npm run test can produce small differences in results sometime, i.e.
            // 56879332146581 vs 56879332146481 (WBTC-8 : Tether-6, big amounts)
            // 886499999 vs 886500000 (DAI-18 : matic-18, small amounts)
            expect(areAlmostEqual(
              r.totalDebtBase,
              r.borrowedAmount.mul(r.priceBorrow).div(parseUnits("1", r.borrowAssetDecimals))
            )).eq(true);
          });
          it("should set expected totalCollateralBase", async () => {
            const r = await loadFixture(testMakeBorrowEursTether);
            expect(areAlmostEqual(
              r.totalCollateralBase,
              r.collateralAmount.mul(r.priceCollateral).div(parseUnits("1", r.collateraAssetDecimals))
            ));
          });
        });
        describe("WBTC-8 : Tether-6", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });
          async function testMakeBorrowWbtcTether() : Promise<IMakeBorrowTestResults> {
            return AaveBorrowUtils.wbtcTether(deployer, converterInstance, makeBorrowTest, undefined, undefined);
          }
          it("should send borrowed amount to user", async () => {
            const r = await loadFixture(testMakeBorrowWbtcTether);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            const r = await loadFixture(testMakeBorrowWbtcTether);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            const r = await loadFixture(testMakeBorrowWbtcTether);
            // Not exact equal. npm run test can produce small differences in results sometime, i.e.
            // 56879332146581 vs 56879332146481 (WBTC-8 : Tether-6, big amounts)
            // 886499999 vs 886500000 (DAI-18 : matic-18, small amounts)
            expect(areAlmostEqual(
              r.totalDebtBase,
              r.borrowedAmount.mul(r.priceBorrow).div(parseUnits("1", r.borrowAssetDecimals))
            )).eq(true);
          });
          it("should set expected totalCollateralBase", async () => {
            const r = await loadFixture(testMakeBorrowWbtcTether);
            expect(areAlmostEqual(
              r.totalCollateralBase,
              r.collateralAmount.mul(r.priceCollateral).div(parseUnits("1", r.collateraAssetDecimals))
            ));
          });
        });
      });
     });
  });

  /**
   *                LTV                LiquidationThreshold
   * DAI:           0.75               0.8
   * WMATIC:        0.65               0.7
   *
   * LTV: what amount of collateral we can use to borrow
   * LiquidationThreshold: if borrow amount exceeds collateral*LiquidationThreshold => liquidation
   *
   * Let's ensure in following test, that LTV and LiquidationThreshold of collateral are used
   * in calculations inside getUserAccountData. The values of borrow asset don't matter there
   */
  describe("Borrow: check LTV and liquidationThreshold", () => {
    let snapshotForEach: string;
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });

    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    async function makeTestBorrowMaxAmount(
      collateralToken: TokenDataTypes,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
    ): Promise<{userAccountData: IAave3UserAccountDataResults, collateralData: IAave3ReserveInfo}> {
      const minHealthFactor2 = 101;
      const targetHealthFactor2 = 202;
      const d = await Aave3TestUtils.prepareToBorrow(
        deployer,
        MaticCore.getCoreAave3(),
        converterInstance,
        collateralToken.address,
        collateralAmount,
        borrowToken.address,
        false,
        {targetHealthFactor2}
      );
      await d.controller.setMinHealthFactor2(minHealthFactor2);
      await d.controller.setTargetHealthFactor2(targetHealthFactor2);
      const collateralData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      console.log("collateralData", collateralData);

      // prices of assets in base currency
      const prices = await d.aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);
      console.log("prices", prices);

      // let's manually calculate max allowed amount to borrow
      const collateralAmountInBase18 = collateralAmount
        .mul(prices[0])
        .div(getBigNumberFrom(1, collateralToken.decimals));
      const maxAllowedAmountToBorrowInBase18 = collateralAmountInBase18
        .mul(100) // let's take into account min allowed health factor
        .div(minHealthFactor2)
        .mul(collateralData.data.ltv)
        .div(1e4);
      const maxAllowedAmountToBorrow = maxAllowedAmountToBorrowInBase18
        .div(prices[1])
        .mul(getBigNumberFrom(1, borrowToken.decimals));
      console.log("collateralAmountInBase18", collateralAmountInBase18);
      console.log("maxAllowedAmountToBorrowInBase18", maxAllowedAmountToBorrowInBase18);
      console.log("maxAllowedAmountToBorrow", maxAllowedAmountToBorrow);

      await transferAndApprove(
        collateralToken.address,
        d.userContract.address,
        await d.controller.tetuConverter(),
        d.collateralAmount,
        d.aavePoolAdapterAsTC.address
      );

      await d.aavePoolAdapterAsTC.borrow(collateralAmount, maxAllowedAmountToBorrow, d.userContract.address, {gasLimit: GAS_LIMIT});
      console.log("amountToBorrow", maxAllowedAmountToBorrow);

      // check results
      const ret = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
      console.log(ret);
      return {
        userAccountData: ret,
        collateralData
      }
    }
    describe("Good paths", () => {
      it("should move user account in the pool to expected state", async () => {
        const collateralAsset = MaticAddresses.DAI;
        const borrowAsset = MaticAddresses.WMATIC;

        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

        const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);

        const r = await makeTestBorrowMaxAmount(collateralToken, collateralAmount, borrowToken);

        const resultLtv = r.userAccountData.totalDebtBase
          .add(r.userAccountData.availableBorrowsBase)
          .mul(1e4)
          .div(r.userAccountData.totalCollateralBase);

        const ret = [
          r.userAccountData.ltv,
          r.userAccountData.currentLiquidationThreshold,
        ].map(x => BalanceUtils.toString(x)).join("\n");

        const expected = [
          r.collateralData.data.ltv,
          r.collateralData.data.liquidationThreshold,
        ].map(x => BalanceUtils.toString(x)).join("\n");

        expect(ret).eq(expected);
        console.log("resultLtv", resultLtv);
        console.log("r.collateralData.data.ltv", r.collateralData.data.ltv);
        expect(resultLtv).approximately(r.collateralData.data.ltv, 100);
      });
    });
  });

  describe("Borrow in isolated mode", () => {
    let snapshotForEach: string;
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });

    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

//region Utils
    interface IBorrowMaxAmountInIsolationModeResults {
      init: IPrepareToBorrowResults;
      maxBorrowAmount: BigNumber;
      maxBorrowAmountByPlan: BigNumber;
      isolationModeTotalDebtDelta: BigNumber;
    }

    interface IBorrowMaxAmountInIsolationModeBadPaths {
      customAmountToBorrow?: BigNumber;
      deltaToMaxAmount?: BigNumber;
      customCollateralAmount?: BigNumber;
    }

    /**
     * Calculate max allowed borrow amount in isolation mode manually and using getConversionPlan
     * Try to make borrow of (the max allowed amount + optional delta)
     */
    async function borrowMaxAmountInIsolationMode (
      collateralToken: TokenDataTypes,
      collateralAmountRequired: BigNumber,
      borrowToken: TokenDataTypes,
      emode: boolean,
      badPathsParams?: IBorrowMaxAmountInIsolationModeBadPaths
    ) : Promise<IBorrowMaxAmountInIsolationModeResults>{
      const d = await Aave3TestUtils.prepareToBorrow(
        deployer,
        MaticCore.getCoreAave3(),
        converterInstance,
        collateralToken.address,
        collateralAmountRequired,
        borrowToken.address,
        emode,
      );
      console.log("Plan", d.plan);

      const collateralDataBefore = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      console.log("collateralDataBefore", collateralDataBefore);

      // calculate max amount to borrow manually
      const maxBorrowAmount = d.plan.amountToBorrow;

      const collateralAmount = badPathsParams?.customCollateralAmount || d.collateralAmount;
      await transferAndApprove(
        collateralToken.address,
        d.userContract.address,
        await d.controller.tetuConverter(),
        collateralAmount,
        d.aavePoolAdapterAsTC.address
      );

      const amountToBorrow = badPathsParams?.deltaToMaxAmount
        ? maxBorrowAmount // restore real max amount
          .mul(100) // Aave3PlatformAdapter.MAX_BORROW_AMOUNT_FACTOR_DENOMINATOR
          .div(90)  // Aave3PlatformAdapter.MAX_BORROW_AMOUNT_FACTOR
          .add(badPathsParams?.deltaToMaxAmount)
        : badPathsParams?.customAmountToBorrow
          ? badPathsParams?.customAmountToBorrow
          : maxBorrowAmount;

      console.log("Try to borrow", amountToBorrow, maxBorrowAmount);
      console.log("Using collateral", collateralAmount);

      await d.aavePoolAdapterAsTC.borrow(collateralAmount, amountToBorrow, d.userContract.address, {gasLimit: GAS_LIMIT});

      // after borrow
      const collateralDataAfter = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      console.log("collateralDataAfter", collateralDataAfter);
      const isolationModeTotalDebtDelta = BigNumber.from(collateralDataAfter.data.isolationModeTotalDebt)
        .sub(BigNumber.from(collateralDataBefore.data.isolationModeTotalDebt));
      console.log("isolationModeTotalDebtDelta", isolationModeTotalDebtDelta);

      return {
        init: d,
        maxBorrowAmount,
        maxBorrowAmountByPlan: d.plan.amountToBorrow,
        isolationModeTotalDebtDelta
      }
    }
//endregion Utils

    describe("Good paths", () => {
      describe("USDT : DAI", () => {
//region Constants
        const collateralAsset = MaticAddresses.USDT;
        const borrowAsset = MaticAddresses.DAI;
//endregion Constants
        describe("Try to borrow max amount allowed by debt ceiling", () => {
          it("should return expected values", async () => {
            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

            const ret = await borrowMaxAmountInIsolationMode(
              collateralToken,
              parseUnits("100000000", 6), // huge amount
              borrowToken,
              true // emode
            );

            const sret = ret.maxBorrowAmount.toString();
            const sexpected = ret.maxBorrowAmountByPlan.toString();

            expect(sret).eq(sexpected);
          });
        });
      });

      /**
       * The test is disabled
       * because currently there is not enough EURO
       * to cover max allowed amount of USDC or DAI
       */
      describe.skip("EURS : DAI", () => {
        const collateralAsset = MaticAddresses.EURS;
        const borrowAsset = MaticAddresses.DAI;

        describe("Try to borrow max amount allowed by debt ceiling", () => {
          it("should return expected values", async () => {
            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

            const ret = await borrowMaxAmountInIsolationMode(
              collateralToken,
              parseUnits("100000000", 2), // huge amount
              borrowToken,
              true // emode
            );

            const sret = ret.maxBorrowAmount.toString();
            const sexpected = ret.maxBorrowAmountByPlan.toString();

            // Error 36 means "there is not enough EURO on balances of the EURO holders
            expect(sret).eq(sexpected);
          });
        });
      });

      /**
       * Currently vars.rcDebtCeiling < vars.rc.isolationModeTotalDebt,
       * so new borrows are not possible
       */
      describe.skip("EURS : USDT @skip-on-coverage", () => {
        const collateralAsset = MaticAddresses.EURS;
        const borrowAsset = MaticAddresses.USDT;

        describe("Try to borrow max amount allowed by debt ceiling", () => {
          /**
           * todo max amount to supply cannot be calculated through reverse plan
           */
          it.skip("should return expected values", async () => {
            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

            const ret = await borrowMaxAmountInIsolationMode(
              collateralToken,
              parseUnits("1000000000", 2),
              borrowToken,
              true // emode
            );

            const sret = ret.maxBorrowAmount.toString();
            const sexpected = ret.maxBorrowAmountByPlan.toString();

            // Error 36 means "there is not enough EURO on balances of the EURO holders
            expect(sret).eq(sexpected);
          });
        });
      });
    });

    describe("Bad paths", () => {
      describe("Debt ceiling exceeded", () => {
        describe("USDT : DAI", () => {
//region Constants
          const collateralAsset = MaticAddresses.USDT;
          const borrowAsset = MaticAddresses.DAI;
//endregion Constants
          describe("Try to borrow max amount allowed by debt ceiling", () => {
            it("should return expected values", async () => {
              const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
              const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

              await expect(
                borrowMaxAmountInIsolationMode(
                  collateralToken,
                  parseUnits("100000000", 6), // huge amount
                  borrowToken,
                  true, // emode
                  {deltaToMaxAmount: Misc.WEI} // 1 DAI
                )
              ).to.be.reverted; // 50 or 53 are allowed here
            });
          });
        });

        /**
         * There is not enough EURO-amount on holders accounts to make max borrow
         */
        describe.skip("EURS : USDC", () => {
//region Constants
          const collateralAsset = MaticAddresses.EURS;
          const borrowAsset = MaticAddresses.USDC;
//endregion Constants

          describe("Try to borrow max amount allowed by debt ceiling", () => {
            it("should return expected values", async () => {
              const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
              const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

              await expect(
                borrowMaxAmountInIsolationMode(
                  collateralToken,
                  parseUnits("100000000", 2), // huge amount
                  borrowToken,
                  true, // emode
                  {deltaToMaxAmount: parseUnits("1", 6)} // 1 USDC
                )
              ).revertedWith("53");
            });
          });
        });
      });
      describe("Not borrowable in isolation mode", () => {
        describe("USDT : WETH", () => {
//region Constants
          const collateralAsset = MaticAddresses.USDT;
          const borrowAsset = MaticAddresses.WETH;
//endregion Constants
          describe("Try to borrow not zero amount", () => {
            it("should return expected values", async () => {
              const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
              const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

              await expect(
                borrowMaxAmountInIsolationMode(
                  collateralToken,
                  parseUnits("100000000", 6), // huge amount
                  borrowToken,
                  true, // emode
                  {
                    customAmountToBorrow: parseUnits("20", borrowToken.decimals),
                    customCollateralAmount: parseUnits("200", collateralToken.decimals)
                  }
                )
              ).revertedWith("60");
            });
          });
        });
      });
    });
  });

  describe("repay", () => {
    let snapshotForEach: string;
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });

    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    /* Make full or partial repay. Set amountToRepay for partial repay, leave it undefined to full repay */
    async function makeBorrowAndRepay(
      collateralToken: TokenDataTypes,
      collateralAmountRequired: BigNumber,
      borrowToken: TokenDataTypes,
      borrowAmountRequired: BigNumber | undefined,
      amountToRepay?: BigNumber,
      initialBorrowAmountOnUserBalance?: BigNumber,
      badParams?: IBorrowAndRepayBadParams
    ) : Promise<IMakeBorrowAndRepayResults>{
      const d = await Aave3TestUtils.prepareToBorrow(
        deployer,
        MaticCore.getCoreAave3(), // todo
        converterInstance,
        collateralToken.address,
        collateralAmountRequired,
        borrowToken.address,
        false
      );
      const collateralData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      const borrowAmount = borrowAmountRequired
        ? borrowAmountRequired
        : d.amountToBorrow;
      console.log("collateralAmountRequired", collateralAmountRequired);
      console.log("borrowAmountRequired", borrowAmountRequired);
      console.log("d.collateralAmount", d.collateralAmount);
      console.log("borrowAmount", borrowAmount);

      // borrow asset
      if (initialBorrowAmountOnUserBalance) {
        await TokenUtils.getToken(borrowToken.token.address, d.userContract.address, initialBorrowAmountOnUserBalance);
      }

      const beforeBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };

      // make borrow
      if (! badParams?.skipBorrow) {
        await transferAndApprove(
          collateralToken.address,
          d.userContract.address,
          await d.controller.tetuConverter(),
          d.collateralAmount,
          d.aavePoolAdapterAsTC.address
        );

        await d.aavePoolAdapterAsTC.borrow(d.collateralAmount, borrowAmount, d.userContract.address, {gasLimit: GAS_LIMIT});
      }

      const afterBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      console.log("afterBorrow", afterBorrow);

      await TimeUtils.advanceNBlocks(1000);

      const borrowTokenAsUser = IERC20Metadata__factory.connect(
        borrowToken.address,
        await DeployerUtils.startImpersonate(d.userContract.address)
      );
      if (amountToRepay) {
        const repayCaller = badParams?.repayAsNotUserAndNotTC
          ? deployer.address // not TC, not user
          : await d.controller.tetuConverter();

        const poolAdapterAsCaller = IPoolAdapter__factory.connect(
            d.aavePoolAdapterAsTC.address,
            await DeployerUtils.startImpersonate(repayCaller)
        );

        // make partial repay
        const amountBorrowAssetToSendToPoolAdapter = badParams?.wrongAmountToRepayToTransfer
          ? badParams?.wrongAmountToRepayToTransfer
          : amountToRepay;

        await transferAndApprove(
          borrowToken.address,
          d.userContract.address,
          repayCaller,
          amountBorrowAssetToSendToPoolAdapter,
          d.aavePoolAdapterAsTC.address
        );

        await poolAdapterAsCaller.repay(
          amountToRepay,
          d.userContract.address,
          // normally we don't close position here
          // but in bad paths we need to emulate attempts to close the position
          badParams?.forceToClosePosition || false,
          {gasLimit: GAS_LIMIT}
        );
      } else {
        console.log("user balance borrow asset before repay", await borrowTokenAsUser.balanceOf(d.userContract.address));
        // make full repayment
        await d.userContract.makeRepayComplete(
          collateralToken.address,
          borrowToken.address,
          d.userContract.address
        );
        console.log("user balance borrow asset after repay", await borrowTokenAsUser.balanceOf(d.userContract.address));
      }

      // check results
      const afterRepay: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      console.log("afterRepay", afterRepay);

      const ret = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);

      return {
        userBalancesBeforeBorrow: beforeBorrow,
        userBalancesAfterBorrow: afterBorrow,
        userBalancesAfterRepay: afterRepay,
        paATokensBalance: await IERC20Metadata__factory.connect(collateralData.data.aTokenAddress, deployer)
          .balanceOf(d.aavePoolAdapterAsTC.address),
        totalCollateralBase: ret.totalCollateralBase,
        totalDebtBase: ret.totalDebtBase,
        poolAdapter: d.aavePoolAdapterAsTC.address,
        collateralAmount: d.collateralAmount,
        borrowAmount
      }
    }

    /** Replaced by BorrowRepayCaseTest */
    describe.skip("Good paths", () => {
      /** The test is replaced by BorrowRepayCaseTest */
      describe("Borrow and repay modest amount", () => {
        describe("Partial repay of borrowed amount", () => {
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
                deployer,
                makeBorrowAndRepay,
                false,
                false
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("WMATIC => DAI", () => {
            it("should return expected balances", async () => {
              const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
                deployer,
                makeBorrowAndRepay,
                false,
                false
              );
              expect(r.ret).eq(r.expected);
            });
          });
        });
        /** The test is replaced by BorrowRepayCaseTest */
        describe.skip("Full repay of borrowed amount", () => {
          it("should return expected balances", async () => {
            const initialBorrowAmountOnUserBalance = 1;
            const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
              deployer,
              makeBorrowAndRepay,
              true,
              false,
              initialBorrowAmountOnUserBalance
            );
            expect(r.ret).eq(r.expected);
          });
        });
      });
      describe("Borrow max available amount using all available collateral", () => {
        describe("Full repay of borrowed amount", () => {
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              const initialBorrowAmountOnUserBalance = 20000;
              const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
                deployer,
                makeBorrowAndRepay,
                true,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("WMATIC => DAI", () => {
            it("should return expected balances", async () => {
              const initialBorrowAmountOnUserBalance = 20000;
              const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
                deployer,
                makeBorrowAndRepay,
                true,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
        });
      });
    });
    describe("Bad paths", () => {
      describe("Transfer amount less than specified amount to repay", () => {
        it("should revert", async () => {
          const daiDecimals = await IERC20Metadata__factory.connect(MaticAddresses.DAI, deployer).decimals();
          await expect(
            AaveMakeBorrowAndRepayUtils.wmaticDai(
              deployer,
              makeBorrowAndRepay,
              false,
              false,
              undefined,
              {
                // try to transfer too small amount on balance of the pool adapter
                wrongAmountToRepayToTransfer: getBigNumberFrom(1, daiDecimals)
              }
            )
          ).revertedWith("ERC20: transfer amount exceeds balance");
        });
      });
      describe("Try to repay not opened position", () => {
        it("should revert", async () => {
          const initialBorrowAmountOnUserBalanceNumber = 1000;
          await expect(
            AaveMakeBorrowAndRepayUtils.daiWmatic(
              deployer,
              makeBorrowAndRepay,
              false,
              false,
              initialBorrowAmountOnUserBalanceNumber,
              {skipBorrow: true}
            )
          ).revertedWith("TC-28 zero balance"); // ZERO_BALANCE
        });
      });
      describe("Try to close position with not zero debt", () => {
        it("should revert", async () => {
          await expect(
            AaveMakeBorrowAndRepayUtils.daiWmatic(
              deployer,
              makeBorrowAndRepay,
              false,
              false,
              undefined,
              {forceToClosePosition: true}
            )
          ).revertedWith("TC-55 close position not allowed"); // CLOSE_POSITION_PARTIAL
        });
      });
    });
  });

//endregion Unit tests

});