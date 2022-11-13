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
import {AaveTwoHelper} from "../../../scripts/integration/helpers/AaveTwoHelper";
import {AprUtils, COUNT_BLOCKS_PER_DAY} from "../../baseUT/utils/aprUtils";
import {CoreContractsHelper} from "../../baseUT/helpers/CoreContractsHelper";
import {
  AaveTwoPlatformAdapter__factory,
  IAaveTwoPool,
  IAaveTwoProtocolDataProvider,
  IERC20Extended__factory
} from "../../../typechain";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IPlatformActor, PredictBrUsesCase} from "../../baseUT/uses-cases/PredictBrUsesCase";
import {AprAaveTwo, getAaveTwoStateInfo} from "../../baseUT/apr/aprAaveTwo";
import {Misc} from "../../../scripts/utils/Misc";
import {convertUnits} from "../../baseUT/apr/aprUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";

describe("AaveTwoPlatformAdapterTest", () => {
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
      await IERC20Extended__factory.connect(this.collateralAsset, deployer).approve(this.pool.address, collateralAmount);
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
      badPathsParams?: IGetConversionPlanBadPaths
    ) : Promise<{sret: string, sexpected: string}> {
      const countBlocks = 10;
      const controller = await CoreContractsHelper.createController(deployer);
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
        priceCollateral,
        priceBorrow,
        collateralAssetData.data.decimals,
        borrowAssetData.data.decimals
      );
      console.log("AprUtils.getBorrowAmount");
      console.log("collateralAmount", collateralAmount);
      console.log("healthFactor2", healthFactor2);
      console.log("ret.liquidationThreshold18", ret.liquidationThreshold18);
      console.log("priceCollateral", priceCollateral);
      console.log("priceBorrow", priceBorrow);
      console.log("collateralAssetData.data.decimals", collateralAssetData.data.decimals);
      console.log("borrowAssetData.data.decimals", borrowAssetData.data.decimals);

      if (borrowAmount.gt(ret.maxAmountToBorrow)) {
        borrowAmount = ret.maxAmountToBorrow;
      }

      const amountCollateralInBorrowAsset36 =  convertUnits(collateralAmount,
        priceCollateral,
        collateralAssetData.data.decimals,
        priceBorrow,
        36
      );

      // calculate expected supply and borrow values
      const predictedSupplyIncomeInBorrowAssetRay = await AprAaveTwo.predictSupplyIncomeRays(deployer
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
      console.log("predictedSupplyIncomeInBorrowAssetRay", predictedSupplyIncomeInBorrowAssetRay);

      const predictedBorrowCostRay = await AprAaveTwo.predictBorrowCostRays(deployer
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
      console.log("predictedBorrowCostRay", predictedBorrowCostRay);

      const sret = [
        ret.borrowCost36,
        ret.supplyIncomeInBorrowAsset36,
        ret.rewardsAmountInBorrowAsset36,
        ret.ltv18,
        ret.liquidationThreshold18,
        ret.maxAmountToBorrow,
        ret.maxAmountToSupply,
        ret.amountToBorrow,
        ret.amountCollateralInBorrowAsset36
      ].map(x => BalanceUtils.toString(x)) .join("\n");

      const sexpected = [
        predictedBorrowCostRay,
        predictedSupplyIncomeInBorrowAssetRay,
        0,
        BigNumber.from(collateralAssetData.data.ltv)
          .mul(Misc.WEI)
          .div(getBigNumberFrom(1, 4)),
        BigNumber.from(collateralAssetData.data.liquidationThreshold
        )
          .mul(Misc.WEI)
          .div(getBigNumberFrom(1, 4)),
        BigNumber.from(borrowAssetData.liquidity.availableLiquidity),
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

          const collateralAmount = getBigNumberFrom(1000, 18);
          const r = await makeGetConversionPlanTest(collateralAsset, collateralAmount, borrowAsset);

          expect(r.sret).eq(r.sexpected);
        });
      });
      describe("WMATIC: USDT", () => {
        it("should return expected values", async () =>{
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.WMATIC;
          const borrowAsset = MaticAddresses.USDT;
          const collateralAmount = getBigNumberFrom(1000, 18);

          const r = await makeGetConversionPlanTest(collateralAsset, collateralAmount, borrowAsset);

          expect(r.sret).eq(r.sexpected);
        });
      });
      describe("DAI:USDC", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.USDC;
          const collateralAmount = getBigNumberFrom(1000, 18);

          const r = await makeGetConversionPlanTest(collateralAsset, collateralAmount, borrowAsset);

          expect(r.sret).eq(r.sexpected);
        });
      });
      describe("CRV:BALANCER", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.CRV;
          const borrowAsset = MaticAddresses.BALANCER;
          const collateralAmount = getBigNumberFrom(1000, 18);

          const r = await makeGetConversionPlanTest(collateralAsset, collateralAmount, borrowAsset);

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
      // describe("inactive", () => {
      //   describe("collateral token is inactive", () => {
      //     it("should revert", async () =>{
      //       expect.fail("TODO");
      //     });
      //   });
      //   describe("borrow token is inactive", () => {
      //     it("should revert", async () =>{
      //       expect.fail("TODO");
      //     });
      //   });
      // });
      // describe("Borrow token is frozen", () => {
      //   describe("collateral token is frozen", () => {
      //     it("should revert", async () =>{
      //       expect.fail("TODO");
      //     });
      //   });
      //   describe("borrow token is frozen", () => {
      //     it("should revert", async () =>{
      //       expect.fail("TODO");
      //     });
      //   });
      // });
      // describe("Not borrowable", () => {
      //   it("should revert", async () =>{
      //     expect.fail("TODO");
      //   });
      // });
      // describe("Not usable as collateral", () => {
      //   it("should revert", async () =>{
      //     expect.fail("TODO");
      //   });
      // });
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
    interface IInitializePoolAdapterBadPaths {
      useWrongConverter?: boolean;
      wrongCallerOfInitializePoolAdapter?: boolean;
    }
    async function makeInitializePoolAdapterTest(
      badParams?: IInitializePoolAdapterBadPaths
    ) : Promise<{ret: string, expected: string}> {
      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = ethers.Wallet.createRandom().address;
      const borrowAsset = ethers.Wallet.createRandom().address;

      const controller = await CoreContractsHelper.createController(deployer);
      const borrowManager = await CoreContractsHelper.createBorrowManager(deployer, controller);
      await controller.setBorrowManager(borrowManager.address);

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
          : await DeployerUtils.startImpersonate(borrowManager.address)
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
        ).revertedWith("TC-25"); // CONVERTER_NOT_FOUND
      });
      it("should revert if it's called by not borrow-manager", async () => {
        if (!await isPolygonForkInUse()) return;

        await expect(
          makeInitializePoolAdapterTest(
            {wrongCallerOfInitializePoolAdapter: true}
          )
        ).revertedWith("TC-45"); // BORROW_MANAGER_ONLY
      });
    });
  });
//endregion Unit tests

});