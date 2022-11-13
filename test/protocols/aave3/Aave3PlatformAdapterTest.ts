import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  Aave3PlatformAdapter__factory,
  IAavePool,
  IAaveProtocolDataProvider,
  IERC20Extended__factory, IPlatformAdapter
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {AprUtils, COUNT_BLOCKS_PER_DAY} from "../../baseUT/utils/aprUtils";
import {CoreContractsHelper} from "../../baseUT/helpers/CoreContractsHelper";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IPlatformActor, PredictBrUsesCase} from "../../baseUT/uses-cases/PredictBrUsesCase";
import {AprAave3, getAave3StateInfo} from "../../baseUT/apr/aprAave3";
import {Misc} from "../../../scripts/utils/Misc";
import {convertUnits} from "../../baseUT/apr/aprUtils";
import {Aave3Utils} from "../../baseUT/protocols/aave3/Aave3Utils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";

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
      await IERC20Extended__factory.connect(this.collateralAsset, deployer).approve(this.pool.address, collateralAmount);
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
  describe("getConversionPlan", () => {
    interface IGetConversionPlanBadPaths {
      zeroCollateralAsset?: boolean;
      zeroBorrowAsset?: boolean;
      zeroCountBlocks?: boolean;
      zeroCollateralAmount?: boolean;
      incorrectHealthFactor2?: number;
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
      const controller = await CoreContractsHelper.createController(deployer);
      const templateAdapterNormalStub = ethers.Wallet.createRandom();
      const templateAdapterEModeStub = ethers.Wallet.createRandom();
      const healthFactor2 = 200;

      const h: Aave3Helper = new Aave3Helper(deployer);
      const aavePool = await Aave3Helper.getAavePool(deployer);
      const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
        deployer,
        controller.address,
        aavePool.address,
        templateAdapterNormalStub.address,
        templateAdapterEModeStub.address
      );
      const priceOracle = await Aave3Helper.getAavePriceOracle(deployer);
      const prices = await priceOracle.getAssetsPrices([collateralAsset, borrowAsset]);

      const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);

      const collateralAssetData = await h.getReserveInfo(deployer, aavePool, dp, collateralAsset);
      console.log("collateralAssetData", collateralAssetData);
      const borrowAssetData = await h.getReserveInfo(deployer, aavePool, dp, borrowAsset);
      console.log("borrowAssetData", borrowAssetData);

      // data required to predict supply/borrow APR
      const block = await hre.ethers.provider.getBlock("latest");
      const before = await getAave3StateInfo(deployer, aavePool, dp, collateralAsset, borrowAsset);
      const borrowReserveData = await dp.getReserveData(borrowAsset);
      const collateralReserveData = await dp.getReserveData(collateralAsset);

      // get conversion plan
      const ret = await aavePlatformAdapter.getConversionPlan(
        badPathsParams?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
        badPathsParams?.zeroCollateralAmount ? 0 : collateralAmount,
        badPathsParams?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
        badPathsParams?.incorrectHealthFactor2 || healthFactor2,
        badPathsParams?.zeroCountBlocks ? 0 : countBlocks,
      );
      console.log("ret", ret);

      let borrowAmount = AprUtils.getBorrowAmount(
        collateralAmount,
        healthFactor2,
        ret.liquidationThreshold18,
        prices[0],
        prices[1],
        collateralAssetData.data.decimals,
        borrowAssetData.data.decimals
      );

      if (borrowAmount.gt(ret.maxAmountToBorrow)) {
        borrowAmount = ret.maxAmountToBorrow;
      }

      const amountCollateralInBorrowAsset36 =  convertUnits(collateralAmount,
        prices[0],
        collateralAssetData.data.decimals,
        prices[1],
        36
      );

      // calculate expected supply and borrow values
      const predictedSupplyIncomeInBorrowAssetRay = await AprAave3.predictSupplyIncomeRays(deployer
        , aavePool
        , collateralAsset
        , collateralAmount
        , borrowAsset
        , countBlocks
        , COUNT_BLOCKS_PER_DAY
        , collateralReserveData
        , before
        , block.timestamp
      );

      const predictedBorrowCostInBorrowAssetRay = await AprAave3.predictBorrowAprRays(deployer
        , aavePool
        , collateralAsset
        , borrowAsset
        , borrowAmount
        , countBlocks
        , COUNT_BLOCKS_PER_DAY
        , borrowReserveData
        , before
        , block.timestamp
      );

      const sret = [
        ret.borrowCost36,
        ret.supplyIncomeInBorrowAsset36,
        ret.rewardsAmountInBorrowAsset36,
        ret.ltv18,
        ret.liquidationThreshold18,
        ret.maxAmountToBorrow,
        ret.maxAmountToSupply,
        // ensure that high efficiency mode is not available
        highEfficientModeEnabled
          ? collateralAssetData.data.emodeCategory !== 0
            && borrowAssetData.data.emodeCategory === collateralAssetData.data.emodeCategory
          : collateralAssetData.data.emodeCategory !== borrowAssetData.data.emodeCategory,

        !ret.borrowCost36.eq(0),
        !ret.supplyIncomeInBorrowAsset36.eq(0),
        ret.amountToBorrow,
        // we lost precision a bit in USDC : WBTC, so almost equal only
        areAlmostEqual(ret.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36)
      ].map(x => BalanceUtils.toString(x)) .join("\n");

      const expectedMaxAmountToBorrow = await Aave3Utils.getMaxAmountToBorrow(borrowAssetData, collateralAssetData);
      const expectedMaxAmountToSupply = await Aave3Utils.getMaxAmountToSupply(deployer, collateralAssetData);

      const sexpected = [
        predictedBorrowCostInBorrowAssetRay,
        predictedSupplyIncomeInBorrowAssetRay,
        0,
        BigNumber.from(highEfficientModeEnabled
          ? collateralAssetData.category?.ltv
          : collateralAssetData.data.ltv
        )
          .mul(Misc.WEI)
          .div(getBigNumberFrom(1, 4)),
        BigNumber.from(highEfficientModeEnabled
          ? collateralAssetData.category?.liquidationThreshold
          : collateralAssetData.data.liquidationThreshold
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
      describe("Isolation mode is enabled for collateral, borrow token is borrowable", () => {
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
    });
    describe("Bad paths", () => {
      async function tryGetConversionPlan(badPathsParams: IGetConversionPlanBadPaths) {
        if (!await isPolygonForkInUse()) return;

        const collateralAsset = MaticAddresses.DAI;
        const borrowAsset = MaticAddresses.WMATIC;
        const collateralAmount = getBigNumberFrom(1000, 18);

        await makeGetConversionPlanTest(
          collateralAsset,
          collateralAmount,
          borrowAsset,
          false,
          false,
          10,
          badPathsParams
        );
      }
      describe("incorrect input params", () => {
        describe("collateral token is zero", () => {
          it("should revert", async () =>{
            await expect(
              tryGetConversionPlan({ zeroCollateralAsset: true })
            ).revertedWith("TC-1"); // ZERO_ADDRESS
          });
        });
        describe("borrow token is zero", () => {
          it("should revert", async () =>{
            await expect(
              tryGetConversionPlan({ zeroBorrowAsset: true })
            ).revertedWith("TC-1"); // ZERO_ADDRESS
          });
        });
        describe("healthFactor2_ is less than min allowed", () => {
          it("should revert", async () =>{
            await expect(
              tryGetConversionPlan({ incorrectHealthFactor2: 100 })
            ).revertedWith("TC-3: wrong health factor"); // WRONG_HEALTH_FACTOR
          });
        });
        describe("countBlocks_ is zero", () => {
          it("should revert", async () =>{
            await expect(
              tryGetConversionPlan({ zeroCountBlocks: true })
            ).revertedWith("TC-29"); // INCORRECT_VALUE
          });
        });
        describe("collateralAmount_ is zero", () => {
          it("should revert", async () =>{
            await expect(
              tryGetConversionPlan({ zeroCollateralAmount: true })
            ).revertedWith("TC-29"); // INCORRECT_VALUE
          });
        });
      });
      describe("inactive", () => {
        describe("collateral token is inactive", () => {
          it("should revert", async () =>{
            expect.fail("TODO");
          });
        });
        describe("borrow token is inactive", () => {
          it("should revert", async () =>{
            expect.fail("TODO");
          });
        });
      });
      describe("paused", () => {
        describe("collateral token is paused", () => {
          it("should revert", async () =>{
            expect.fail("TODO");
          });
        });
        describe("borrow token is paused", () => {
          it("should revert", async () =>{
            expect.fail("TODO");
          });
        });
      });
      describe("Borrow token is frozen", () => {
        describe("collateral token is frozen", () => {
          it("should revert", async () =>{
            expect.fail("TODO");
          });
        });
        describe("borrow token is frozen", () => {
          it("should revert", async () =>{
            expect.fail("TODO");
          });
        });
      });
      describe("Not borrowable", () => {
        it("should revert", async () =>{
          expect.fail("TODO");
        });
      });
      describe("Not usable as collateral", () => {
        it("should revert", async () =>{
          expect.fail("TODO");
        });
      });
      describe("Isolation mode is enabled for collateral, borrow token is not borrowable", () => {
        describe("STASIS EURS-2 : SushiToken (PoS)", () => {
          it("should revert", async () =>{
            expect.fail("TODO");
          });
        });
      });
      describe("Try to supply more than allowed by supply cap", () => {
        it("should revert", async () =>{
          expect.fail("TODO");
        });
      });
      describe("Try to borrow more than allowed by borrow cap", () => {
        it("should revert", async () =>{
          expect.fail("TODO");
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
          const part10000 = 3000;

          const r = await makeGetBorrowRateAfterBorrowTest(collateralAsset, borrowAsset, collateralHolders, part10000);

          const ret = areAlmostEqual(r.br, r.brPredicted, 5);
          expect(ret).eq(true);
        });
      });
    });

  });

  describe("initializePoolAdapter", () => {
    interface IInitializePoolAdapterBadPaths {
      useWrongConverter?: boolean;
      wrongCallerOfInitializePoolAdapter?: boolean;
    }
    async function makeInitializePoolAdapterTest(
      useEMode: boolean,
      badParams?: IInitializePoolAdapterBadPaths
    ) : Promise<{ret: string, expected: string}> {
      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = ethers.Wallet.createRandom().address;
      const borrowAsset = ethers.Wallet.createRandom().address;

      const controller = await CoreContractsHelper.createController(deployer);
      const borrowManager = await CoreContractsHelper.createBorrowManager(deployer, controller);
      await controller.setBorrowManager(borrowManager.address);

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
        ).revertedWith("TC-25"); // CONVERTER_NOT_FOUND
      });
      it("should revert if it's called by not borrow-manager", async () => {
        if (!await isPolygonForkInUse()) return;

        await expect(
          makeInitializePoolAdapterTest(
            false,
            {wrongCallerOfInitializePoolAdapter: true}
          )
        ).revertedWith("TC-45"); // BORROW_MANAGER_ONLY
      });
    });
  });
//endregion Unit tests

});