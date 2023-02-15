import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {AaveTwoHelper, IAaveTwoReserveInfo} from "../../../scripts/integration/helpers/AaveTwoHelper";
import {AprUtils, COUNT_BLOCKS_PER_DAY} from "../../baseUT/utils/aprUtils";
import {
  AaveTwoPlatformAdapter,
  AaveTwoPlatformAdapter__factory, Controller,
  IAaveTwoPool,
  IAaveTwoProtocolDataProvider,
  IERC20Metadata__factory
} from "../../../typechain";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IPlatformActor, PredictBrUsesCase} from "../../baseUT/uses-cases/PredictBrUsesCase";
import {AprAaveTwo, getAaveTwoStateInfo, IAaveTwoStateInfo, IAaveTwoReserveData} from "../../baseUT/apr/aprAaveTwo";
import {Misc} from "../../../scripts/utils/Misc";
import {convertUnits} from "../../baseUT/apr/aprUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {IConversionPlan} from "../../baseUT/apr/aprDataTypes";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {AaveTwoChangePricesUtils} from "../../baseUT/protocols/aaveTwo/AaveTwoChangePricesUtils";
import {controlGasLimitsEx} from "../../../scripts/utils/hardhatUtils";
import {GAS_LIMIT_AAVE_TWO_GET_CONVERSION_PLAN} from "../../baseUT/GasLimit";

describe("AaveTwoPlatformAdapterTest", () => {
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

//region IPlatformActor impl
  class AaveTwoPlatformActor implements IPlatformActor {
    dp: IAaveTwoProtocolDataProvider;
    pool: IAaveTwoPool;
    collateralAsset: string;
    borrowAsset: string;
    constructor(
      dp: IAaveTwoProtocolDataProvider,
      pool: IAaveTwoPool,
      collateralAsset: string,
      borrowAsset: string
    ) {
      this.dp = dp;
      this.pool = pool;
      this.collateralAsset = collateralAsset;
      this.borrowAsset = borrowAsset;
    }
    async getAvailableLiquidity() : Promise<BigNumber> {
      const rd = await this.dp.getReserveData(this.borrowAsset);
      console.log(`Reserve data before: totalAToken=${rd.availableLiquidity} totalStableDebt=${rd.totalStableDebt} totalVariableDebt=${rd.totalVariableDebt}`);
      return rd.availableLiquidity;
    }
    async getCurrentBR(): Promise<BigNumber> {
      const data = await AaveTwoHelper.getReserveInfo(deployer, this.pool, this.dp, this.borrowAsset);
      const br = data.data.currentVariableBorrowRate;
      console.log(`BR ${br.toString()}`);
      return BigNumber.from(br);
    }
    async supplyCollateral(collateralAmount: BigNumber): Promise<void> {
      await IERC20Metadata__factory.connect(this.collateralAsset, deployer).approve(this.pool.address, collateralAmount);
      console.log(`Supply collateral ${this.collateralAsset} amount ${collateralAmount}`);
      await this.pool.deposit(this.collateralAsset, collateralAmount, deployer.address, 0);
      const userAccountData = await this.pool.getUserAccountData(deployer.address);
      console.log(`Available borrow base ${userAccountData.availableBorrowsETH}`);
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
      aavePool: string;
    }
    interface ICreateContractsSetBadParams {
      zeroController?: boolean;
      zeroTemplateAdapterNormal?: boolean;
      zeroAavePool?: boolean;
    }
    async function initializePlatformAdapter(
      badPaths?: ICreateContractsSetBadParams
    ) : Promise<{data: IContractsSet, platformAdapter: AaveTwoPlatformAdapter}> {
      const controller = await TetuConverterApp.createController(
        deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const templateAdapterNormalStub = ethers.Wallet.createRandom();

      const data: IContractsSet = {
        controller: badPaths?.zeroController ? Misc.ZERO_ADDRESS : controller.address,
        aavePool: badPaths?.zeroAavePool ? Misc.ZERO_ADDRESS : MaticAddresses.AAVE_TWO_POOL,
        templateAdapterNormal: badPaths?.zeroTemplateAdapterNormal ? Misc.ZERO_ADDRESS : templateAdapterNormalStub.address
      }
      const platformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
        deployer,
        data.controller,
        data.aavePool,
        data.templateAdapterNormal,
        await controller.borrowManager()
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
          await r.platformAdapter.converter(),
          (await r.platformAdapter.converters()).join()
        ].join();
        const expected = [
          r.data.controller,
          r.data.aavePool,
          r.data.templateAdapterNormal,
          [r.data.templateAdapterNormal].join()
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
    });
  });

  describe("getConversionPlan", () => {
    let controller: Controller;
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
      zeroCollateralAmount?: boolean;
      incorrectHealthFactor2?: number;
      makeCollateralAssetFrozen?: boolean;
      makeBorrowAssetFrozen?: boolean;
      frozen?: boolean;
    }
    interface IPreparePlanResults {
      plan: IConversionPlan;
      healthFactor2: number;
      priceCollateral: BigNumber;
      priceBorrow: BigNumber;
      aavePool: IAaveTwoPool;
      borrowReserveData: IAaveTwoReserveData;
      collateralReserveData: IAaveTwoReserveData;
      collateralAssetData: IAaveTwoReserveInfo;
      borrowAssetData: IAaveTwoReserveInfo;
      before: IAaveTwoStateInfo;
      blockTimeStamp: number;
    }
    async function preparePlan(
      collateralAsset: string,
      collateralAmount: BigNumber,
      borrowAsset: string,
      countBlocks: number = 10,
      badPathsParams?: IGetConversionPlanBadPaths,
      entryData?: string
    ) : Promise<IPreparePlanResults> {
      const templateAdapterNormalStub = ethers.Wallet.createRandom();
      const healthFactor2 = 200;

      const aavePool = await AaveTwoHelper.getAavePool(deployer);
      const aavePlatformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
        deployer,
        controller.address,
        aavePool.address,
        templateAdapterNormalStub.address,
      );

      const priceOracle = await AaveTwoHelper.getAavePriceOracle(deployer);
      const priceCollateral = await priceOracle.getAssetPrice(collateralAsset);
      const priceBorrow = await priceOracle.getAssetPrice(borrowAsset);

      const dp = await AaveTwoHelper.getAaveProtocolDataProvider(deployer);

      const collateralAssetData = await AaveTwoHelper.getReserveInfo(deployer, aavePool, dp, collateralAsset);
      const borrowAssetData = await AaveTwoHelper.getReserveInfo(deployer, aavePool, dp, borrowAsset);

      // data required to predict supply/borrow APR
      const block = await hre.ethers.provider.getBlock("latest");
      const before = await getAaveTwoStateInfo(deployer, aavePool, collateralAsset, borrowAsset);
      const borrowReserveData = await dp.getReserveData(borrowAsset);
      const collateralReserveData = await dp.getReserveData(collateralAsset);

      if (badPathsParams?.makeBorrowAssetFrozen) {
        await AaveTwoChangePricesUtils.setReserveFreeze(deployer, borrowAsset);
      }
      if (badPathsParams?.makeCollateralAssetFrozen) {
        await AaveTwoChangePricesUtils.setReserveFreeze(deployer, collateralAsset);
      }
      if (badPathsParams?.frozen) {
        await aavePlatformAdapter.setFrozen(true);
      }
      const plan = await aavePlatformAdapter.getConversionPlan(
        {
          collateralAsset: badPathsParams?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
          amountIn: badPathsParams?.zeroCollateralAmount ? 0 : collateralAmount,
          borrowAsset: badPathsParams?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
          countBlocks: badPathsParams?.zeroCountBlocks ? 0 : countBlocks,
          entryData: entryData || "0x"
        },
        badPathsParams?.incorrectHealthFactor2 || healthFactor2,
      );
      return {
        before,
        aavePool,
        plan,
        collateralReserveData,
        blockTimeStamp: block.timestamp,
        borrowAssetData,
        borrowReserveData,
        collateralAssetData,
        healthFactor2,
        priceCollateral,
        priceBorrow,
      }
    }
    async function makeGetConversionPlanTest(
      collateralAsset: string,
      collateralAmount: BigNumber,
      borrowAsset: string,
      badPathsParams?: IGetConversionPlanBadPaths
    ) : Promise<{sret: string, sexpected: string}> {
      const countBlocks = 10;
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
      console.log("AprUtils.getBorrowAmount");
      console.log("collateralAmount", collateralAmount);
      console.log("healthFactor2", d.healthFactor2);
      console.log("ret.liquidationThreshold18", d.plan.liquidationThreshold18);
      console.log("priceCollateral", d.priceCollateral);
      console.log("priceBorrow", d.priceBorrow);
      console.log("collateralAssetData.data.decimals", d.collateralAssetData.data.decimals);
      console.log("borrowAssetData.data.decimals", d.borrowAssetData.data.decimals);

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
      const predictedSupplyIncomeInBorrowAssetRay = await AprAaveTwo.predictSupplyIncomeRays(deployer,
        d.aavePool,
        collateralAsset,
        collateralAmount,
        borrowAsset,
        countBlocks,
        COUNT_BLOCKS_PER_DAY,
        d.collateralReserveData,
        d.before,
        d.blockTimeStamp
      );
      console.log("predictedSupplyIncomeInBorrowAssetRay", predictedSupplyIncomeInBorrowAssetRay);

      const predictedBorrowCostRay = await AprAaveTwo.predictBorrowCostRays(deployer,
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
      console.log("predictedBorrowCostRay", predictedBorrowCostRay);

      const sret = [
        d.plan.borrowCost36,
        d.plan.supplyIncomeInBorrowAsset36,
        d.plan.rewardsAmountInBorrowAsset36,
        d.plan.ltv18,
        d.plan.liquidationThreshold18,
        d.plan.maxAmountToBorrow,
        d.plan.maxAmountToSupply,
        d.plan.amountToBorrow,
        d.plan.amountCollateralInBorrowAsset36
      ].map(x => BalanceUtils.toString(x)) .join("\n");

      const sexpected = [
        predictedBorrowCostRay,
        predictedSupplyIncomeInBorrowAssetRay,
        0,
        BigNumber.from(d.collateralAssetData.data.ltv)
          .mul(Misc.WEI)
          .div(getBigNumberFrom(1, 4)),
        BigNumber.from(d.collateralAssetData.data.liquidationThreshold
        )
          .mul(Misc.WEI)
          .div(getBigNumberFrom(1, 4)),
        BigNumber.from(d.borrowAssetData.liquidity.availableLiquidity),
        BigNumber.from(2).pow(256).sub(1), // === type(uint).max
        borrowAmount,
        amountCollateralInBorrowAsset36
      ].map(x => BalanceUtils.toString(x)) .join("\n");

      return {sret, sexpected};
    }
    describe("Good paths", () => {
      describe("DAI : matic", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.WMATIC;

          const collateralAmount = parseUnits("1000", 18);
          const r = await makeGetConversionPlanTest(collateralAsset, collateralAmount, borrowAsset);

          expect(r.sret).eq(r.sexpected);
        });
      });
      describe("WMATIC: USDT", () => {
        it("should return expected values", async () =>{
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.WMATIC;
          const borrowAsset = MaticAddresses.USDT;
          const collateralAmount = parseUnits("1000", 18);

          const r = await makeGetConversionPlanTest(collateralAsset, collateralAmount, borrowAsset);

          expect(r.sret).eq(r.sexpected);
        });
      });
      describe("DAI:USDC", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.USDC;
          const collateralAmount = parseUnits("1000", 18);

          const r = await makeGetConversionPlanTest(collateralAsset, collateralAmount, borrowAsset);

          expect(r.sret).eq(r.sexpected);
        });
      });
      /** CRV and Balancer are frozen */
      describe.skip("CRV:BALANCER", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.CRV;
          const borrowAsset = MaticAddresses.BALANCER;
          const collateralAmount = parseUnits("1", 18);

          const r = await makeGetConversionPlanTest(collateralAsset, collateralAmount, borrowAsset);

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
      describe("Frozen", () => {
        it("should return no plan", async () => {
          if (!await isPolygonForkInUse()) return;

          const r = await preparePlan(
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
      describe("EntryKinds", () => {
        describe("Use ENTRY_KIND_EXACT_PROPORTION_1", () => {
          it("should split source amount on the parts with almost same cost", async () => {
            if (!await isPolygonForkInUse()) return;

            const collateralAsset = MaticAddresses.DAI;
            const borrowAsset = MaticAddresses.WMATIC;
            const collateralAmount = parseUnits("1000", 18);

            const r = await preparePlan(
              collateralAsset,
              collateralAmount,
              borrowAsset,
              10,
              undefined,
              defaultAbiCoder.encode(
                ["uint256", "uint256", "uint256"],
                [1, 1, 1]
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

            const ret = [
              sourceAssetUSD === targetAssetUSD,
              r.plan.collateralAmount.lt(collateralAmount)
            ].join();
            const expected = [true, true].join();

            console.log("sourceAssetUSD", sourceAssetUSD);
            console.log("targetAssetUSD", targetAssetUSD);

            expect(ret).eq(expected);
          });
        });
        describe("Use ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2", () => {
          it("should return expected collateral amount", async () => {
            if (!await isPolygonForkInUse()) return;

            const collateralAsset = MaticAddresses.DAI;
            const borrowAsset = MaticAddresses.WMATIC;

            // let's calculate borrow amount by known collateral amount
            const collateralAmount = parseUnits("1000", 18);
            const countBlocks = 10;
            const d = await preparePlan(collateralAsset, collateralAmount, borrowAsset, countBlocks);
            const borrowAmount = AprUtils.getBorrowAmount(
              collateralAmount,
              d.healthFactor2,
              d.plan.liquidationThreshold18,
              d.priceCollateral,
              d.priceBorrow,
              d.collateralAssetData.data.decimals,
              d.borrowAssetData.data.decimals
            );

            const r = await preparePlan(
              collateralAsset,
              borrowAmount,
              borrowAsset,
              countBlocks,
              undefined,
              defaultAbiCoder.encode(["uint256"], [2])
            );

            const ret = [
              r.plan.amountToBorrow,
              areAlmostEqual(r.plan.collateralAmount, collateralAmount)
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              borrowAmount,
              true
            ].map(x => BalanceUtils.toString(x)).join("\n");

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
          it("should revert", async () =>{
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

      describe("pool is frozen", () => {
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
          // USDT has liquidation threshold = 0, it means, it cannot be used as collateral
          expect((await tryGetConversionPlan({}, MaticAddresses.USDT)).converter).eq(Misc.ZERO_ADDRESS);
        });
      });
    });
    describe("Check gas limit @skip-on-coverage", () => {
      it("should not exceed gas limits", async () => {
        if (!await isPolygonForkInUse()) return;

        const aavePlatformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
          deployer,
          controller.address,
          MaticAddresses.AAVE_TWO_POOL,
          ethers.Wallet.createRandom().address
        );

        const gasUsed = await aavePlatformAdapter.estimateGas.getConversionPlan(
          {
            collateralAsset: MaticAddresses.DAI,
            amountIn: parseUnits("1", 18),
            borrowAsset: MaticAddresses.USDC,
            countBlocks: 1,
            entryData: "0x"
          },
          200,
        );
        console.log("AaveTwoPlatformAdapter.getConversionPlan.gas", gasUsed.toString());
        controlGasLimitsEx(gasUsed, GAS_LIMIT_AAVE_TWO_GET_CONVERSION_PLAN, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("getBorrowRateAfterBorrow", () => {
    describe("Good paths", () => {
      async function makeTest(
        collateralAsset: string,
        borrowAsset: string,
        collateralHolders: string[],
        part10000: number
      ) : Promise<{br: BigNumber, brPredicted: BigNumber}> {
        const templateAdapterNormalStub = ethers.Wallet.createRandom();
        const dp = await AaveTwoHelper.getAaveProtocolDataProvider(deployer);
        const aavePool = await AaveTwoHelper.getAavePool(deployer);

        return PredictBrUsesCase.makeTest(
          deployer,
          new AaveTwoPlatformActor(
            dp,
            aavePool,
            collateralAsset,
            borrowAsset
          ),
          async controller => AdaptersHelper.createAaveTwoPlatformAdapter(
            deployer,
            controller.address,
            aavePool.address,
            templateAdapterNormalStub.address,
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

          const r = await makeTest(collateralAsset, borrowAsset, collateralHolders, part10000);

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
          const part10000 = 500;

          const r = await makeTest(collateralAsset, borrowAsset, collateralHolders, part10000);

          const ret = areAlmostEqual(r.br, r.brPredicted, 5);
          expect(ret).eq(true);
        });
      });
    });

  });

  describe("initializePoolAdapter", () => {
    let controller: Controller;
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
    interface IInitializePoolAdapterBadPaths {
      useWrongConverter?: boolean;
      wrongCallerOfInitializePoolAdapter?: boolean;
    }
    async function makeInitializePoolAdapterTest(
      badParams?: IInitializePoolAdapterBadPaths
    ) : Promise<{ret: string, expected: string}> {
      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = (await MocksHelper.createMockedCToken(deployer)).address;
      const borrowAsset = (await MocksHelper.createMockedCToken(deployer)).address;
      const converterNormal = await AdaptersHelper.createAaveTwoPoolAdapter(deployer);

      const aavePool = await AaveTwoHelper.getAavePool(deployer);
      const aavePlatformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
        deployer,
        controller.address,
        aavePool.address,
        converterNormal.address,
      );

      const poolAdapter = await AdaptersHelper.createAaveTwoPoolAdapter(deployer)
      const aavePlatformAdapterAsBorrowManager = AaveTwoPlatformAdapter__factory.connect(
        aavePlatformAdapter.address,
        badParams?.wrongCallerOfInitializePoolAdapter
          ? await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
          : await DeployerUtils.startImpersonate(await controller.borrowManager())
      );

      await aavePlatformAdapterAsBorrowManager.initializePoolAdapter(
        badParams?.useWrongConverter
          ? ethers.Wallet.createRandom().address
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
        converterNormal.address,
        user,
        collateralAsset,
        borrowAsset
      ].join();
      return {ret, expected};
    }

    describe("Good paths", () => {
      it("initialized pool adapter should has expected values", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await makeInitializePoolAdapterTest();
        expect(r.ret).eq(r.expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert if converter address is not registered", async () => {
        if (!await isPolygonForkInUse()) return;

        await expect(
          makeInitializePoolAdapterTest(
            {useWrongConverter: true}
          )
        ).revertedWith("TC-25 converter not found"); // CONVERTER_NOT_FOUND
      });
      it("should revert if it's called by not borrow-manager", async () => {
        if (!await isPolygonForkInUse()) return;

        await expect(
          makeInitializePoolAdapterTest(
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
      const converterNormal = await AdaptersHelper.createAaveTwoPoolAdapter(deployer);
      const aavePlatformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
        deployer,
        controller.address,
        MaticAddresses.AAVE_TWO_POOL,
        converterNormal.address,
      );

      const poolAdapter = await AdaptersHelper.createAaveTwoPoolAdapter(deployer);
      const aavePlatformAdapterAsBorrowManager = AaveTwoPlatformAdapter__factory.connect(
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
    it("should assign expected value to frozen", async () => {
      const controller = await TetuConverterApp.createController(deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );

      const aavePool = await AaveTwoHelper.getAavePool(deployer);
      const aavePlatformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
        deployer,
        controller.address,
        aavePool.address,
        ethers.Wallet.createRandom().address,
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
//endregion Unit tests

});