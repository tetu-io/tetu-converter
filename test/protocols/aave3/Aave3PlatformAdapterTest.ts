import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  Aave3PlatformAdapter,
  Aave3PlatformAdapter__factory, BorrowManager__factory, Controller, IAavePool,
  IAaveProtocolDataProvider, IERC20Metadata__factory
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {Aave3Helper, IAave3ReserveInfo} from "../../../scripts/integration/helpers/Aave3Helper";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {AprUtils, COUNT_BLOCKS_PER_DAY} from "../../baseUT/utils/aprUtils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IPlatformActor, PredictBrUsesCase} from "../../baseUT/uses-cases/PredictBrUsesCase";
import {AprAave3, getAave3StateInfo, IAave3StateInfo, IAaveReserveData} from "../../baseUT/apr/aprAave3";
import {Misc} from "../../../scripts/utils/Misc";
import {convertUnits} from "../../baseUT/apr/aprUtils";
import {Aave3Utils} from "../../baseUT/protocols/aave3/Aave3Utils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {IConversionPlan} from "../../baseUT/apr/aprDataTypes";
import {parseUnits} from "ethers/lib/utils";
import {Aave3ChangePricesUtils} from "../../baseUT/protocols/aave3/Aave3ChangePricesUtils";
import {controlGasLimitsEx} from "../../../scripts/utils/hardhatUtils";
import {GAS_LIMIT_AAVE_3_GET_CONVERSION_PLAN} from "../../baseUT/GasLimit";

describe("Aave3PlatformAdapterTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let investor: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    investor = signers[0];
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

//region IPlatformActor impl
  class Aave3PlatformActor implements IPlatformActor {
    dp: IAaveProtocolDataProvider;
    pool: IAavePool;
    collateralAsset: string;
    borrowAsset: string;
    private h: Aave3Helper;
    constructor(
      dataProvider: IAaveProtocolDataProvider,
      pool: IAavePool,
      collateralAsset: string,
      borrowAsset: string
    ) {
      this.h = new Aave3Helper(deployer);
      this.dp = dataProvider;
      this.pool = pool;
      this.collateralAsset = collateralAsset;
      this.borrowAsset = borrowAsset;
    }
    async getAvailableLiquidity() : Promise<BigNumber> {
      const rd = await this.dp.getReserveData(this.borrowAsset);
      console.log(`Reserve data before: totalAToken=${rd.totalAToken} totalStableDebt=${rd.totalStableDebt} totalVariableDebt=${rd.totalVariableDebt}`);
      const availableLiquidity = rd.totalAToken.sub(
        rd.totalStableDebt.add(rd.totalVariableDebt)
      );
      console.log("availableLiquidity", availableLiquidity);
      return availableLiquidity;
    }
    async getCurrentBR(): Promise<BigNumber> {
      const data = await this.h.getReserveInfo(deployer, this.pool, this.dp, this.borrowAsset);
      const br = data.data.currentVariableBorrowRate;
      console.log(`BR ${br.toString()}`);
      return BigNumber.from(br);
    }
    async supplyCollateral(collateralAmount: BigNumber): Promise<void> {
      await IERC20Metadata__factory.connect(this.collateralAsset, deployer).approve(this.pool.address, collateralAmount);
      console.log(`Supply collateral ${this.collateralAsset} amount ${collateralAmount}`);
      await this.pool.supply(this.collateralAsset, collateralAmount, deployer.address, 0);
      const userAccountData = await this.pool.getUserAccountData(deployer.address);
      console.log(`Available borrow base ${userAccountData.availableBorrowsBase}`);
      await this.pool.setUserUseReserveAsCollateral(this.collateralAsset, true);
    }
    async borrow(borrowAmount: BigNumber): Promise<void> {
      console.log(`borrow ${this.borrowAsset} amount ${borrowAmount}`);
      await this.pool.borrow(this.borrowAsset, borrowAmount, 2, 0, deployer.address);

    }
  }
//endregion IPlatformActor impl

//region Unit tests
  describe("constructor and converters()", () => {
    interface IContractsSet {
      controller: string;
      templateAdapterNormal: string;
      templateAdapterEMode: string;
      aavePool: string;
    }
    interface ICreateContractsSetBadParams {
      zeroController?: boolean;
      zeroTemplateAdapterNormal?: boolean;
      zeroTemplateAdapterEMode?: boolean;
      zeroAavePool?: boolean;
    }
    async function initializePlatformAdapter(
      badPaths?: ICreateContractsSetBadParams
    ) : Promise<{data: IContractsSet, platformAdapter: Aave3PlatformAdapter}> {
      const controller = await TetuConverterApp.createController(
        deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const templateAdapterNormalStub = ethers.Wallet.createRandom();
      const templateAdapterEModeStub = ethers.Wallet.createRandom();

      const data: IContractsSet = {
        controller: badPaths?.zeroController ? Misc.ZERO_ADDRESS : controller.address,
        aavePool: badPaths?.zeroAavePool ? Misc.ZERO_ADDRESS : MaticAddresses.AAVE_V3_POOL,
        templateAdapterEMode: badPaths?.zeroTemplateAdapterEMode ? Misc.ZERO_ADDRESS : templateAdapterEModeStub.address,
        templateAdapterNormal: badPaths?.zeroTemplateAdapterNormal ? Misc.ZERO_ADDRESS : templateAdapterNormalStub.address
      }
      const platformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
        deployer,
        data.controller,
        data.aavePool,
        data.templateAdapterNormal,
        data.templateAdapterEMode
      );
      return {data, platformAdapter};
    }
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await initializePlatformAdapter();

        const ret = [
          await r.platformAdapter.controller(),
          await r.platformAdapter.pool(),
          await r.platformAdapter.converterNormal(),
          await r.platformAdapter.converterEMode(),
          (await r.platformAdapter.converters()).join()
        ].join();
        const expected = [
          r.data.controller,
          r.data.aavePool,
          r.data.templateAdapterNormal,
          r.data.templateAdapterEMode,
          [r.data.templateAdapterNormal, r.data.templateAdapterEMode].join()
        ].join();

        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert if aave-pool is zero", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          initializePlatformAdapter({zeroAavePool: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if controller is zero", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          initializePlatformAdapter({zeroController: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if template normal is zero", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          initializePlatformAdapter({zeroTemplateAdapterNormal: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if template emode is zero", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          initializePlatformAdapter({zeroTemplateAdapterEMode: true})
        ).revertedWith("TC-1 zero address");
      });
    });
  });

  describe("getConversionPlan", () => {
    let controller: Controller;
    before(async function () {
      controller = await TetuConverterApp.createController(deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
    });
    interface IGetConversionPlanBadPaths {
      zeroCollateralAsset?: boolean;
      zeroBorrowAsset?: boolean;
      zeroCountBlocks?: boolean;
      zeroCollateralAmount?: boolean;
      incorrectHealthFactor2?: number;
      makeCollateralAssetPaused?: boolean;
      makeBorrowAssetPaused?: boolean;
      makeCollateralAssetFrozen?: boolean;
      makeBorrowAssetFrozen?: boolean;
      /* Set supply cap equal almost to current total supply value */
      setMinSupplyCap?: boolean;
      /* Set borrow cap equal almost to current total borrow value */
      setMinBorrowCap?: boolean;
      setZeroSupplyCap?: boolean;
      setZeroBorrowCap?: boolean;
    }

    interface IPreparePlanResults {
      plan: IConversionPlan;
      healthFactor2: number;
      priceCollateral: BigNumber;
      priceBorrow: BigNumber;
      aavePool: IAavePool;
      borrowReserveData: IAaveReserveData;
      collateralReserveData: IAaveReserveData;
      collateralAssetData: IAave3ReserveInfo;
      borrowAssetData: IAave3ReserveInfo;
      before: IAave3StateInfo;
      blockTimeStamp: number;
    }

    async function preparePlan(
      collateralAsset: string,
      collateralAmount: BigNumber,
      borrowAsset: string,
      countBlocks: number = 10,
      badPathsParams?: IGetConversionPlanBadPaths
    ) : Promise<IPreparePlanResults> {
      const h = new Aave3Helper(deployer);
      const aavePool = await Aave3Helper.getAavePool(deployer);
      const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
        deployer,
        controller.address,
        aavePool.address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address
      );
      const healthFactor2 = badPathsParams?.incorrectHealthFactor2 || 200;

      const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);
      const block = await hre.ethers.provider.getBlock("latest");
      const before = await getAave3StateInfo(deployer, aavePool, dp, collateralAsset, borrowAsset);

      if (badPathsParams?.makeBorrowAssetPaused) {
        await Aave3ChangePricesUtils.setReservePaused(deployer, borrowAsset);
      }
      if (badPathsParams?.makeCollateralAssetPaused) {
        await Aave3ChangePricesUtils.setReservePaused(deployer, collateralAsset);
      }
      if (badPathsParams?.makeBorrowAssetFrozen) {
        await Aave3ChangePricesUtils.setReserveFreeze(deployer, borrowAsset);
      }
      if (badPathsParams?.makeCollateralAssetFrozen) {
        await Aave3ChangePricesUtils.setReserveFreeze(deployer, collateralAsset);
      }
      if (badPathsParams?.setMinSupplyCap) {
        await Aave3ChangePricesUtils.setSupplyCap(deployer, collateralAsset);
      }
      if (badPathsParams?.setMinBorrowCap) {
        await Aave3ChangePricesUtils.setBorrowCap(deployer, borrowAsset);
      }
      if (badPathsParams?.setZeroSupplyCap) {
        await Aave3ChangePricesUtils.setSupplyCap(deployer, collateralAsset, BigNumber.from(0));
      }
      if (badPathsParams?.setZeroBorrowCap) {
        await Aave3ChangePricesUtils.setBorrowCap(deployer, borrowAsset, BigNumber.from(0));
      }
      // get conversion plan
      const plan: IConversionPlan = await aavePlatformAdapter.getConversionPlan(
        badPathsParams?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
        badPathsParams?.zeroCollateralAmount ? 0 : collateralAmount,
        badPathsParams?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
        healthFactor2,
        badPathsParams?.zeroCountBlocks ? 0 : countBlocks,
      );

      const prices = await (await Aave3Helper.getAavePriceOracle(deployer)).getAssetsPrices([collateralAsset, borrowAsset]);
      return {
        plan,
        aavePool,
        borrowAssetData: await h.getReserveInfo(deployer, aavePool, dp, borrowAsset),
        collateralAssetData: await h.getReserveInfo(deployer, aavePool, dp, collateralAsset),
        borrowReserveData: await dp.getReserveData(borrowAsset),
        collateralReserveData: await dp.getReserveData(collateralAsset),
        healthFactor2,
        priceCollateral: prices[0],
        priceBorrow: prices[1],
        before,
        blockTimeStamp: block.timestamp
      }
    }

    async function makeGetConversionPlanTest(
      collateralAsset: string,
      collateralAmount: BigNumber,
      borrowAsset: string,
      highEfficientModeEnabled: boolean,
      isolationModeEnabled: boolean,
      countBlocks: number = 10,
      badPathsParams?: IGetConversionPlanBadPaths
    ) : Promise<{sret: string, sexpected: string}> {
      const d = await preparePlan(
        collateralAsset,
        collateralAmount,
        borrowAsset,
        countBlocks,
        badPathsParams
      );
      console.log("Plan", d.plan);

      let borrowAmount = AprUtils.getBorrowAmount(
        collateralAmount,
        d.healthFactor2,
        d.plan.liquidationThreshold18,
        d.priceCollateral,
        d.priceBorrow,
        d.collateralAssetData.data.decimals,
        d.borrowAssetData.data.decimals
      );

      if (borrowAmount.gt(d.plan.maxAmountToBorrow)) {
        borrowAmount = d.plan.maxAmountToBorrow;
      }

      const amountCollateralInBorrowAsset36 =  convertUnits(collateralAmount,
        d.priceCollateral,
        d.collateralAssetData.data.decimals,
        d.priceBorrow,
        36
      );

      // calculate expected supply and borrow values
      const predictedSupplyIncomeInBorrowAssetRay = await AprAave3.predictSupplyIncomeRays(deployer,
        d.aavePool,
        collateralAsset,
        collateralAmount,
        borrowAsset,
        countBlocks,
        COUNT_BLOCKS_PER_DAY,
        d.collateralReserveData,
        d.before,
        d.blockTimeStamp,
      );

      const predictedBorrowCostInBorrowAssetRay = await AprAave3.predictBorrowAprRays(deployer,
        d.aavePool,
        collateralAsset,
        borrowAsset,
        borrowAmount,
        countBlocks,
        COUNT_BLOCKS_PER_DAY,
        d.borrowReserveData,
        d.before,
        d.blockTimeStamp,
      );

      const sret = [
        d.plan.borrowCost36,
        d.plan.supplyIncomeInBorrowAsset36,
        d.plan.rewardsAmountInBorrowAsset36,
        d.plan.ltv18,
        d.plan.liquidationThreshold18,
        d.plan.maxAmountToBorrow,
        d.plan.maxAmountToSupply,
        // ensure that high efficiency mode is not available
        highEfficientModeEnabled
          ? d.collateralAssetData.data.emodeCategory !== 0
            && d.borrowAssetData.data.emodeCategory === d.collateralAssetData.data.emodeCategory
          : d.collateralAssetData.data.emodeCategory !== d.borrowAssetData.data.emodeCategory,

        !d.plan.borrowCost36.eq(0),
        !d.plan.supplyIncomeInBorrowAsset36.eq(0),
        d.plan.amountToBorrow,

        // we lost precision a bit in USDC : WBTC, so almost equal only
        areAlmostEqual(d.plan.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36)
      ].map(x => BalanceUtils.toString(x)) .join("\n");

      const expectedMaxAmountToBorrow = await Aave3Utils.getMaxAmountToBorrow(d.borrowAssetData, d.collateralAssetData);
      const expectedMaxAmountToSupply = await Aave3Utils.getMaxAmountToSupply(deployer, d.collateralAssetData);

      const sexpected = [
        predictedBorrowCostInBorrowAssetRay,
        predictedSupplyIncomeInBorrowAssetRay,
        0,

        BigNumber.from(highEfficientModeEnabled
          ? d.collateralAssetData.category?.ltv
          : d.collateralAssetData.data.ltv
        )
          .mul(Misc.WEI)
          .div(getBigNumberFrom(1, 4)),
        BigNumber.from(highEfficientModeEnabled
          ? d.collateralAssetData.category?.liquidationThreshold
          : d.collateralAssetData.data.liquidationThreshold
        )
          .mul(Misc.WEI)
          .div(getBigNumberFrom(1, 4)),
        expectedMaxAmountToBorrow,
        expectedMaxAmountToSupply,
        true,

        true, // borrow APR is not 0
        true, // supply APR is not 0

        borrowAmount,
        true
      ].map(x => BalanceUtils.toString(x)) .join("\n");

      return {sret, sexpected};
    }

    describe("Good paths", () => {
      describe("DAI : matic", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.WMATIC;
          const collateralAmount = getBigNumberFrom(1000, 18);

          const r = await makeGetConversionPlanTest(
            collateralAsset,
            collateralAmount,
            borrowAsset,
            false,
            false
          );

          expect(r.sret).eq(r.sexpected);
        });
      });
      describe("DAI : USDC", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const countBlocks = 1;
          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.USDC;
          const collateralAmount = getBigNumberFrom(100, 18);

          const r = await makeGetConversionPlanTest(
            collateralAsset,
            collateralAmount,
            borrowAsset,
            true,
            false,
            countBlocks
          );

          expect(r.sret).eq(r.sexpected);
        });
      });
      describe("USDC : WBTC", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const countBlocks = 1;
          const collateralAsset = MaticAddresses.USDC;
          const borrowAsset = MaticAddresses.WBTC;
          const collateralAmount = getBigNumberFrom(1000, 6);

          const r = await makeGetConversionPlanTest(
            collateralAsset,
            collateralAmount,
            borrowAsset,
            false,
            false,
            countBlocks
          );

          expect(r.sret).eq(r.sexpected);
        });
      });
      describe("USDC : USDT", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const countBlocks = 1;
          const collateralAsset = MaticAddresses.USDC;
          const borrowAsset = MaticAddresses.USDT;
          const collateralAmount = BigNumber.from("1999909100")

          const r = await makeGetConversionPlanTest(
            collateralAsset,
            collateralAmount,
            borrowAsset,
            true,
            false,
            countBlocks
          );

          expect(r.sret).eq(r.sexpected);
        });
      });
      describe("Isolation mode is enabled for collateral, borrow token is borrowable in isolation mode", () => {
        describe("STASIS EURS-2 : Tether USD", () => {
          it("should return expected values", async () =>{
            if (!await isPolygonForkInUse()) return;

            const collateralAsset = MaticAddresses.EURS;
            const borrowAsset = MaticAddresses.USDT;
            const collateralAmount = getBigNumberFrom(1000, 2); // 2000 Euro

            const r = await makeGetConversionPlanTest(
              collateralAsset,
              collateralAmount,
              borrowAsset,
              true,
              false
            );

            expect(r.sret).eq(r.sexpected);
          });
        });
      });
      describe("Two assets from category 1", () => {
        it("should return values for high efficient mode", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.USDC;
          const collateralAmount = getBigNumberFrom(1000, 18); // 1000 Dai

          const r = await makeGetConversionPlanTest(
            collateralAsset,
            collateralAmount,
            borrowAsset,
            true,
            false
          );

          expect(r.sret).eq(r.sexpected);
        });
      });
      describe("Try to use huge collateral amount", () => {
        it("should return borrow amount equal to max available amount", async () => {
          if (!await isPolygonForkInUse()) return;

          const r = await preparePlan(MaticAddresses.DAI, parseUnits("1", 28), MaticAddresses.WMATIC);
          expect(r.plan.amountToBorrow).eq(r.plan.maxAmountToBorrow);
        });
      });
      describe("Check gas limit", () => {
        it("should return expected values @skip-on-coverage", async () => {
          if (!await isPolygonForkInUse()) return;
          const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
            deployer,
            controller.address,
            MaticAddresses.AAVE_V3_POOL,
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address
          );

          const gasUsed = await aavePlatformAdapter.estimateGas.getConversionPlan(
            MaticAddresses.DAI,
            parseUnits("1", 18),
            MaticAddresses.USDC,
            200,
            1
          );
          console.log("Aave3PlatformAdapter.getConversionPlan.gas", gasUsed.toString());
          controlGasLimitsEx(gasUsed, GAS_LIMIT_AAVE_3_GET_CONVERSION_PLAN, (u, t) => {
            expect(u).to.be.below(t);
          });
        });
      });
    });
    describe("Bad paths", () => {
      async function tryGetConversionPlan(
        badPathsParams: IGetConversionPlanBadPaths,
        collateralAsset: string = MaticAddresses.DAI,
        borrowAsset: string = MaticAddresses.WMATIC,
        collateralAmount: string = "1000"
      ) : Promise<IConversionPlan> {
        return (await preparePlan(
          collateralAsset,
          parseUnits(collateralAmount),
          borrowAsset,
          10,
          badPathsParams
        )).plan;
      }
      describe("incorrect input params", () => {
        describe("collateral token is zero", () => {
          it("should revert", async () => {
            if (!await isPolygonForkInUse()) return;

            await expect(
              tryGetConversionPlan({ zeroCollateralAsset: true })
            ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
          });
        });
        describe("borrow token is zero", () => {
          it("should revert", async () => {
            if (!await isPolygonForkInUse()) return;

            await expect(
              tryGetConversionPlan({ zeroBorrowAsset: true })
            ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
          });
        });
        describe("healthFactor2_ is less than min allowed", () => {
          it("should revert", async () => {
            if (!await isPolygonForkInUse()) return;

            await expect(
              tryGetConversionPlan({ incorrectHealthFactor2: 100 })
            ).revertedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
          });
        });
        describe("countBlocks_ is zero", () => {
          it("should revert", async () => {
            if (!await isPolygonForkInUse()) return;

            await expect(
              tryGetConversionPlan({ zeroCountBlocks: true })
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
        describe("collateralAmount_ is zero", () => {
          it("should revert", async () => {
            if (!await isPolygonForkInUse()) return;

            await expect(
              tryGetConversionPlan({ zeroCollateralAmount: true })
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
      });

      /* We cannot make a reserve inactive if it has active suppliers */
      describe.skip("inactive", () => {
        describe("collateral token is inactive", () => {
          it("should revert", async () =>{
            if (!await isPolygonForkInUse()) return;
            expect.fail("TODO");
          });
        });
        describe("borrow token is inactive", () => {
          it("should revert", async () => {
            if (!await isPolygonForkInUse()) return;
            expect.fail("TODO");
          });
        });
      });

      describe("paused", () => {
        it("should fail if collateral token is paused", async () => {
          if (!await isPolygonForkInUse()) return;
          expect((await tryGetConversionPlan({ makeCollateralAssetPaused: true })).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if borrow token is paused", async () => {
          if (!await isPolygonForkInUse()) return;
          expect((await tryGetConversionPlan({ makeBorrowAssetPaused: true })).converter).eq(Misc.ZERO_ADDRESS);
        });
      });

      describe("frozen", () => {
        it("should fail if collateral token is frozen", async () => {
          if (!await isPolygonForkInUse()) return;
          expect((await tryGetConversionPlan({ makeCollateralAssetFrozen: true })).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if borrow token is frozen", async () => {
          if (!await isPolygonForkInUse()) return;
          expect((await tryGetConversionPlan({ makeBorrowAssetFrozen: true })).converter).eq(Misc.ZERO_ADDRESS);
        });
      });

      describe("Not usable", () => {
        it("should fail if borrow asset is not borrowable", async () => {
          if (!await isPolygonForkInUse()) return;
          // AaveToken has borrowing = FALSE
          expect((await tryGetConversionPlan({}, MaticAddresses.DAI, MaticAddresses.AaveToken)).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if collateral asset is not usable as collateral", async () => {
          if (!await isPolygonForkInUse()) return;
          // agEUR has liquidation threshold = 0, it means, it cannot be used as collateral
          expect((await tryGetConversionPlan({}, MaticAddresses.agEUR)).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if isolation mode is enabled for collateral, borrow token is not borrowable in isolation mode", async () => {
          if (!await isPolygonForkInUse()) return;
          // EURS has not zero isolationModeTotalDebtm, SUSHI has "borrowable in isolation mode" = FALSE
          expect((await tryGetConversionPlan({}, MaticAddresses.EURS, MaticAddresses.SUSHI)).converter).eq(Misc.ZERO_ADDRESS);
        });
      });

      describe("Caps", () => {
        it("should return expected maxAmountToSupply when try to supply more than allowed by supply cap", async () => {
          if (!await isPolygonForkInUse()) return;
          const plan = await tryGetConversionPlan(
            {setMinSupplyCap: true},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            "12345"
          );
          expect(plan.maxAmountToSupply.lt(parseUnits("12345"))).eq(true);
        });
        it("should return expected maxAmountToSupply=max(uint) if supply cap is zero (supplyCap == 0 => no cap)", async () => {
          if (!await isPolygonForkInUse()) return;
          const plan = await tryGetConversionPlan(
            {setZeroSupplyCap: true},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            "12345"
          );
          console.log(plan.maxAmountToSupply);
          expect(plan.maxAmountToSupply.eq(Misc.MAX_UINT)).eq(true);
        });
        it("should return expected borrowAmount when try to borrow more than allowed by borrow cap", async () => {
          if (!await isPolygonForkInUse()) return;
          const planNoBorrowCap = await tryGetConversionPlan(
            {},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            "12345"
          );
          const plan = await tryGetConversionPlan(
            {setMinBorrowCap: true},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            "12345"
          );
          const ret = [
            plan.amountToBorrow.eq(plan.maxAmountToBorrow),
            plan.amountToBorrow.lt(planNoBorrowCap.maxAmountToBorrow),
            planNoBorrowCap.amountToBorrow.lt(planNoBorrowCap.maxAmountToBorrow)
          ].join("\n");
          const expected = [true, true, true].join("\n");
          expect(ret).eq(expected);
        });
        it("should return expected borrowAmount when borrow cap is zero", async () => {
          if (!await isPolygonForkInUse()) return;
          const plan = await tryGetConversionPlan(
            {setZeroBorrowCap: true},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            "12345"
          );
          const dataProvider = await Aave3Helper.getAaveProtocolDataProvider(deployer);
          const borrowData = await dataProvider.getReserveData(MaticAddresses.USDC);
          // by default, maxAmountToBorrow = totalAToken - totalStableDebt - totalVariableDebt;
          const expectedMaxAmountToBorrow = borrowData.totalAToken
            .sub(borrowData.totalStableDebt)
            .sub(borrowData.totalVariableDebt);
          console.log(plan.maxAmountToBorrow.toString(), expectedMaxAmountToBorrow.toString());
          expect(plan.maxAmountToBorrow.eq(expectedMaxAmountToBorrow)).eq(true);
        });
      });
    });
  });

  describe("getBorrowRateAfterBorrow", () => {
    describe("Good paths", () => {
      async function makeGetBorrowRateAfterBorrowTest(
        collateralAsset: string,
        borrowAsset: string,
        collateralHolders: string[],
        part10000: number
      ) : Promise<{br: BigNumber, brPredicted: BigNumber}> {
        const templateAdapterEModeStub = ethers.Wallet.createRandom();
        const templateAdapterNormalStub = ethers.Wallet.createRandom();
        const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);
        const aavePool = await Aave3Helper.getAavePool(deployer);

        return PredictBrUsesCase.makeTest(
          deployer,
          new Aave3PlatformActor(
            dp,
            aavePool,
            collateralAsset,
            borrowAsset
          ),
          async controller => AdaptersHelper.createAave3PlatformAdapter(
            deployer,
            controller.address,
            aavePool.address,
            templateAdapterNormalStub.address,
            templateAdapterEModeStub.address
          ),
          collateralAsset,
          borrowAsset,
          collateralHolders,
          part10000
        );
       }

      describe("small amount", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.USDC;
          const collateralHolders = [
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.HOLDER_DAI_2,
            MaticAddresses.HOLDER_DAI_3,
            MaticAddresses.HOLDER_DAI_4,
            MaticAddresses.HOLDER_DAI_5,
            MaticAddresses.HOLDER_DAI_6,
          ];
          const part10000 = 1;

          const r = await makeGetBorrowRateAfterBorrowTest(collateralAsset, borrowAsset, collateralHolders, part10000);

          const ret = areAlmostEqual(r.br, r.brPredicted, 5);
          expect(ret).eq(true);
        });
      });

      describe("Huge amount", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.USDC;
          const collateralHolders = [
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.HOLDER_DAI_2,
            MaticAddresses.HOLDER_DAI_3,
            MaticAddresses.HOLDER_DAI_4,
            MaticAddresses.HOLDER_DAI_5,
            MaticAddresses.HOLDER_DAI_6,
          ];
          const part10000 = 1000;

          const r = await makeGetBorrowRateAfterBorrowTest(collateralAsset, borrowAsset, collateralHolders, part10000);

          const ret = areAlmostEqual(r.br, r.brPredicted, 5);
          expect(ret).eq(true);
        });
      });
    });

  });

  describe("initializePoolAdapter", () => {
    let controller: Controller;
    before(async function () {
      controller = await TetuConverterApp.createController(deployer);
    });
    interface IInitializePoolAdapterBadPaths {
      useWrongConverter?: boolean;
      wrongCallerOfInitializePoolAdapter?: boolean;
    }
    async function makeInitializePoolAdapterTest(
      useEMode: boolean,
      badParams?: IInitializePoolAdapterBadPaths
    ) : Promise<{ret: string, expected: string}> {
      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = (await MocksHelper.createMockedCToken(deployer)).address;
      const borrowAsset = (await MocksHelper.createMockedCToken(deployer)).address;

      const borrowManager = BorrowManager__factory.connect(
        await controller.borrowManager(),
        deployer
      );

      const converterNormal = await AdaptersHelper.createAave3PoolAdapter(deployer);
      const converterEMode = await AdaptersHelper.createAave3PoolAdapterEMode(deployer);

      const aavePool = await Aave3Helper.getAavePool(deployer);
      const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
        deployer,
        controller.address,
        aavePool.address,
        converterNormal.address,
        converterEMode.address
      );

      const poolAdapter = useEMode
        ? await AdaptersHelper.createAave3PoolAdapterEMode(deployer)
        : await AdaptersHelper.createAave3PoolAdapter(deployer);
      const aavePlatformAdapterAsBorrowManager = Aave3PlatformAdapter__factory.connect(
        aavePlatformAdapter.address,
        badParams?.wrongCallerOfInitializePoolAdapter
          ? await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
          : await DeployerUtils.startImpersonate(borrowManager.address)
      );

      await aavePlatformAdapterAsBorrowManager.initializePoolAdapter(
        badParams?.useWrongConverter
          ? ethers.Wallet.createRandom().address
          : useEMode
            ? converterEMode.address
            : converterNormal.address,
        poolAdapter.address,
        user,
        collateralAsset,
        borrowAsset
      );

      const poolAdapterConfigAfter = await poolAdapter.getConfig();
      const ret = [
        poolAdapterConfigAfter.origin,
        poolAdapterConfigAfter.outUser,
        poolAdapterConfigAfter.outCollateralAsset,
        poolAdapterConfigAfter.outBorrowAsset
      ].join();
      const expected = [
        useEMode ? converterEMode.address : converterNormal.address,
        user,
        collateralAsset,
        borrowAsset
      ].join();
      return {ret, expected};
    }

    describe("Good paths", () => {
      it("Normal mode: initialized pool adapter should has expected values", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await makeInitializePoolAdapterTest(false);
        expect(r.ret).eq(r.expected);
      });
      it("EMode mode: initialized pool adapter should has expected values", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await makeInitializePoolAdapterTest(false);
        expect(r.ret).eq(r.expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert if converter address is not registered", async () => {
        if (!await isPolygonForkInUse()) return;

        await expect(
          makeInitializePoolAdapterTest(
            false,
            {useWrongConverter: true}
          )
        ).revertedWith("TC-25 converter not found"); // CONVERTER_NOT_FOUND
      });
      it("should revert if it's called by not borrow-manager", async () => {
        if (!await isPolygonForkInUse()) return;

        await expect(
          makeInitializePoolAdapterTest(
            false,
            {wrongCallerOfInitializePoolAdapter: true}
          )
        ).revertedWith("TC-45 borrow manager only"); // BORROW_MANAGER_ONLY
      });
    });
  });

  describe("events", () => {
    it("should emit expected values", async () => {
      if (!await isPolygonForkInUse()) return;

      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = (await MocksHelper.createMockedCToken(deployer)).address;
      const borrowAsset = (await MocksHelper.createMockedCToken(deployer)).address;

      const controller = await TetuConverterApp.createController(deployer);
      const converterNormal = await AdaptersHelper.createAave3PoolAdapter(deployer);
      const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
        deployer,
        controller.address,
        MaticAddresses.AAVE_V3_POOL,
        converterNormal.address,
        ethers.Wallet.createRandom().address
      );

      const poolAdapter = await AdaptersHelper.createAave3PoolAdapter(deployer);
      const aavePlatformAdapterAsBorrowManager = Aave3PlatformAdapter__factory.connect(
        aavePlatformAdapter.address,
        await DeployerUtils.startImpersonate(await controller.borrowManager())
      );

      await expect(
        aavePlatformAdapterAsBorrowManager.initializePoolAdapter(
          converterNormal.address,
          poolAdapter.address,
          user,
          collateralAsset,
          borrowAsset
        )
      ).to.emit(aavePlatformAdapter, "OnPoolAdapterInitialized").withArgs(
        converterNormal.address,
        poolAdapter.address,
        user,
        collateralAsset,
        borrowAsset
      );
    });
  });


//endregion Unit tests

});