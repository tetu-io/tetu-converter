import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  Aave3PlatformAdapter,
  Aave3PlatformAdapter__factory, BorrowManager__factory, ConverterController, IAavePool,
  IAaveProtocolDataProvider, IERC20Metadata__factory
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {Aave3Helper, IAave3ReserveInfo} from "../../../scripts/integration/aave3/Aave3Helper";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {AprUtils, COUNT_BLOCKS_PER_DAY} from "../../baseUT/utils/aprUtils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IPlatformActor, PredictBrUsesCase} from "../../baseUT/uses-cases/PredictBrUsesCase";
import {AprAave3, getAave3StateInfo, IAave3StateInfo, IAaveReserveData} from "../../baseUT/protocols/aave3/aprAave3";
import {Misc} from "../../../scripts/utils/Misc";
import {convertUnits} from "../../baseUT/protocols/shared/aprUtils";
import {Aave3Utils} from "../../baseUT/protocols/aave3/Aave3Utils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {IConversionPlan} from "../../baseUT/protocols/shared/aprDataTypes";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {Aave3ChangePricesUtils} from "../../baseUT/protocols/aave3/Aave3ChangePricesUtils";
import {
  controlGasLimitsEx2,
  HardhatUtils,
  POLYGON_NETWORK_ID
} from "../../../scripts/utils/HardhatUtils";
import {GAS_LIMIT, GAS_LIMIT_AAVE_3_GET_CONVERSION_PLAN} from "../../baseUT/GasLimit";
import {AppConstants} from "../../baseUT/AppConstants";
import {MaticCore} from "../../baseUT/cores/maticCore";
import {ICoreAave3} from "../../baseUT/protocols/aave3/Aave3DataTypes";

describe("Aave3PlatformAdapterTest", () => {
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
      this.h = new Aave3Helper(deployer, MaticAddresses.AAVE_V3_POOL);
      this.dp = dataProvider;
      this.pool = pool;
      this.collateralAsset = collateralAsset;
      this.borrowAsset = borrowAsset;
    }

    async getAvailableLiquidity(): Promise<BigNumber> {
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
      await this.pool.borrow(this.borrowAsset, borrowAmount, 2, 0, deployer.address, {gasLimit: GAS_LIMIT});

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
    ): Promise<{ data: IContractsSet, platformAdapter: Aave3PlatformAdapter }> {
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
        data.templateAdapterEMode,
        await controller.borrowManager()
      );
      return {data, platformAdapter};
    }

    describe("Good paths", () => {
      it("should return expected values", async () => {
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
        await expect(
          initializePlatformAdapter({zeroAavePool: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if controller is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroController: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if template normal is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroTemplateAdapterNormal: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if template emode is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroTemplateAdapterEMode: true})
        ).revertedWith("TC-1 zero address");
      });
    });
  });

  describe("getConversionPlan", () => {
    let controller: ConverterController;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      controller = await TetuConverterApp.createController(deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IGetConversionPlanBadPaths {
      zeroCollateralAsset?: boolean;
      zeroBorrowAsset?: boolean;
      zeroCountBlocks?: boolean;
      zeroAmountIn?: boolean;
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
      frozen?: boolean;
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
      core: ICoreAave3,
      collateralAsset: string,
      amountIn: BigNumber,
      borrowAsset: string,
      countBlocks: number = 10,
      badPathsParams?: IGetConversionPlanBadPaths,
      entryData?: string
    ): Promise<IPreparePlanResults> {
      const h = new Aave3Helper(deployer, MaticAddresses.AAVE_V3_POOL);
      const aavePool = await Aave3Helper.getAavePool(deployer, MaticAddresses.AAVE_V3_POOL);
      const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
        deployer,
        controller.address,
        aavePool.address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address
      );
      const healthFactor2 = badPathsParams?.incorrectHealthFactor2 || 200;

      const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer, MaticAddresses.AAVE_V3_POOL);
      const block = await hre.ethers.provider.getBlock("latest");
      const before = await getAave3StateInfo(deployer, aavePool, dp, collateralAsset, borrowAsset);

      if (badPathsParams?.makeBorrowAssetPaused) {
        await Aave3ChangePricesUtils.setReservePaused(deployer, core, borrowAsset);
      }
      if (badPathsParams?.makeCollateralAssetPaused) {
        await Aave3ChangePricesUtils.setReservePaused(deployer, core, collateralAsset);
      }
      if (badPathsParams?.makeBorrowAssetFrozen) {
        await Aave3ChangePricesUtils.setReserveFreeze(deployer, core, borrowAsset);
      }
      if (badPathsParams?.makeCollateralAssetFrozen) {
        await Aave3ChangePricesUtils.setReserveFreeze(deployer, core, collateralAsset);
      }
      if (badPathsParams?.setMinSupplyCap) {
        await Aave3ChangePricesUtils.setSupplyCap(deployer, core, collateralAsset);
      }
      if (badPathsParams?.setMinBorrowCap) {
        await Aave3ChangePricesUtils.setBorrowCap(deployer, core, borrowAsset);
      }
      if (badPathsParams?.setZeroSupplyCap) {
        await Aave3ChangePricesUtils.setSupplyCap(deployer, core, collateralAsset, BigNumber.from(0));
      }
      if (badPathsParams?.setZeroBorrowCap) {
        await Aave3ChangePricesUtils.setBorrowCap(deployer, core, borrowAsset, BigNumber.from(0));
      }
      if (badPathsParams?.frozen) {
        await aavePlatformAdapter.setFrozen(true);
      }
      // get conversion plan
      const plan: IConversionPlan = await aavePlatformAdapter.getConversionPlan(
        {
          collateralAsset: badPathsParams?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
          amountIn: badPathsParams?.zeroAmountIn ? 0 : amountIn,
          borrowAsset: badPathsParams?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
          countBlocks: badPathsParams?.zeroCountBlocks ? 0 : countBlocks,
          entryData: entryData || "0x",
        },
        healthFactor2,
        {gasLimit: GAS_LIMIT}
      );

      const prices = await (await Aave3Helper.getAavePriceOracle(deployer, MaticAddresses.AAVE_V3_POOL)).getAssetsPrices([collateralAsset, borrowAsset]);
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
      core: ICoreAave3,
      collateralAsset: string,
      collateralAmount: BigNumber,
      borrowAsset: string,
      highEfficientModeEnabled: boolean,
      isolationModeEnabled: boolean,
      countBlocks: number = 10,
      badPathsParams?: IGetConversionPlanBadPaths,
      entryData?: string,
      expectEmptyPlan: boolean = false
    ): Promise<{ sret: string, sexpected: string }> {
      const d = await preparePlan(
        core,
        collateralAsset,
        collateralAmount,
        borrowAsset,
        countBlocks,
        badPathsParams,
        entryData
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

      const amountCollateralInBorrowAsset36 = convertUnits(collateralAmount,
        d.priceCollateral,
        d.collateralAssetData.data.decimals,
        d.priceBorrow,
        36
      );

      // calculate expected supply and borrow values
      const predictedSupplyIncomeInBorrowAssetRay = await AprAave3.predictSupplyIncomeRays(
        deployer,
        core,
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

      const predictedBorrowCostInBorrowAssetRay = await AprAave3.predictBorrowAprRays(
        deployer,
        core,
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

        !d.plan.borrowCost36.eq(0),
        !d.plan.supplyIncomeInBorrowAsset36.eq(0),

        d.plan.amountToBorrow,
        d.plan.collateralAmount,

        // we lost precision a bit in USDC : WBTC, so almost equal only
        areAlmostEqual(d.plan.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36),

        // ensure that high efficiency mode is not available
        highEfficientModeEnabled
          ? d.collateralAssetData.data.emodeCategory !== 0
          && d.borrowAssetData.data.emodeCategory === d.collateralAssetData.data.emodeCategory
          : d.collateralAssetData.data.emodeCategory !== d.borrowAssetData.data.emodeCategory,
      ].map(x => BalanceUtils.toString(x)).join("\n");

      const expectedMaxAmountToBorrow = await Aave3Utils.getMaxAmountToBorrow(d.borrowAssetData, d.collateralAssetData);
      const expectedMaxAmountToSupply = await Aave3Utils.getMaxAmountToSupply(deployer, d.collateralAssetData);

      const emptyPlan = expectEmptyPlan
        && !d.collateralAssetData.data.debtCeiling.eq(0)
        && d.collateralAssetData.data.debtCeiling.lt(d.collateralAssetData.data.isolationModeTotalDebt);

      // if vars.rcDebtCeiling < vars.rc.isolationModeTotalDebt in isolation mode,
      // the borrow is not possible. Currently, there is such situation with EURO. It can be changed later.
      // The test handles both cases (it's not good, we need two different tests, but it's too hard to reproduce
      // required situations in test)
      const sexpected = (emptyPlan
          ? [0, 0, 0, 0, 0, 0, 0, false, false, 0, 0, false, true]
          : [
            predictedBorrowCostInBorrowAssetRay,
            predictedSupplyIncomeInBorrowAssetRay,
            0,

            // ltv18
            BigNumber.from(
              highEfficientModeEnabled
                ? d.collateralAssetData.category?.ltv
                : d.collateralAssetData.data.ltv
            ).mul(Misc.WEI).div(getBigNumberFrom(1, 4)),

            // liquidationThreshold18
            BigNumber.from(
              highEfficientModeEnabled
                ? d.collateralAssetData.category?.liquidationThreshold
                : d.collateralAssetData.data.liquidationThreshold
            ).mul(Misc.WEI).div(getBigNumberFrom(1, 4)),

            expectedMaxAmountToBorrow,
            expectedMaxAmountToSupply,

            true, // borrow APR is not 0
            true, // supply APR is not 0

            borrowAmount,
            collateralAmount,

            true,
            true,
          ]
      ).map(x => BalanceUtils.toString(x)).join("\n");

      return {sret, sexpected};
    }

    describe("Good paths", () => {
      describe("DAI : matic", () => {
        it("should return expected values", async () => {

          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.WMATIC;
          const collateralAmount = getBigNumberFrom(1000, 18);
          const core = MaticCore.getCoreAave3();

          const r = await makeGetConversionPlanTest(
            core,
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
          const countBlocks = 1;
          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.USDC;
          const collateralAmount = getBigNumberFrom(100, 18);

          const r = await makeGetConversionPlanTest(
            MaticCore.getCoreAave3(),
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
          const countBlocks = 1;
          const collateralAsset = MaticAddresses.USDC;
          const borrowAsset = MaticAddresses.WBTC;
          const collateralAmount = getBigNumberFrom(1000, 6);

          const r = await makeGetConversionPlanTest(
            MaticCore.getCoreAave3(),
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
          const countBlocks = 1;
          const collateralAsset = MaticAddresses.USDC;
          const borrowAsset = MaticAddresses.USDT;
          const collateralAmount = BigNumber.from("1999909100")

          const r = await makeGetConversionPlanTest(
            MaticCore.getCoreAave3(),
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
        /**
         * Currently vars.rcDebtCeiling < vars.rc.isolationModeTotalDebt, so new borrows are not possible
         */
        describe("STASIS EURS-2 : Tether USD", () => {
          it("should return expected values", async () => {
            const collateralAsset = MaticAddresses.EURS;
            const borrowAsset = MaticAddresses.USDT;
            const collateralAmount = parseUnits("1000", 2); // 1000 Euro

            const r = await makeGetConversionPlanTest(
              MaticCore.getCoreAave3(),
              collateralAsset,
              collateralAmount,
              borrowAsset,
              true,
              false,
              10,
              undefined,
              "0x",

              // Currently vars.rcDebtCeiling < vars.rc.isolationModeTotalDebt, so new borrows are not possible
              // we expect to receive empty plan. It depends on block. The situation can change in the future
              // and it will be necessary to reproduce the situation {vars.rcDebtCeiling < vars.rc.isolationModeTotalDebt}
              // manually. SO this is potentially blinking test. But we need this test to improve the coverage.
              true
            );

            expect(r.sret).eq(r.sexpected);
          });
        });
      });
      describe("Two assets from category 1", () => {
        it("should return values for high efficient mode", async () => {
          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.USDC;
          const collateralAmount = parseUnits("1000", 18); // 1000 Dai

          const r = await makeGetConversionPlanTest(
            MaticCore.getCoreAave3(),
            collateralAsset,
            collateralAmount,
            borrowAsset,
            true,
            false
          );

          expect(r.sret).eq(r.sexpected);
        });
      });
      describe("Frozen", () => {
        it("should return no plan", async () => {
          const r = await preparePlan(
            MaticCore.getCoreAave3(),
            MaticAddresses.DAI,
            parseUnits("1", 18),
            MaticAddresses.WMATIC,
            10,
            {
              frozen: true
            }
          );
          expect(r.plan.converter).eq(Misc.ZERO_ADDRESS);
        });
      });
      describe("Entry kinds", () => {
        describe("Use ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0", () => {
          it("should return expected collateral and borrow amounts", async () => {
            const collateralAsset = MaticAddresses.DAI;
            const borrowAsset = MaticAddresses.WMATIC;
            const collateralAmount = parseUnits("1000", 18);

            const r = await preparePlan(
              MaticCore.getCoreAave3(),
              collateralAsset,
              collateralAmount,
              borrowAsset,
              10,
              undefined,
              defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
            );

            const borrowAmount = AprUtils.getBorrowAmount(
              collateralAmount,
              r.healthFactor2,
              r.plan.liquidationThreshold18,
              r.priceCollateral,
              r.priceBorrow,
              r.collateralAssetData.data.decimals,
              r.borrowAssetData.data.decimals
            );

            const amountCollateralInBorrowAsset36 = convertUnits(r.plan.collateralAmount,
              r.priceCollateral,
              r.collateralAssetData.data.decimals,
              r.priceBorrow,
              36
            );

            const ret = [
              r.plan.collateralAmount,
              r.plan.amountToBorrow,
              areAlmostEqual(r.plan.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36)
            ].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [collateralAmount, borrowAmount, true].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Use ENTRY_KIND_EXACT_PROPORTION_1", () => {
          it("should split source amount on the parts with almost same cost", async () => {
            const collateralAsset = MaticAddresses.DAI;
            const borrowAsset = MaticAddresses.WMATIC;
            const collateralAmount = parseUnits("1000", 18);

            const r = await preparePlan(
              MaticCore.getCoreAave3(),
              collateralAsset,
              collateralAmount,
              borrowAsset,
              10,
              undefined,
              defaultAbiCoder.encode(
                ["uint256", "uint256", "uint256"],
                [AppConstants.ENTRY_KIND_1, 1, 1]
              )
            );

            const sourceAssetUSD = +formatUnits(
              collateralAmount.sub(r.plan.collateralAmount).mul(r.priceCollateral),
              r.collateralAssetData.data.decimals
            );
            const targetAssetUSD = +formatUnits(
              r.plan.amountToBorrow.mul(r.priceBorrow),
              r.borrowAssetData.data.decimals
            );
            const amountCollateralInBorrowAsset36 = convertUnits(r.plan.collateralAmount,
              r.priceCollateral,
              r.collateralAssetData.data.decimals,
              r.priceBorrow,
              36
            );

            const ret = [
              sourceAssetUSD === targetAssetUSD,
              r.plan.collateralAmount.lt(collateralAmount),
              areAlmostEqual(r.plan.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36)
            ].join();
            const expected = [true, true, true].join();

            console.log("plan", r.plan);
            console.log("sourceAssetUSD", sourceAssetUSD);
            console.log("targetAssetUSD", targetAssetUSD);
            console.log("amountCollateralInBorrowAsset36", amountCollateralInBorrowAsset36);

            expect(ret).eq(expected);
          });
        });
        describe("Use ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2", () => {
          it("should return expected collateral and borrow amounts", async () => {
            const collateralAsset = MaticAddresses.DAI;
            const borrowAsset = MaticAddresses.WMATIC;

            // let's calculate borrow amount by known collateral amount
            const collateralAmount = parseUnits("1000", 18);
            const countBlocks = 10;
            const core = MaticCore.getCoreAave3();
            const d = await preparePlan(core, collateralAsset, collateralAmount, borrowAsset, countBlocks);
            const borrowAmount = AprUtils.getBorrowAmount(
              collateralAmount,
              d.healthFactor2,
              d.plan.liquidationThreshold18,
              d.priceCollateral,
              d.priceBorrow,
              d.collateralAssetData.data.decimals,
              d.borrowAssetData.data.decimals
            );
            const expectedCollateralAmount = AprUtils.getCollateralAmount(
              borrowAmount,
              d.healthFactor2,
              d.plan.liquidationThreshold18,
              d.priceCollateral,
              d.priceBorrow,
              d.collateralAssetData.data.decimals,
              d.borrowAssetData.data.decimals
            );

            const r = await preparePlan(
              core,
              collateralAsset,
              borrowAmount,
              borrowAsset,
              countBlocks,
              undefined,
              defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2])
            );

            const amountCollateralInBorrowAsset36 = convertUnits(r.plan.collateralAmount,
              r.priceCollateral,
              r.collateralAssetData.data.decimals,
              r.priceBorrow,
              36
            );
            const ret = [
              r.plan.amountToBorrow,
              areAlmostEqual(r.plan.collateralAmount, collateralAmount),
              areAlmostEqual(r.plan.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36),
              areAlmostEqual(expectedCollateralAmount, collateralAmount) // let's ensure that expectedCollateralAmount is correct
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [borrowAmount, true, true, true].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
      });
      describe("Collateral and borrow amounts fit to limits", () => {
        describe("Allowed collateral exceeds available collateral", () => {
          it("should return expected borrow and collateral amounts", async () => {
            const core = MaticCore.getCoreAave3();
            // let's get max available supply amount
            const sample = await preparePlan(core, MaticAddresses.DAI, parseUnits("1", 18), MaticAddresses.WMATIC);

            // let's try to borrow amount using collateral that exceeds max supply amount
            const r = await preparePlan(core, MaticAddresses.DAI, sample.plan.maxAmountToSupply.add(1000), MaticAddresses.WMATIC);
            console.log(r.plan);

            const expectedCollateralAmount = AprUtils.getCollateralAmount(
              r.plan.amountToBorrow,
              r.healthFactor2,
              r.plan.liquidationThreshold18,
              r.priceCollateral,
              r.priceBorrow,
              r.collateralAssetData.data.decimals,
              r.borrowAssetData.data.decimals
            );

            const ret = [
              r.plan.amountToBorrow.lte(r.plan.maxAmountToBorrow),
              areAlmostEqual(r.plan.collateralAmount, expectedCollateralAmount)
            ].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [
              true,
              true
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Allowed borrow amounts exceeds available borrow amount", () => {
          it("should return expected borrow and collateral amounts", async () => {
            const core = MaticCore.getCoreAave3();
            // let's get max available borrow amount
            const sample = await preparePlan(core, MaticAddresses.DAI, parseUnits("1", 18), MaticAddresses.WMATIC);

            // let's try to borrow amount using collateral that exceeds max supply amount
            const r = await preparePlan(
              core,
              MaticAddresses.DAI,
              sample.plan.maxAmountToBorrow.add(1000),
              MaticAddresses.WMATIC,
              10,
              undefined,
              defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2])
            );
            console.log(r.plan);

            const expectedCollateralAmount = AprUtils.getCollateralAmount(
              sample.plan.maxAmountToBorrow,
              r.healthFactor2,
              r.plan.liquidationThreshold18,
              r.priceCollateral,
              r.priceBorrow,
              r.collateralAssetData.data.decimals,
              r.borrowAssetData.data.decimals
            );
            const expectedBorrowAmount = AprUtils.getBorrowAmount(
              sample.plan.maxAmountToSupply,
              r.healthFactor2,
              r.plan.liquidationThreshold18,
              r.priceCollateral,
              r.priceBorrow,
              r.collateralAssetData.data.decimals,
              r.borrowAssetData.data.decimals
            );
            console.log("expectedBorrowAmount", expectedBorrowAmount);

            const ret = [
              r.plan.amountToBorrow.eq(r.plan.maxAmountToBorrow)
              || r.plan.collateralAmount.eq(r.plan.maxAmountToSupply),
              areAlmostEqual(r.plan.collateralAmount, expectedCollateralAmount)
              || areAlmostEqual(r.plan.amountToBorrow, expectedBorrowAmount)
            ].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [true, true].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
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
      ): Promise<IConversionPlan> {
        return (await preparePlan(
          MaticCore.getCoreAave3(),
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
            await expect(
              tryGetConversionPlan({zeroCollateralAsset: true})
            ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
          });
        });
        describe("borrow token is zero", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({zeroBorrowAsset: true})
            ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
          });
        });
        describe("healthFactor2_ is less than min allowed", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({incorrectHealthFactor2: 100})
            ).revertedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
          });
        });
        describe("countBlocks_ is zero", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({zeroCountBlocks: true})
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
        describe("collateralAmount_ is zero", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({zeroAmountIn: true})
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
      });

      /* We cannot make a reserve inactive if it has active suppliers */
      describe.skip("inactive", () => {
        describe("collateral token is inactive", () => {
          it("should revert", async () => {
            expect.fail("TODO");
          });
        });
        describe("borrow token is inactive", () => {
          it("should revert", async () => {
            expect.fail("TODO");
          });
        });
      });

      describe("paused", () => {
        it("should fail if collateral token is paused", async () => {
          expect((await tryGetConversionPlan({makeCollateralAssetPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if borrow token is paused", async () => {
          expect((await tryGetConversionPlan({makeBorrowAssetPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
      });

      describe("frozen", () => {
        it("should fail if collateral token is frozen", async () => {
          expect((await tryGetConversionPlan({makeCollateralAssetFrozen: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if borrow token is frozen", async () => {
          expect((await tryGetConversionPlan({makeBorrowAssetFrozen: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
      });

      describe("Not usable", () => {
        it("should fail if borrow asset is not borrowable", async () => {
          // AaveToken has borrowing = FALSE
          expect((await tryGetConversionPlan({}, MaticAddresses.DAI, MaticAddresses.AaveToken)).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if collateral asset is not usable as collateral", async () => {
          // agEUR has liquidation threshold = 0, it means, it cannot be used as collateral
          expect((await tryGetConversionPlan({}, MaticAddresses.agEUR)).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if isolation mode is enabled for collateral, borrow token is not borrowable in isolation mode", async () => {
          // EURS has not zero isolationModeTotalDebtm, SUSHI has "borrowable in isolation mode" = FALSE
          expect((await tryGetConversionPlan({}, MaticAddresses.EURS, MaticAddresses.SUSHI)).converter).eq(Misc.ZERO_ADDRESS);
        });
      });

      describe("Caps", () => {
        it("should return expected maxAmountToSupply when try to supply more than allowed by supply cap", async () => {
          const plan = await tryGetConversionPlan(
            {setMinSupplyCap: true},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            "12345"
          );
          expect(plan.maxAmountToSupply.lt(parseUnits("12345"))).eq(true);
        });
        it("should return expected maxAmountToSupply=max(uint) if supply cap is zero (supplyCap == 0 => no cap)", async () => {
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
          const plan = await tryGetConversionPlan(
            {setZeroBorrowCap: true},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            "12345"
          );
          const dataProvider = await Aave3Helper.getAaveProtocolDataProvider(deployer, MaticAddresses.AAVE_V3_POOL);
          const borrowData = await dataProvider.getReserveData(MaticAddresses.USDC);
          // by default, maxAmountToBorrow = totalAToken - totalStableDebt - totalVariableDebt;
          const expectedMaxAmountToBorrow = borrowData.totalAToken
            .sub(borrowData.totalStableDebt)
            .sub(borrowData.totalVariableDebt);
          console.log(plan.maxAmountToBorrow.toString(), expectedMaxAmountToBorrow.toString());
          expect(plan.maxAmountToBorrow.eq(expectedMaxAmountToBorrow)).eq(true);
        });
      });

      describe("Use unsupported entry kind 999", () => {
        it("should return zero plan", async () => {

          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.WMATIC;
          const collateralAmount = parseUnits("1000", 18);
          const core = MaticCore.getCoreAave3();

          const r = await preparePlan(
            core,
            collateralAsset,
            collateralAmount,
            borrowAsset,
            10,
            undefined,
            defaultAbiCoder.encode(["uint256"], [999]) // (!) unknown entry kind
          );
          expect(r.plan.converter).eq(Misc.ZERO_ADDRESS);
          expect(r.plan.collateralAmount.eq(0)).eq(true);
          expect(r.plan.amountToBorrow.eq(0)).eq(true);
        });
      });

      describe("Result collateralAmount == 0, amountToBorrow != 0 (edge case, improve coverage)", () => {
        it("should return zero plan", async () => {
          const collateralAsset = MaticAddresses.USDC;
          const borrowAsset = MaticAddresses.USDT;
          const collateralAmount = parseUnits("1", 6);
          const core = MaticCore.getCoreAave3();

          const r0 = await preparePlan(
            core,
            collateralAsset,
            collateralAmount,
            borrowAsset,
            10,
            undefined,
            defaultAbiCoder.encode(["uint256"], [2])
          );

          // change prices: make priceCollateral very high, priceBorrow very low
          // as result, exactBorrowOutForMinCollateralIn will return amountToCollateralOut = 0,
          // and we should hit second condition in borrow-validation section:
          //    plan.amountToBorrow == 0 || plan.collateralAmount == 0

          const priceOracle = await Aave3ChangePricesUtils.setupPriceOracleMock(deployer, core);
          await priceOracle.setPrices(
            [MaticAddresses.USDC, MaticAddresses.USDT],
            [parseUnits("1", 15), parseUnits("1", 5)]
          );

          const r1 = await preparePlan(
            core,
            collateralAsset,
            collateralAmount,
            borrowAsset,
            10,
            undefined,
            defaultAbiCoder.encode(["uint256"], [2])
          );

          // first plan is successful
          expect(r0.plan.converter).not.eq(Misc.ZERO_ADDRESS);
          expect(r0.plan.collateralAmount.eq(0)).not.eq(true);
          expect(r0.plan.amountToBorrow.eq(0)).not.eq(true);

          // the plan created after changing the prices is not successful
          expect(r1.plan.converter).eq(Misc.ZERO_ADDRESS);
          expect(r1.plan.collateralAmount.eq(0)).eq(true);
          expect(r1.plan.amountToBorrow.eq(0)).eq(true);
        });
      });

      describe("supplyCap < totalSupply (edge case, improve coverage)", () => {
        it("should return zero plan", async () => {
          const collateralAsset = MaticAddresses.USDC;
          const borrowAsset = MaticAddresses.USDT;
          const collateralAmount = parseUnits("1", 6);
          const core = MaticCore.getCoreAave3();

          const r0 = await preparePlan(
            core,
            collateralAsset,
            collateralAmount,
            borrowAsset,
            10,
            undefined,
            defaultAbiCoder.encode(["uint256"], [2])
          );

          // set very small supplyCap
          await Aave3ChangePricesUtils.setSupplyCap(deployer, core, MaticAddresses.USDC, parseUnits("1", 6));

          const r1 = await preparePlan(
            core,
            collateralAsset,
            collateralAmount,
            borrowAsset,
            10,
            undefined,
            defaultAbiCoder.encode(["uint256"], [2])
          );

          // first plan is successful
          expect(r0.plan.converter).not.eq(Misc.ZERO_ADDRESS);
          expect(r0.plan.collateralAmount.eq(0)).not.eq(true);
          expect(r0.plan.amountToBorrow.eq(0)).not.eq(true);

          // the plan created after changing the prices is not successful
          expect(r1.plan.converter).eq(Misc.ZERO_ADDRESS);
          expect(r1.plan.collateralAmount.eq(0)).eq(true);
          expect(r1.plan.amountToBorrow.eq(0)).eq(true);
        });
      });
    });
    describe("Check gas limit @skip-on-coverage", () => {
      it("should not exceed gas limits", async () => {
        const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
          deployer,
          controller.address,
          MaticAddresses.AAVE_V3_POOL,
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address
        );

        const gasUsed = await aavePlatformAdapter.estimateGas.getConversionPlan(
          {
            collateralAsset: MaticAddresses.DAI,
            amountIn: parseUnits("1", 18),
            borrowAsset: MaticAddresses.USDC,
            countBlocks: 1,
            entryData: "0x",
            user: Misc.ZERO_ADDRESS
          },
          200,
          {gasLimit: GAS_LIMIT}
        );
        controlGasLimitsEx2(gasUsed, GAS_LIMIT_AAVE_3_GET_CONVERSION_PLAN, (u, t) => {
          expect(u).to.be.below(t);
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
      ): Promise<{ br: BigNumber, brPredicted: BigNumber }> {
        const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer, MaticAddresses.AAVE_V3_POOL);
        const aavePool = await Aave3Helper.getAavePool(deployer, MaticAddresses.AAVE_V3_POOL);

        return PredictBrUsesCase.makeTest(
          deployer,
          new Aave3PlatformActor(
            dp,
            aavePool,
            collateralAsset,
            borrowAsset
          ),
          "aave3",
          collateralAsset,
          borrowAsset,
          collateralHolders,
          part10000
        );
      }

      describe("small amount", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {

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
    let controller: ConverterController;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      controller = await TetuConverterApp.createController(deployer);
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IInitializePoolAdapterBadPaths {
      useWrongConverter?: boolean;
      wrongCallerOfInitializePoolAdapter?: boolean;
    }

    async function makeInitializePoolAdapterTest(
      useEMode: boolean,
      badParams?: IInitializePoolAdapterBadPaths
    ): Promise<{ ret: string, expected: string }> {
      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = (await MocksHelper.createMockedCToken(deployer)).address;
      const borrowAsset = (await MocksHelper.createMockedCToken(deployer)).address;

      const borrowManager = BorrowManager__factory.connect(
        await controller.borrowManager(),
        deployer
      );

      const converterNormal = await AdaptersHelper.createAave3PoolAdapter(deployer);
      const converterEMode = await AdaptersHelper.createAave3PoolAdapterEMode(deployer);

      const aavePool = await Aave3Helper.getAavePool(deployer, MaticAddresses.AAVE_V3_POOL);
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

        const r = await makeInitializePoolAdapterTest(false);
        expect(r.ret).eq(r.expected);
      });
      it("EMode mode: initialized pool adapter should has expected values", async () => {

        const r = await makeInitializePoolAdapterTest(false);
        expect(r.ret).eq(r.expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert if converter address is not registered", async () => {

        await expect(
          makeInitializePoolAdapterTest(
            false,
            {useWrongConverter: true}
          )
        ).revertedWith("TC-25 converter not found"); // CONVERTER_NOT_FOUND
      });
      it("should revert if it's called by not borrow-manager", async () => {

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

  describe("setFrozen", () => {
    describe("Good paths", () => {
      it("should assign expected value to frozen", async () => {

        const controller = await TetuConverterApp.createController(deployer,
          {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
        );

        const aavePool = await Aave3Helper.getAavePool(deployer, MaticAddresses.AAVE_V3_POOL);
        const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
          deployer,
          controller.address,
          aavePool.address,
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address
        );

        const before = await aavePlatformAdapter.frozen();
        await aavePlatformAdapter.setFrozen(true);
        const middle = await aavePlatformAdapter.frozen();
        await aavePlatformAdapter.setFrozen(false);
        const after = await aavePlatformAdapter.frozen();

        const ret = [before, middle, after].join();
        const expected = [false, true, false].join();

        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      it("should assign expected value to frozen", async () => {

        const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
          deployer,
          (await TetuConverterApp.createController(deployer)).address,
          (await Aave3Helper.getAavePool(deployer, MaticAddresses.AAVE_V3_POOL)).address,
          ethers.Wallet.createRandom().address,
          ethers.Wallet.createRandom().address
        );

        await expect(
          aavePlatformAdapter.connect(await Misc.impersonate(ethers.Wallet.createRandom().address)).setFrozen(true)
        ).revertedWith("TC-9 governance only"); // AppErrors.GOVERNANCE_ONLY
      });
    })
  });

  describe("platformKind", () => {
    it("should return expected values", async () => {
      const controller = await TetuConverterApp.createController(deployer);

      const pa = await AdaptersHelper.createAave3PlatformAdapter(
        deployer,
        controller.address,
        MaticAddresses.AAVE_V3_POOL,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        await controller.borrowManager()
      );
      expect((await pa.platformKind())).eq(3); // LendingPlatformKinds.AAVE3_3
    });
  });
//endregion Unit tests

});
