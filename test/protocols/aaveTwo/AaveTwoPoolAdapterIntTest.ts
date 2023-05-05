import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  ConverterController,
  IERC20Metadata__factory,
  IPoolAdapter__factory
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {BalanceUtils, IUserBalances} from "../../baseUT/utils/BalanceUtils";
import {AaveTwoHelper, IAaveTwoReserveInfo} from "../../../scripts/integration/helpers/AaveTwoHelper";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {IAaveTwoUserAccountDataResults} from "../../baseUT/apr/aprAaveTwo";
import {
  AaveMakeBorrowAndRepayUtils, IBorrowAndRepayBadParams,
  IMakeBorrowAndRepayResults
} from "../../baseUT/protocols/aaveShared/aaveBorrowAndRepayUtils";
import {AaveBorrowUtils, IMakeBorrowTestResults} from "../../baseUT/protocols/aaveShared/aaveBorrowUtils";
import {transferAndApprove} from "../../baseUT/utils/transferUtils";
import {AaveTwoTestUtils, IPrepareToBorrowResults} from "../../baseUT/protocols/aaveTwo/AaveTwoTestUtils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {Misc} from "../../../scripts/utils/Misc";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {GAS_LIMIT} from "../../baseUT/GasLimit";

describe("AaveTwoPoolAdapterIntTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let controllerInstance: ConverterController;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    controllerInstance = await TetuConverterApp.createController(deployer);
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Unit tests
  describe("borrow", () => {
    async function makeBorrowTest(
      controller: ConverterController,
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowAmountRequired: BigNumber | undefined,
      targetHealthFactor2: number = 202,
      minHealthFactor2: number = 101,
    ) : Promise<IMakeBorrowTestResults>{
      const d = await AaveTwoTestUtils.prepareToBorrow(
        deployer,
        controller,
        collateralToken,
        collateralHolder,
        collateralAmountRequired,
        borrowToken,
        {
          targetHealthFactor2
        }
      );

      await d.controller.setMinHealthFactor2(minHealthFactor2);
      await d.controller.setTargetHealthFactor2(targetHealthFactor2);

      const borrowResults = await AaveTwoTestUtils.makeBorrow(deployer, d, borrowAmountRequired);

      // check results
      const ret = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);

      // amount of collateral tokens on pool-adapter's balance
      const collateralBalance = await IERC20Metadata__factory.connect(borrowResults.collateralData.data.aTokenAddress, deployer)
          .balanceOf(d.aavePoolAdapterAsTC.address);
      // borrowed amount on user's balance
      const borrowAssetBalance = await borrowToken.token.balanceOf(d.userContract.address);

      return {
        borrowedAmount: borrowResults.borrowedAmount,
        priceBorrow: d.priceBorrow,
        borrowAssetDecimals: borrowToken.decimals,

        collateralAmount: d.collateralAmount,
        priceCollateral: d.priceCollateral,
        collateraAssetDecimals: collateralToken.decimals,

        userBalanceBorrowedAsset: borrowAssetBalance,
        poolAdapterBalanceCollateralAsset: collateralBalance,
        totalCollateralBase: ret.totalCollateralETH,
        totalDebtBase: ret.totalDebtETH,
      }
    }
    describe("Good paths", () => {
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
            return AaveBorrowUtils.daiWMatic(deployer, controllerInstance, makeBorrowTest, 100_000, 10);
          }
          it("should send borrowed amount to user", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            if (!await isPolygonForkInUse()) return;
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
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            expect(areAlmostEqual(
              r.totalCollateralBase,
              r.collateralAmount.mul(r.priceCollateral).div(parseUnits("1", r.collateraAssetDecimals))
            ));
          });
        });
        describe("DAI-18 : USDC-6", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });
          async function testMakeBorrowDaiUsdc() : Promise<IMakeBorrowTestResults> {
            return AaveBorrowUtils.daiUsdc(deployer, controllerInstance, makeBorrowTest, 100_000, 10);
          }
          it("should send borrowed amount to user", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiUsdc);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiUsdc);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiUsdc);
            // Not exact equal. npm run test can produce small differences in results sometime, i.e.
            // 56879332146581 vs 56879332146481 (WBTC-8 : Tether-6, big amounts)
            // 886499999 vs 886500000 (DAI-18 : matic-18, small amounts)
            expect(areAlmostEqual(
              r.totalDebtBase,
              r.borrowedAmount.mul(r.priceBorrow).div(parseUnits("1", r.borrowAssetDecimals))
            )).eq(true);
          });
          it("should set expected totalCollateralBase", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiUsdc);
            expect(areAlmostEqual(
              r.totalCollateralBase,
              r.collateralAmount.mul(r.priceCollateral).div(parseUnits("1", r.collateraAssetDecimals))
            ));
          });
        });
        describe("USDC-6 : DAI-18", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });
          async function testMakeBorrowUsdcDai() : Promise<IMakeBorrowTestResults> {
            return AaveBorrowUtils.usdcDai(deployer, controllerInstance, makeBorrowTest, 100_000, 10);
          }
          it("should send borrowed amount to user", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowUsdcDai);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowUsdcDai);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowUsdcDai);
            // Not exact equal. npm run test can produce small differences in results sometime, i.e.
            // 56879332146581 vs 56879332146481 (WBTC-8 : Tether-6, big amounts)
            // 886499999 vs 886500000 (DAI-18 : matic-18, small amounts)
            expect(areAlmostEqual(
              r.totalDebtBase,
              r.borrowedAmount.mul(r.priceBorrow).div(parseUnits("1", r.borrowAssetDecimals))
            )).eq(true);
          });
          it("should set expected totalCollateralBase", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowUsdcDai);
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
            return AaveBorrowUtils.wbtcTether(deployer, controllerInstance, makeBorrowTest, 100_000, 10);
          }
          it("should send borrowed amount to user", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowWbtcTether);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowWbtcTether);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowWbtcTether);
            // Not exact equal. npm run test can produce small differences in results sometime, i.e.
            // 56879332146581 vs 56879332146481 (WBTC-8 : Tether-6, big amounts)
            // 886499999 vs 886500000 (DAI-18 : matic-18, small amounts)
            expect(areAlmostEqual(
              r.totalDebtBase,
              r.borrowedAmount.mul(r.priceBorrow).div(parseUnits("1", r.borrowAssetDecimals)),
              6
            )).eq(true);
          });
          it("should set expected totalCollateralBase", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowWbtcTether);
            expect(areAlmostEqual(
              r.totalCollateralBase,
              r.collateralAmount.mul(r.priceCollateral).div(parseUnits("1", r.collateraAssetDecimals))
            ));
          });
        });
      });
      describe("Borrow max available amount using all available collateral", () => {
        describe("DAI-18 : USDC-6", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });
          async function testMakeBorrowDaiUsdc() : Promise<IMakeBorrowTestResults> {
            return AaveBorrowUtils.daiUsdc(deployer, controllerInstance, makeBorrowTest, undefined, undefined);
          }
          it("should send borrowed amount to user", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiUsdc);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiUsdc);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiUsdc);
            // Not exact equal. npm run test can produce small differences in results sometime, i.e.
            // 56879332146581 vs 56879332146481 (WBTC-8 : Tether-6, big amounts)
            // 886499999 vs 886500000 (DAI-18 : matic-18, small amounts)
            expect(areAlmostEqual(
              r.totalDebtBase,
              r.borrowedAmount.mul(r.priceBorrow).div(parseUnits("1", r.borrowAssetDecimals))
            )).eq(true);
          });
          it("should set expected totalCollateralBase", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiUsdc);
            expect(areAlmostEqual(
              r.totalCollateralBase,
              r.collateralAmount.mul(r.priceCollateral).div(parseUnits("1", r.collateraAssetDecimals))
            ));
          });
        });
        describe("DAI-18 : matic-18", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });
          async function testMakeBorrowDaiWMatic() : Promise<IMakeBorrowTestResults> {
            return AaveBorrowUtils.daiWMatic(deployer, controllerInstance, makeBorrowTest, undefined, undefined);
          }
          it("should send borrowed amount to user", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            if (!await isPolygonForkInUse()) return;
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
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowDaiWMatic);
            expect(areAlmostEqual(
              r.totalCollateralBase,
              r.collateralAmount.mul(r.priceCollateral).div(parseUnits("1", r.collateraAssetDecimals))
            ));
          });
        });
        describe("USDC-6 : DAI-18", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });
          async function testMakeBorrowUsdcDai() : Promise<IMakeBorrowTestResults> {
            return AaveBorrowUtils.usdcDai(deployer, controllerInstance, makeBorrowTest, undefined, undefined);
          }
          it("should send borrowed amount to user", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowUsdcDai);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowUsdcDai);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowUsdcDai);
            // Not exact equal. npm run test can produce small differences in results sometime, i.e.
            // 56879332146581 vs 56879332146481 (WBTC-8 : Tether-6, big amounts)
            // 886499999 vs 886500000 (DAI-18 : matic-18, small amounts)
            expect(areAlmostEqual(
              r.totalDebtBase,
              r.borrowedAmount.mul(r.priceBorrow).div(parseUnits("1", r.borrowAssetDecimals))
            )).eq(true);
          });
          it("should set expected totalCollateralBase", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowUsdcDai);
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
            return AaveBorrowUtils.wbtcTether(deployer, controllerInstance, makeBorrowTest, undefined, undefined);
          }
          it("should send borrowed amount to user", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowWbtcTether);
            expect(r.userBalanceBorrowedAsset.eq(r.borrowedAmount)).eq(true)
          });
          it("should send collateral to pool adapter", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await loadFixture(testMakeBorrowWbtcTether);
            // almost equal, because of: 100000000000000000000001 instead 100000000000000000000000 happens in tests
            expect(areAlmostEqual(r.poolAdapterBalanceCollateralAsset, r.collateralAmount)).eq(true);
          });
          it("should set expected totalDebtBase value", async () => {
            if (!await isPolygonForkInUse()) return;
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
            if (!await isPolygonForkInUse()) return;
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

  describe("Borrow using small health factors", () => {
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });

    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });
    interface ITestSmallHealthFactorResults {
      d: IPrepareToBorrowResults;
      resultHealthFactor18: BigNumber;
    }
    async function makeTestSmallHealthFactor(
      collateralAsset: string,
      collateralHolder: string,
      borrowAsset: string,
      targetHealthFactor2: number,
      minHealthFactor2: number
    ) : Promise<ITestSmallHealthFactorResults> {

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

      const collateralAmount = parseUnits("20000", 6);

      const d = await AaveTwoTestUtils.prepareToBorrow(
        deployer,
        controllerInstance,
        collateralToken,
        collateralHolder,
        collateralAmount,
        borrowToken,
        {
          targetHealthFactor2
        }
      );

      await d.controller.setMinHealthFactor2(minHealthFactor2);
      await d.controller.setTargetHealthFactor2(targetHealthFactor2);

      await AaveTwoTestUtils.makeBorrow(deployer, d, undefined);
      const r = await d.aavePoolAdapterAsTC.getStatus();
      return {
        d,
        resultHealthFactor18: r.healthFactor18
      }
    }
    describe("Good paths", () => {
      describe("health factor is less than liquidationThreshold18/LTV", () => {
        it("should borrow with health factor = liquidationThreshold18/LTV", async () => {
          const targetHealthFactor2 = 103;
          const minHealthFactor2 = 101;

          const collateralAsset = MaticAddresses.USDC;
          const collateralHolder = MaticAddresses.HOLDER_USDC;
          const borrowAsset = MaticAddresses.DAI;

          const r = await makeTestSmallHealthFactor(
            collateralAsset,
            collateralHolder,
            borrowAsset,
            targetHealthFactor2,
            minHealthFactor2
          );
          console.log("Results", r);
          const minHealthFactorAllowedByPlatform = +formatUnits(
            r.d.collateralReserveInfo.data.liquidationThreshold
              .mul(Misc.WEI)
              .div(r.d.collateralReserveInfo.data.ltv),
            18
          );
          const healthFactor = +formatUnits(r.resultHealthFactor18, 18);
          console.log("healthFactor", healthFactor);
          console.log("minHealthFactorAllowedByPlatform", minHealthFactorAllowedByPlatform);

          const ret = [
            targetHealthFactor2 < minHealthFactorAllowedByPlatform * 100,
            healthFactor >= minHealthFactorAllowedByPlatform - 1,
            healthFactor <= minHealthFactorAllowedByPlatform + 1
          ].join();
          const expected = [true, true, true].join();

          expect(ret).eq(expected);
        });
      });
      describe("health factor is greater than liquidationThreshold18/LTV", () => {
        it("should borrow with specified health factor", async () => {
          const targetHealthFactor2 = 108;
          const minHealthFactor2 = 101;

          const collateralAsset = MaticAddresses.USDC;
          const collateralHolder = MaticAddresses.HOLDER_USDC;
          const borrowAsset = MaticAddresses.DAI;

          const r = await makeTestSmallHealthFactor(
            collateralAsset,
            collateralHolder,
            borrowAsset,
            targetHealthFactor2,
            minHealthFactor2
          );
          console.log("Results", r);
          const minHealthFactorAllowedByPlatform = +formatUnits(
            r.d.collateralReserveInfo.data.liquidationThreshold
              .mul(Misc.WEI)
              .div(r.d.collateralReserveInfo.data.ltv),
            18
          );
          const healthFactor = +formatUnits(r.resultHealthFactor18, 18);
          console.log("healthFactor", healthFactor);
          console.log("minHealthFactorAllowedByPlatform", minHealthFactorAllowedByPlatform);
          const ret = [
            targetHealthFactor2 > minHealthFactorAllowedByPlatform,
            healthFactor >= targetHealthFactor2/100 - 1,
            healthFactor <= targetHealthFactor2/100 + 1
          ].join();
          const expected = [true, true, true].join();

          expect(ret).eq(expected);
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
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });

    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });
    async function makeBorrowMaxAmount(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
    ): Promise<{userAccountData: IAaveTwoUserAccountDataResults, collateralData: IAaveTwoReserveInfo}> {
      const minHealthFactor2 = 101;
      const targetHealthFactor2 = 202;
      const d = await AaveTwoTestUtils.prepareToBorrow(
        deployer,
        controllerInstance,
        collateralToken,
        collateralHolder,
        collateralAmount,
        borrowToken,
        {
          targetHealthFactor2
        }
      );

      await d.controller.setMinHealthFactor2(minHealthFactor2);
      await d.controller.setTargetHealthFactor2(targetHealthFactor2);
      const collateralData = await AaveTwoHelper.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
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
        if (!await isPolygonForkInUse()) return;

        const collateralAsset = MaticAddresses.DAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.WMATIC;

        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

        const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);

        const r = await makeBorrowMaxAmount(
          collateralToken
          , collateralHolder
          , collateralAmount
          , borrowToken
        );
        console.log(r);

        const ret = [
          r.userAccountData.ltv,
          r.userAccountData.currentLiquidationThreshold,
          r.userAccountData.totalDebtETH
            .add(r.userAccountData.availableBorrowsETH)
            .mul(1e4)
            .div(r.userAccountData.totalCollateralETH)
        ].map(x => BalanceUtils.toString(x)).join("\n");

        const expected = [
          r.collateralData.data.ltv,
          r.collateralData.data.liquidationThreshold,
          r.collateralData.data.ltv
        ].map(x => BalanceUtils.toString(x)).join("\n");

        expect(ret).eq(expected);
      });
    });
  });

  describe("repay", () =>{
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });

    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });
    async function makeBorrowAndRepay(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowHolder: string,
      borrowAmountRequired: BigNumber | undefined,
      amountToRepay?: BigNumber,
      initialBorrowAmountOnUserBalance?: BigNumber,
      badParams?: IBorrowAndRepayBadParams
    ) : Promise<IMakeBorrowAndRepayResults>{
      const d = await AaveTwoTestUtils.prepareToBorrow(
        deployer,
        controllerInstance,
        collateralToken,
        collateralHolder,
        collateralAmountRequired,
        borrowToken,
      );
      const collateralData = await AaveTwoHelper.getReserveInfo(deployer,
        d.aavePool,
        d.dataProvider,
        collateralToken.address
      );
      const borrowAmount = borrowAmountRequired
        ? borrowAmountRequired
        : d.amountToBorrow;

      // borrow asset
      if (initialBorrowAmountOnUserBalance) {
        await borrowToken.token
          .connect(await DeployerUtils.startImpersonate(borrowHolder))
          .transfer(d.userContract.address, initialBorrowAmountOnUserBalance);
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
      console.log(afterBorrow);

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
      const ret = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);

      return {
        userBalancesBeforeBorrow: beforeBorrow,
        userBalancesAfterBorrow: afterBorrow,
        userBalancesAfterRepay: afterRepay,
        paATokensBalance: await IERC20Metadata__factory.connect(collateralData.data.aTokenAddress, deployer)
          .balanceOf(d.aavePoolAdapterAsTC.address),
        totalCollateralBase: ret.totalCollateralETH,
        totalDebtBase: ret.totalDebtETH,
        poolAdapter: d.aavePoolAdapterAsTC.address,
        collateralAmount: d.collateralAmount,
        borrowAmount
      }
    }
    describe("Good paths", () =>{
      describe("Borrow and repay modest amount", () =>{
        describe("Partial repay of borrowed amount", () => {
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
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
              if (!await isPolygonForkInUse()) return;
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
        describe("Full repay of borrowed amount", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
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
              if (!await isPolygonForkInUse()) return;
              const initialBorrowAmountOnUserBalance = 20_000;
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
              if (!await isPolygonForkInUse()) return;
              const initialBorrowAmountOnUserBalance = 20_000;
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
          if (!await isPolygonForkInUse()) return;

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
          if (!await isPolygonForkInUse()) return;
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
          if (!await isPolygonForkInUse()) return;
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