import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  IERC20Extended__factory,
  IDForceController,
  IDForceCToken,
  IDForceCToken__factory,
  DForcePlatformAdapter__factory, DForceAprLibFacade, BorrowManager__factory,
} from "../../../typechain";
import {expect} from "chai";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {BigNumber} from "ethers";
import {IPlatformActor, PredictBrUsesCase} from "../../baseUT/uses-cases/PredictBrUsesCase";
import {DForceHelper} from "../../../scripts/integration/helpers/DForceHelper";
import {areAlmostEqual, toMantissa} from "../../baseUT/utils/CommonUtils";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {SupplyBorrowUsingDForce} from "../../baseUT/uses-cases/dforce/SupplyBorrowUsingDForce";
import {DForcePlatformFabric} from "../../baseUT/fabrics/DForcePlatformFabric";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {AprDForce, getDForceStateInfo} from "../../baseUT/apr/aprDForce";
import {Misc} from "../../../scripts/utils/Misc";
import {AprUtils} from "../../baseUT/utils/aprUtils";
import {convertUnits} from "../../baseUT/apr/aprUtils";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";

describe("DForce integration tests, platform adapter", () => {
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
  class DForcePlatformActor implements IPlatformActor {
    collateralCToken: IDForceCToken;
    borrowCToken: IDForceCToken;
    comptroller: IDForceController;
    constructor(
      collateralCToken: IDForceCToken,
      borrowCToken: IDForceCToken,
      comptroller: IDForceController
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
      await this.collateralCToken.mint(deployer.address, collateralAmount);

    }
    async borrow(borrowAmount: BigNumber): Promise<void> {
      await this.borrowCToken.borrow(borrowAmount);
      console.log(`Borrow ${borrowAmount}`);
    }
  }
//endregion IPlatformActor impl

//region Test predict-br impl
  async function makePredictBrTest(
    collateralAsset: string,
    collateralCToken: string,
    borrowAsset: string,
    borrowCToken: string,
    collateralHolders: string[],
    part10000: number
  ) : Promise<{br: BigNumber, brPredicted: BigNumber}> {
    const collateralToken = IDForceCToken__factory.connect(collateralCToken, deployer);
    const borrowToken = IDForceCToken__factory.connect(borrowCToken, deployer);
    const comptroller = await DForceHelper.getController(deployer);
    const templateAdapterNormalStub = ethers.Wallet.createRandom();

    return PredictBrUsesCase.makeTest(
      deployer,
      new DForcePlatformActor(collateralToken, borrowToken, comptroller),
      async controller => AdaptersHelper.createDForcePlatformAdapter(
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
//endregion Test predict-br impl

//region Get conversion plan test impl
  interface IGetConversionPlanBadPaths {
    zeroCollateralAsset?: boolean;
    zeroBorrowAsset?: boolean;
    zeroCountBlocks?: boolean;
    zeroCollateralAmount?: boolean;
    incorrectHealthFactor2?: number;
  }
  /**
   * Ensure, that getConversionPlan returns same APR
   * as directly calculated one using DForceAprLibFacade
   */
  async function makeTestComparePlanWithDirectCalculations(
    collateralAsset: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    collateralCToken: string,
    borrowCToken: string,
    badPathsParams?: IGetConversionPlanBadPaths
  ) : Promise<{sret: string, sexpected: string}> {
    const controller = await TetuConverterApp.createController(
      deployer,
      {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
    );
    const countBlocks = 10;
    const healthFactor2 = 400;

    const comptroller = await DForceHelper.getController(deployer);
    const dForcePlatformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
      deployer,
      controller.address,
      comptroller.address,
      ethers.Wallet.createRandom().address,
      [collateralCToken, borrowCToken],
    );
    const priceOracle = await DForceHelper.getPriceOracle(comptroller, deployer);
    const cTokenBorrow = IDForceCToken__factory.connect(borrowCToken, deployer);
    const cTokenCollateral = IDForceCToken__factory.connect(collateralCToken, deployer);

    const borrowAssetDecimals = await (IERC20Extended__factory.connect(borrowAsset, deployer)).decimals();
    const collateralAssetDecimals = await (IERC20Extended__factory.connect(collateralAsset, deployer)).decimals();

    // getUnderlyingPrice returns price/1e(36-underlineDecimals)
    const priceBorrow = await priceOracle.getUnderlyingPrice(borrowCToken);
    const priceCollateral = await priceOracle.getUnderlyingPrice(collateralCToken);
    console.log("priceBorrow", priceBorrow);
    console.log("priceCollateral", priceCollateral);

    const priceBorrow36 = priceBorrow.mul(getBigNumberFrom(1, borrowAssetDecimals));
    const priceCollateral36 = priceCollateral.mul(getBigNumberFrom(1, collateralAssetDecimals));
    console.log("priceBorrow18", priceBorrow36);
    console.log("priceCollateral18", priceCollateral36);

    const collateralAssetData = await DForceHelper.getCTokenData(deployer, comptroller, cTokenCollateral);
    console.log("collateralAssetData", collateralAssetData);
    const borrowAssetData = await DForceHelper.getCTokenData(deployer, comptroller, cTokenBorrow);
    console.log("borrowAssetData", borrowAssetData);

    const ret = await dForcePlatformAdapter.getConversionPlan(
      badPathsParams?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
      badPathsParams?.zeroCollateralAmount ? 0 : collateralAmount,
      badPathsParams?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
      badPathsParams?.incorrectHealthFactor2 || healthFactor2,
      badPathsParams?.zeroCountBlocks ? 0 : countBlocks,
    );
    console.log("getConversionPlan", ret);

    let amountToBorrow = AprUtils.getBorrowAmount(
      collateralAmount,
      healthFactor2,
      ret.liquidationThreshold18,
      priceCollateral36,
      priceBorrow36,
      collateralAssetDecimals,
      borrowAssetDecimals
    );
    if (amountToBorrow.gt(ret.maxAmountToBorrow)) {
      amountToBorrow = ret.maxAmountToBorrow;
    }

    const amountCollateralInBorrowAsset36 =  convertUnits(collateralAmount,
      priceCollateral36,
      collateralAssetDecimals,
      priceBorrow36,
      36
    );
    console.log("collateralAmount", collateralAmount);
    console.log("priceCollateral", priceCollateral);
    console.log("priceBorrow", priceBorrow);
    console.log("collateralAssetDecimals", collateralAssetDecimals);

    // predict APR
    const libFacade = await DeployUtils.deployContract(deployer, "DForceAprLibFacade") as DForceAprLibFacade;
    const borrowRatePredicted = await AprDForce.getEstimatedBorrowRate(libFacade
      , cTokenBorrow
      , amountToBorrow
    );
    const supplyRatePredicted = await AprDForce.getEstimatedSupplyRate(libFacade
      , await getDForceStateInfo(comptroller, cTokenCollateral, cTokenBorrow, Misc.ZERO_ADDRESS)
      , collateralAmount
      , await cTokenCollateral.interestRateModel()
    );
    const supplyIncomeInBorrowAsset36 = await libFacade.getSupplyIncomeInBorrowAsset36(
      supplyRatePredicted
      , countBlocks
      , collateralAssetDecimals
      , priceCollateral36
      , priceBorrow36
      , collateralAmount
    );
    const borrowCost36 = await libFacade.getBorrowCost36(
      borrowRatePredicted
      , amountToBorrow
      , countBlocks
      , borrowAssetDecimals
    );

    const sret = [
      ret.borrowCost36,
      ret.supplyIncomeInBorrowAsset36,
      ret.ltv18,
      ret.liquidationThreshold18,
      ret.maxAmountToBorrow,
      ret.maxAmountToSupply,
      ret.amountToBorrow,
      ret.amountCollateralInBorrowAsset36
    ].map(x => BalanceUtils.toString(x)) .join("\n");
    console.log("amountToBorrow", amountToBorrow);
    console.log("borrowAssetData.borrowRatePerBlock", borrowAssetData.borrowRatePerBlock);
    console.log("countBlocks", countBlocks);

    const sexpected = [
      borrowCost36,
      supplyIncomeInBorrowAsset36,
      collateralAssetData.collateralFactorMantissa
        .mul(borrowAssetData.borrowFactorMantissa)
        .div(Misc.WEI),
      collateralAssetData.collateralFactorMantissa,
      borrowAssetData.cash,
      BigNumber.from(2).pow(256).sub(1), // === type(uint).max
      amountToBorrow,
      amountCollateralInBorrowAsset36,
    ].map(x => BalanceUtils.toString(x)) .join("\n");

    return {sret, sexpected};
  }
//endregion Get conversion plan test impl

//region Unit tests
  describe("getConversionPlan", () => {
    describe("Good paths", () => {
      describe("DAI : usdc", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.USDC;
          const collateralCToken = MaticAddresses.dForce_iDAI;
          const borrowCToken = MaticAddresses.dForce_iUSDC;

          const collateralAmount = getBigNumberFrom(1000, 18);
          const ret = await makeTestComparePlanWithDirectCalculations(
            collateralAsset,
            collateralAmount,
            borrowAsset,
            collateralCToken,
            borrowCToken
          );
          console.log(ret);

          expect(ret.sret).eq(ret.sexpected);
        });
      });
      describe("USDC : USDT", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.USDC;
          const collateralCToken = MaticAddresses.dForce_iUSDC;

          const borrowAsset = MaticAddresses.USDT;
          const borrowCToken = MaticAddresses.dForce_iUSDT;

          const collateralAmount = getBigNumberFrom(100, 6);
          const ret = await makeTestComparePlanWithDirectCalculations(
            collateralAsset,
            collateralAmount,
            borrowAsset,
            collateralCToken,
            borrowCToken
          );
          console.log(ret);

          expect(ret.sret).eq(ret.sexpected);
        });
      });
      describe("WMATIC : USDC", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.WMATIC;
          const collateralCToken = MaticAddresses.dForce_iMATIC;

          const borrowAsset = MaticAddresses.USDC;
          const borrowCToken = MaticAddresses.dForce_iUSDC;

          const collateralAmount = getBigNumberFrom(100, 18);
          const ret = await makeTestComparePlanWithDirectCalculations(
            collateralAsset,
            collateralAmount,
            borrowAsset,
            collateralCToken,
            borrowCToken
          );
          console.log(ret);

          expect(ret.sret).eq(ret.sexpected);
        });
      });
    });
    describe("Bad paths", () => {
      async function tryGetConversionPlan(badPathsParams: IGetConversionPlanBadPaths) {
        if (!await isPolygonForkInUse()) return;

        const collateralAsset = MaticAddresses.DAI;
        const borrowAsset = MaticAddresses.USDC;
        const collateralCToken = MaticAddresses.dForce_iDAI;
        const borrowCToken = MaticAddresses.dForce_iUSDC;
        const collateralAmount = getBigNumberFrom(1000, 18);

        await makeTestComparePlanWithDirectCalculations(
          collateralAsset,
          collateralAmount,
          borrowAsset,
          collateralCToken,
          borrowCToken,
          badPathsParams
        );
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
          it("should revert", async () =>{
            if (!await isPolygonForkInUse()) return;

            await expect(
              tryGetConversionPlan({ zeroBorrowAsset: true })
            ).revertedWith("TC-1"); // ZERO_ADDRESS
          });
        });
        describe("healthFactor2_ is less than min allowed", () => {
          it("should revert", async () =>{
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
      describe("inactive", () => {
        describe("collateral token is inactive", () => {
          it("", async () =>{
            // expect.fail("TODO");
          });
        });
      });
    });
  });

  describe("getBorrowRateAfterBorrow", () => {
    describe("Good paths", () => {
      describe("small amount DAI => USDC", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const collateralCToken = MaticAddresses.dForce_iDAI;
          const borrowAsset = MaticAddresses.USDC;
          const borrowCToken = MaticAddresses.dForce_iUSDC;

          const collateralHolders = [
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.HOLDER_DAI_2,
            MaticAddresses.HOLDER_DAI_3,
            MaticAddresses.HOLDER_DAI_4,
            MaticAddresses.HOLDER_DAI_5,
            MaticAddresses.HOLDER_DAI_6,
          ];
          const part10000 = 1;

          const r = await makePredictBrTest(
            collateralAsset
            , collateralCToken
            , borrowAsset
            , borrowCToken
            , collateralHolders
            , part10000
          );

          const ret = areAlmostEqual(r.br, r.brPredicted, 4);
          expect(ret).eq(true);
        });
      });

      describe("Huge amount DAI => USDC", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const collateralCToken = MaticAddresses.dForce_iDAI;
          const borrowAsset = MaticAddresses.USDC;
          const borrowCToken = MaticAddresses.dForce_iUSDC;

          const collateralHolders = [
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.HOLDER_DAI_2,
            MaticAddresses.HOLDER_DAI_3,
            MaticAddresses.HOLDER_DAI_4,
            MaticAddresses.HOLDER_DAI_5,
            MaticAddresses.HOLDER_DAI_6,
          ];
          const part10000 = 500;

          const r = await makePredictBrTest(
            collateralAsset
            , collateralCToken
            , borrowAsset
            , borrowCToken
            , collateralHolders
            , part10000
          );

          const ret = areAlmostEqual(r.br, r.brPredicted, 4);
          expect(ret).eq(true);

        });
      });

      describe("Huge amount DAI => WBTC", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const collateralCToken = MaticAddresses.dForce_iDAI;
          const borrowAsset = MaticAddresses.WBTC;
          const borrowCToken = MaticAddresses.dForce_iWBTC;

          const collateralHolders = [
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.HOLDER_DAI_2,
            MaticAddresses.HOLDER_DAI_3,
            MaticAddresses.HOLDER_DAI_4,
            MaticAddresses.HOLDER_DAI_5,
            MaticAddresses.HOLDER_DAI_6,
          ];
          const part10000 = 500;

          const r = await makePredictBrTest(
            collateralAsset
            , collateralCToken
            , borrowAsset
            , borrowCToken
            , collateralHolders
            , part10000
          );

          const ret = areAlmostEqual(r.br, r.brPredicted, 4);
          expect(ret).eq(true);
        });
      });
    });
  });

  describe("getRewardAmounts", () => {
    describe("Good paths", () => {
      describe("Supply, wait, get rewards", () => {
        it("should return amount of rewards same to really received", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const collateralHolder = MaticAddresses.HOLDER_DAI;
          const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

          const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
          const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);

          const collateralAmount = getBigNumberFrom(20_000, collateralToken.decimals);
          const periodInBlocks = 1_000;

          // use DForce-platform adapter to predict amount of rewards
          const controller = await TetuConverterApp.createController(
            deployer,
            {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
          );
          const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);

          const fabric: DForcePlatformFabric = new DForcePlatformFabric();
          await fabric.createAndRegisterPools(deployer, controller);
          console.log("Count registered platform adapters", await borrowManager.platformAdaptersLength());

          const platformAdapter = DForcePlatformAdapter__factory.connect(
            await borrowManager.platformAdaptersAt(0)
            , deployer
          );
          console.log("Platform adapter is created", platformAdapter.address);
          const user = await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address);
          console.log("user", user.address);

          // make supply, wait period, get actual amount of rewards
          const r = await SupplyBorrowUsingDForce.makeSupplyRewardsTestMinimumTransactions(
            deployer
            , user
            , collateralToken
            , collateralCToken
            , collateralHolder
            , collateralAmount
            , periodInBlocks
          );

          const pst = DForceHelper.predictRewardsStatePointAfterSupply(r.supplyPoint);
          const ret = DForceHelper.getSupplyRewardsAmount(pst, r.blockUpdateDistributionState);

          const sret = [
            ret.rewardsAmount.toString()
          ].join("\n");
          const sexpected = [
            r.rewardsEarnedActual.toString()
          ].join("\n");

          expect(sret).eq(sexpected);
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

      const converterNormal = await AdaptersHelper.createDForcePoolAdapter(deployer);

      const comptroller = await DForceHelper.getController(deployer);
      const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
        deployer,
        controller.address,
        comptroller.address,
        converterNormal.address,
        [MaticAddresses.dForce_iDAI, MaticAddresses.dForce_iUSDC]
      );

      const poolAdapter = await AdaptersHelper.createDForcePoolAdapter(deployer)
      const platformAdapterAsBorrowManager = DForcePlatformAdapter__factory.connect(
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
        const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
          deployer,
          controller.address,
          DForceHelper.getController(deployer).address,
          ethers.Wallet.createRandom().address,
          [MaticAddresses.dForce_iUSDC, MaticAddresses.dForce_iWETH]
        );
        await platformAdapter.registerCTokens(
          [MaticAddresses.dForce_iCRV, MaticAddresses.dForce_iCRV, MaticAddresses.dForce_iWETH]
        );

        const ret = [
          await platformAdapter.activeAssets(MaticAddresses.USDC),
          await platformAdapter.activeAssets(MaticAddresses.WETH),
          await platformAdapter.activeAssets(MaticAddresses.CRV),
          await platformAdapter.activeAssets(MaticAddresses.USDT), // (!) not registered
        ].join();

        const expected = [
          MaticAddresses.dForce_iUSDC,
          MaticAddresses.dForce_iWETH,
          MaticAddresses.dForce_iCRV,
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
          const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
            deployer,
            controller.address,
            DForceHelper.getController(deployer).address,
            ethers.Wallet.createRandom().address,
            [MaticAddresses.dForce_iUSDC, MaticAddresses.dForce_iWETH]
          );
          const platformAdapterAsNotGov = DForcePlatformAdapter__factory.connect(
            platformAdapter.address,
            await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
          );
          await expect(
            platformAdapterAsNotGov.registerCTokens(
              [MaticAddresses.dForce_iCRV, MaticAddresses.dForce_iCRV, MaticAddresses.dForce_iWETH]
            )
          ).revertedWith("TC-9"); // GOVERNANCE_ONLY
        });
      });
      describe("Try to add not CToken", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;

          const controller = await TetuConverterApp.createController(deployer);
          const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
            deployer,
            controller.address,
            DForceHelper.getController(deployer).address,
            ethers.Wallet.createRandom().address,
            [MaticAddresses.dForce_iUSDC, MaticAddresses.dForce_iWETH]
          );
          await expect(
            platformAdapter.registerCTokens(
              [ethers.Wallet.createRandom().address] // (!)
            )
          ).revertedWith("");
        });
      });
    });
  });
//endregion Unit tests

});