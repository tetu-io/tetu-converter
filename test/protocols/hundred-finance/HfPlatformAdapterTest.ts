import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  BorrowManager__factory,
  HfAprLibFacade, HfPlatformAdapter__factory,
  IERC20Extended__factory, IHfComptroller, IHfCToken,
  IHfCToken__factory
} from "../../../typechain";
import {expect} from "chai";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {
  HundredFinanceHelper,
  IHundredFinanceMarketData
} from "../../../scripts/integration/helpers/HundredFinanceHelper";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {BigNumber} from "ethers";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IPlatformActor, PredictBrUsesCase} from "../../baseUT/uses-cases/PredictBrUsesCase";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {AprHundredFinance} from "../../baseUT/apr/aprHundredFinance";
import {AprUtils} from "../../baseUT/utils/aprUtils";
import {convertUnits} from "../../baseUT/apr/aprUtils";
import {Misc} from "../../../scripts/utils/Misc";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {IConversionPlan} from "../../baseUT/apr/aprDataTypes";
import {HundredFinanceChangePriceUtils} from "../../baseUT/protocols/hundred-finance/HundredFinanceChangePriceUtils";

describe("Hundred finance integration tests, platform adapter", () => {
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
  class HfPlatformActor implements IPlatformActor {
    borrowCToken: IHfCToken;
    collateralCToken: IHfCToken;
    comptroller: IHfComptroller;
    constructor(
      borrowCToken: IHfCToken,
      collateralCToken: IHfCToken,
      comptroller: IHfComptroller
    ) {
      this.borrowCToken = borrowCToken;
      this.collateralCToken = collateralCToken;
      this.comptroller = comptroller;
    }
    async getAvailableLiquidity() : Promise<BigNumber> {
      const cashBefore = await this.borrowCToken.getCash();
      const borrowBefore = await this.borrowCToken.totalBorrows();
      const reserveBefore = await this.borrowCToken.totalReserves();
      console.log(`Reserve data before: cash=${cashBefore.toString()} borrow=${borrowBefore.toString()} reserve=${reserveBefore.toString()}`);
      return cashBefore;
    }
    async getCurrentBR(): Promise<BigNumber> {
      const br = await this.borrowCToken.borrowRatePerBlock();
      console.log(`BR=${br}`);
      return br;
    }
    async supplyCollateral(collateralAmount: BigNumber): Promise<void> {
      const collateralAsset = await this.collateralCToken.underlying();
      await IERC20Extended__factory.connect(collateralAsset, deployer)
        .approve(this.collateralCToken.address, collateralAmount);
      console.log(`Supply collateral ${collateralAsset} amount ${collateralAmount}`);
      await this.comptroller.enterMarkets([this.collateralCToken.address, this.borrowCToken.address]);
      await this.collateralCToken.mint(collateralAmount);

    }
    async borrow(borrowAmount: BigNumber): Promise<void> {
      await this.borrowCToken.borrow(borrowAmount);
      console.log(`Borrow ${borrowAmount}`);
    }
  }
//endregion IPlatformActor impl

//region getConversionPlan tests impl
  interface IGetConversionPlanBadPaths {
    zeroCollateralAsset?: boolean;
    zeroBorrowAsset?: boolean;
    zeroCountBlocks?: boolean;
    zeroCollateralAmount?: boolean;
    incorrectHealthFactor2?: number;
    setMinBorrowCapacity?: boolean;
    setCollateralMintPaused?: boolean;
    setBorrowPaused?: boolean;
  }

  interface IPreparePlanResults {
    plan: IConversionPlan;
    healthFactor2: number;
    priceCollateral: BigNumber;
    priceBorrow: BigNumber;
    priceCollateral36: BigNumber;
    priceBorrow36: BigNumber;
    comptroller: IHfComptroller;
    countBlocks: number;
    borrowAssetDecimals: number;
    collateralAssetDecimals: number;
    collateralAssetData: IHundredFinanceMarketData;
    borrowAssetData: IHundredFinanceMarketData;
    cTokenBorrow: IHfCToken;
    cTokenCollateral: IHfCToken;
  }

  async function preparePlan(
    collateralAsset: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    collateralCToken: string,
    borrowCToken: string,
    badPathsParams?: IGetConversionPlanBadPaths
  ) : Promise<IPreparePlanResults> {
    const controller = await TetuConverterApp.createController(
      deployer,
      {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
    );
    const templateAdapterNormalStub = ethers.Wallet.createRandom();
    const countBlocks = 10;
    const healthFactor2 = 400;

    const comptroller = await HundredFinanceHelper.getComptroller(deployer);
    const priceOracle = await HundredFinanceHelper.getPriceOracle(deployer);
    const hfPlatformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
      deployer,
      controller.address,
      comptroller.address,
      templateAdapterNormalStub.address,
      [collateralCToken, borrowCToken],
    );
    const cTokenBorrow = IHfCToken__factory.connect(borrowCToken, deployer);
    const cTokenCollateral = IHfCToken__factory.connect(collateralCToken, deployer);
    const borrowAssetDecimals = await (IERC20Extended__factory.connect(borrowAsset, deployer)).decimals();
    const collateralAssetDecimals = await (IERC20Extended__factory.connect(collateralAsset, deployer)).decimals();

    const cTokenCollateralDecimals = await cTokenCollateral.decimals();

    const borrowAssetData = await HundredFinanceHelper.getCTokenData(deployer, comptroller, cTokenBorrow);
    const collateralAssetData = await HundredFinanceHelper.getCTokenData(deployer, comptroller, cTokenCollateral);

    const priceBorrow = await priceOracle.getUnderlyingPrice(borrowCToken);
    const priceCollateral = await priceOracle.getUnderlyingPrice(collateralCToken);
    console.log("priceBorrow", priceBorrow);
    console.log("priceCollateral", priceCollateral);

    const priceBorrow36 = priceBorrow.mul(getBigNumberFrom(1, borrowAssetDecimals));
    const priceCollateral36 = priceCollateral.mul(getBigNumberFrom(1, collateralAssetDecimals));
    console.log("priceBorrow18", priceBorrow36);
    console.log("priceCollateral18", priceCollateral36);

    if (badPathsParams?.setMinBorrowCapacity) {
      await HundredFinanceChangePriceUtils.setBorrowCapacity(deployer, borrowCToken, borrowAssetData.totalBorrows);
    }
    if (badPathsParams?.setCollateralMintPaused) {
      await HundredFinanceChangePriceUtils.setMintPaused(deployer, collateralCToken);
    }
    if (badPathsParams?.setBorrowPaused) {
      await HundredFinanceChangePriceUtils.setBorrowPaused(deployer, borrowCToken);
    }

    const plan = await hfPlatformAdapter.getConversionPlan(
      badPathsParams?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
      badPathsParams?.zeroCollateralAmount ? 0 : collateralAmount,
      badPathsParams?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
      badPathsParams?.incorrectHealthFactor2 || healthFactor2,
      badPathsParams?.zeroCountBlocks ? 0 : countBlocks,
    );

    return {
      plan,
      countBlocks,
      borrowAssetDecimals,
      comptroller,
      collateralAssetDecimals,
      priceCollateral36,
      priceBorrow36,
      borrowAssetData,
      collateralAssetData,
      healthFactor2,
      priceCollateral,
      priceBorrow,
      cTokenBorrow,
      cTokenCollateral
    }
  }

  async function makeTestComparePlanWithDirectCalculations(
    collateralAsset: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    collateralCToken: string,
    borrowCToken: string,
    badPathsParams?: IGetConversionPlanBadPaths
  ) : Promise<{sret: string, sexpected: string}> {
    const d: IPreparePlanResults = await preparePlan(
      collateralAsset,
      collateralAmount,
      borrowAsset,
      collateralCToken,
      borrowCToken,
      badPathsParams
    );

    let amountToBorrow = AprUtils.getBorrowAmount(
      collateralAmount,
      d.healthFactor2,
      d.plan.liquidationThreshold18,
      d.priceCollateral36,
      d.priceBorrow36,
      d.collateralAssetDecimals,
      d.borrowAssetDecimals
    );
    if (amountToBorrow.gt(d.plan.maxAmountToBorrow)) {
      amountToBorrow = d.plan.maxAmountToBorrow;
    }
    console.log("amountToBorrow", amountToBorrow);

    const amountCollateralInBorrowAsset36 =  convertUnits(collateralAmount,
      d.priceCollateral36,
      d.collateralAssetDecimals,
      d.priceBorrow36,
      36
    );

    // predict APR
    const libFacade = await DeployUtils.deployContract(deployer, "HfAprLibFacade") as HfAprLibFacade;
    const borrowRatePredicted = await AprHundredFinance.getEstimatedBorrowRate(libFacade, d.cTokenBorrow, amountToBorrow);
    console.log("borrowRatePredicted", borrowRatePredicted);
    const supplyRatePredicted = await AprHundredFinance.getEstimatedSupplyRate(libFacade, d.cTokenCollateral, collateralAmount);
    console.log("supplyRatePredicted", supplyRatePredicted);

    console.log("libFacade.getSupplyIncomeInBorrowAsset36");
    const supplyIncomeInBorrowAsset36 = await libFacade.getSupplyIncomeInBorrowAsset36(
      supplyRatePredicted,
      d.countBlocks,
      d.collateralAssetDecimals,
      d.priceCollateral36,
      d.priceBorrow36,
      collateralAmount
    );

    const borrowCost36 = await libFacade.getBorrowCost36(
      borrowRatePredicted,
      amountToBorrow,
      d.countBlocks,
      d.borrowAssetDecimals,
    );

    const sret = [
      d.plan.borrowCost36,
      d.plan.supplyIncomeInBorrowAsset36,
      d.plan.rewardsAmountInBorrowAsset36,
      d.plan.ltv18,
      d.plan.liquidationThreshold18,
      d.plan.maxAmountToBorrow,
      d.plan.maxAmountToSupply,
      d.plan.amountToBorrow,
      areAlmostEqual(d.plan.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36)
    ].map(x => BalanceUtils.toString(x)) .join("\n");

    const sexpected = [
      borrowCost36,
      supplyIncomeInBorrowAsset36,
      BigNumber.from(0), // no rewards
      d.borrowAssetData.collateralFactorMantissa,
      d.collateralAssetData.collateralFactorMantissa,
      d.borrowAssetData.cash,
      BigNumber.from(2).pow(256).sub(1), // === type(uint).max
      amountToBorrow,
      true
    ].map(x => BalanceUtils.toString(x)) .join("\n");

    return {sret, sexpected};
  }
//endregion getConversionPlan tests impl

//region Unit tests
  describe("constructor and converters()", () => {
    it("should return expected values", async () => {
      if (!await isPolygonForkInUse()) return;

      const controller = await TetuConverterApp.createController(
        deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const templateAdapterNormalStub = ethers.Wallet.createRandom();

      const comptroller = await HundredFinanceHelper.getComptroller(deployer);
      const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
        deployer,
        controller.address,
        MaticAddresses.HUNDRED_FINANCE_COMPTROLLER,
        templateAdapterNormalStub.address,
        [MaticAddresses.hDAI]
      );

      const ret = [
        await platformAdapter.controller(),
        await platformAdapter.comptroller(),
        await platformAdapter.converter(),
        (await platformAdapter.converters()).join(),
        await platformAdapter.activeAssets(MaticAddresses.DAI),
        await platformAdapter.activeAssets(MaticAddresses.USDC)
      ].join("\n");
      const expected = [
        controller.address,
        comptroller.address,
        templateAdapterNormalStub.address,
        [templateAdapterNormalStub.address].join(),
        MaticAddresses.hDAI,
        Misc.ZERO_ADDRESS
      ].join("\n");

      expect(ret).eq(expected);
    });
  });

  describe("getConversionPlan", () => {
    describe("Good paths", () => {
      describe("DAI : usdc", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const collateralCToken = MaticAddresses.hDAI;
          const collateralAmount = getBigNumberFrom(1000, 18);

          const borrowAsset = MaticAddresses.USDC;
          const borrowCToken = MaticAddresses.hUSDC;

          const r = await makeTestComparePlanWithDirectCalculations(
            collateralAsset,
            collateralAmount,
            borrowAsset,
            collateralCToken,
            borrowCToken
          );

          expect(r.sret).eq(r.sexpected);
        });
      });
      describe("WMATIC : USDC", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.WMATIC;
          const collateralCToken = MaticAddresses.hMATIC;
          const collateralAmount = getBigNumberFrom(1000, 18);

          const borrowAsset = MaticAddresses.USDC;
          const borrowCToken = MaticAddresses.hUSDC;

          const r = await makeTestComparePlanWithDirectCalculations(
            collateralAsset,
            collateralAmount,
            borrowAsset,
            collateralCToken,
            borrowCToken
          );
          console.log(r);

          expect(r.sret).eq(r.sexpected);
        });
      });
    });
    describe("Bad paths", () => {
      async function tryGetConversionPlan(
        badPathsParams: IGetConversionPlanBadPaths,
        collateralAsset: string = MaticAddresses.DAI,
        borrowAsset: string = MaticAddresses.USDC,
        collateralCToken: string = MaticAddresses.hDAI,
        borrowCToken: string = MaticAddresses.hUSDC,
        collateralAmount: BigNumber = getBigNumberFrom(1000, 18)
      ) : Promise<IConversionPlan> {
        return (await preparePlan(
          collateralAsset,
          collateralAmount,
          borrowAsset,
          collateralCToken,
          borrowCToken,
          badPathsParams
        )).plan;
      }
      describe("incorrect input params", () => {
        describe("collateral token is zero", () => {
          it("should revert", async () => {
            if (!await isPolygonForkInUse()) return;

            await expect(
              tryGetConversionPlan({ zeroCollateralAsset: true })
            ).revertedWith("TC-1"); // ZERO_ADDRESS
          });
        });
        describe("borrow token is zero", () => {
          it("should revert", async () => {
            if (!await isPolygonForkInUse()) return;

            await expect(
              tryGetConversionPlan({ zeroBorrowAsset: true })
            ).revertedWith("TC-1"); // ZERO_ADDRESS
          });
        });
        describe("healthFactor2_ is less than min allowed", () => {
          it("should revert", async () => {
            if (!await isPolygonForkInUse()) return;
            await expect(
              tryGetConversionPlan({ incorrectHealthFactor2: 100 })
            ).revertedWith("TC-3: wrong health factor"); // WRONG_HEALTH_FACTOR
          });
        });
        describe("countBlocks_ is zero", () => {
          it("should revert", async () => {
            if (!await isPolygonForkInUse()) return;
            await expect(
              tryGetConversionPlan({ zeroCountBlocks: true })
            ).revertedWith("TC-29"); // INCORRECT_VALUE
          });
        });
        describe("collateralAmount_ is zero", () => {
          it("should revert", async () => {
            if (!await isPolygonForkInUse()) return;
            await expect(
              tryGetConversionPlan({ zeroCollateralAmount: true })
            ).revertedWith("TC-29"); // INCORRECT_VALUE
          });
        });
      });
      describe("cToken is not registered", () => {
        it("should fail if collateral token is not registered", async () => {
          if (!await isPolygonForkInUse()) return;

          expect((await tryGetConversionPlan(
            {},
            MaticAddresses.agEUR
          )).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if borrow token is not registered", async () => {
          if (!await isPolygonForkInUse()) return;

          expect((await tryGetConversionPlan(
            {},
            MaticAddresses.DAI,
            MaticAddresses.agEUR,
          )).converter).eq(Misc.ZERO_ADDRESS);
        });
      });
      describe("capacity", () => {
        it("should return expected maxAmountToBorrow if borrowCapacity is limited", async () => {
          const planBorrowCapacityNotLimited = await tryGetConversionPlan(
            {},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            MaticAddresses.hDAI,
            MaticAddresses.hUSDC,
            getBigNumberFrom(12345, 18)
          );
          console.log("planBorrowCapacityNotLimited", planBorrowCapacityNotLimited);
          const plan = await tryGetConversionPlan(
            {setMinBorrowCapacity: true},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            MaticAddresses.hDAI,
            MaticAddresses.hUSDC,
            getBigNumberFrom(12345, 18)
          );
          console.log("plan", plan);
          const ret = [
            plan.amountToBorrow.eq(plan.maxAmountToBorrow),
            plan.amountToBorrow.lt(planBorrowCapacityNotLimited.maxAmountToBorrow),
            planBorrowCapacityNotLimited.amountToBorrow.lt(planBorrowCapacityNotLimited.maxAmountToBorrow)
          ].join("\n");
          const expected = [true, true, true].join("\n");
          expect(ret).eq(expected);
        });
      });
      describe("paused", () => {
        it("should fail if mintPaused is true for collateral", async () => {
          if (!await isPolygonForkInUse()) return;
          expect((await tryGetConversionPlan({setCollateralMintPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if borrowPaused for borrow", async () => {
          if (!await isPolygonForkInUse()) return;
          expect((await tryGetConversionPlan({setBorrowPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
      });
    });
  });

  describe("getBorrowRateAfterBorrow", () => {
    describe("Good paths", () => {
      async function makeTest(
        collateralAsset: string,
        collateralCToken: string,
        borrowAsset: string,
        borrowCToken: string,
        collateralHolders: string[],
        part10000: number
      ) : Promise<{br: BigNumber, brPredicted: BigNumber}> {
        const borrowToken = IHfCToken__factory.connect(borrowCToken, deployer);
        const collateralToken = IHfCToken__factory.connect(collateralCToken, deployer);
        const comptroller = await HundredFinanceHelper.getComptroller(deployer);
        const templateAdapterNormalStub = ethers.Wallet.createRandom();

        return PredictBrUsesCase.makeTest(
          deployer,
          new HfPlatformActor(borrowToken, collateralToken, comptroller),
          async controller => AdaptersHelper.createHundredFinancePlatformAdapter(
            deployer,
            controller.address,
            comptroller.address,
            templateAdapterNormalStub.address,
            [collateralCToken, borrowCToken],
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
          const collateralCToken = MaticAddresses.hDAI;
          const borrowAsset = MaticAddresses.USDC;
          const borrowCToken = MaticAddresses.hUSDC;

          const collateralHolders = [
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.HOLDER_DAI_2,
            MaticAddresses.HOLDER_DAI_3,
            MaticAddresses.HOLDER_DAI_4,
            MaticAddresses.HOLDER_DAI_5,
            MaticAddresses.HOLDER_DAI_6,
          ];
          const part10000 = 1;

          const r = await makeTest(
            collateralAsset
            , collateralCToken
            , borrowAsset
            , borrowCToken
            , collateralHolders
            , part10000
          );

          const ret = areAlmostEqual(r.br, r.brPredicted, 5);
          expect(ret).eq(true);
        });
      });

      describe("Huge amount", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const collateralCToken = MaticAddresses.hDAI;
          const borrowAsset = MaticAddresses.USDC;
          const borrowCToken = MaticAddresses.hUSDC;

          const collateralHolders = [
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.HOLDER_DAI_2,
            MaticAddresses.HOLDER_DAI_3,
            MaticAddresses.HOLDER_DAI_4,
            MaticAddresses.HOLDER_DAI_5,
            MaticAddresses.HOLDER_DAI_6,
          ];
          const part10000 = 500;

          const r = await makeTest(
            collateralAsset
            , collateralCToken
            , borrowAsset
            , borrowCToken
            , collateralHolders
            , part10000
          );

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
      const collateralAsset = MaticAddresses.DAI;
      const borrowAsset = MaticAddresses.USDC;

      const controller = await TetuConverterApp.createController(
        deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
      const converterNormal = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);

      const comptroller = await HundredFinanceHelper.getComptroller(deployer);
      const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
        deployer,
        controller.address,
        comptroller.address,
        converterNormal.address,
        [MaticAddresses.hDAI, MaticAddresses.hUSDC]
      );

      const poolAdapter = await AdaptersHelper.createHundredFinancePoolAdapter(deployer)
      const platformAdapterAsBorrowManager = HfPlatformAdapter__factory.connect(
        platformAdapter.address,
        badParams?.wrongCallerOfInitializePoolAdapter
          ? await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
          : await DeployerUtils.startImpersonate(borrowManager.address)
      );

      await platformAdapterAsBorrowManager.initializePoolAdapter(
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
        poolAdapterConfigAfter.outCollateralAsset.toLowerCase(),
        poolAdapterConfigAfter.outBorrowAsset.toLowerCase()
      ].join("\n");
      const expected = [
        converterNormal.address,
        user,
        collateralAsset.toLowerCase(),
        borrowAsset.toLowerCase()
      ].join("\n");
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

  describe("registerCTokens", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;

        const controller = await TetuConverterApp.createController(deployer);
        const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
          deployer,
          controller.address,
          HundredFinanceHelper.getComptroller(deployer).address,
          ethers.Wallet.createRandom().address,
          [MaticAddresses.hUSDC, MaticAddresses.hETH]
        );
        await platformAdapter.registerCTokens(
          [MaticAddresses.hDAI, MaticAddresses.hDAI, MaticAddresses.hETH]
        );

        const ret = [
          await platformAdapter.activeAssets(MaticAddresses.USDC),
          await platformAdapter.activeAssets(MaticAddresses.WETH),
          await platformAdapter.activeAssets(MaticAddresses.DAI),
          await platformAdapter.activeAssets(MaticAddresses.USDT), // (!) not registered
        ].join();

        const expected = [
          MaticAddresses.hUSDC,
          MaticAddresses.hETH,
          MaticAddresses.hDAI,
          Misc.ZERO_ADDRESS
        ].join();

        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      describe("Not governance", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;

          const controller = await TetuConverterApp.createController(deployer);
          const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
            deployer,
            controller.address,
            HundredFinanceHelper.getComptroller(deployer).address,
            ethers.Wallet.createRandom().address,
            [MaticAddresses.hUSDC, MaticAddresses.hETH]
          );
          const platformAdapterAsNotGov = HfPlatformAdapter__factory.connect(
            platformAdapter.address,
            await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
          );
          await expect(
            platformAdapterAsNotGov.registerCTokens([MaticAddresses.hUSDT])
          ).revertedWith("TC-9"); // GOVERNANCE_ONLY
        });
      });
      describe("Try to add not CToken", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;

          const controller = await TetuConverterApp.createController(deployer);
          const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
            deployer,
            controller.address,
            HundredFinanceHelper.getComptroller(deployer).address,
            ethers.Wallet.createRandom().address,
            [MaticAddresses.hUSDC, MaticAddresses.hETH]
          );
          await expect(
            platformAdapter.registerCTokens(
              [ethers.Wallet.createRandom().address] // (!)
            )
          ).revertedWithoutReason();
        });
      });
    });
  });

  describe("events", () => {
    it("should emit expected values", async () => {
      if (!await isPolygonForkInUse()) return;

      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = MaticAddresses.DAI;
      const borrowAsset = MaticAddresses.USDC;

      const controller = await TetuConverterApp.createController(deployer);
      const converterNormal = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);
      const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
        deployer,
        controller.address,
        MaticAddresses.HUNDRED_FINANCE_COMPTROLLER,
        converterNormal.address,
        [MaticAddresses.hDAI, MaticAddresses.hUSDC]
      );

      const poolAdapter = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);
      const platformAdapterAsBorrowManager = HfPlatformAdapter__factory.connect(
        platformAdapter.address,
        await DeployerUtils.startImpersonate(await controller.borrowManager())
      );

      function stringsEqualCaseInsensitive(s1: string, s2: string): boolean {
        return s1.toUpperCase() === s2.toUpperCase();
      }
      await expect(
        platformAdapterAsBorrowManager.initializePoolAdapter(
          converterNormal.address,
          poolAdapter.address,
          user,
          collateralAsset,
          borrowAsset
        )
      ).to.emit(platformAdapter, "OnPoolAdapterInitialized").withArgs(
        (s: string) => stringsEqualCaseInsensitive(s, converterNormal.address),
        (s: string) => stringsEqualCaseInsensitive(s, poolAdapter.address),
        (s: string) => stringsEqualCaseInsensitive(s, user),
        (s: string) => stringsEqualCaseInsensitive(s, collateralAsset),
        (s: string) => stringsEqualCaseInsensitive(s, borrowAsset)
      );
    });
  });
//endregion Unit tests

});