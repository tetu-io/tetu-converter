import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
  IERC20Extended__factory,
  IDForceController,
  IDForceCToken,
  IDForceCToken__factory,
  DForcePlatformAdapter__factory, IDForceInterestRateModel__factory, DForceAprLibFacade,
} from "../../../../../typechain";
import {expect} from "chai";
import {AdaptersHelper} from "../../../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {BalanceUtils} from "../../../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {CoreContractsHelper} from "../../../../baseUT/helpers/CoreContractsHelper";
import {BigNumber} from "ethers";
import {IPlatformActor, PredictBrUsesCase} from "../../../../baseUT/uses-cases/PredictBrUsesCase";
import {DForceHelper} from "../../../../../scripts/integration/helpers/DForceHelper";
import {areAlmostEqual, toMantissa} from "../../../../baseUT/utils/CommonUtils";
import {TokenDataTypes} from "../../../../baseUT/types/TokenDataTypes";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {SupplyBorrowUsingDForce} from "../../../../baseUT/uses-cases/dforce/SupplyBorrowUsingDForce";
import {DForcePlatformFabric} from "../../../../baseUT/fabrics/DForcePlatformFabric";
import {MocksHelper} from "../../../../baseUT/helpers/MocksHelper";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {DeployUtils} from "../../../../../scripts/utils/DeployUtils";
import {AprDForce, getDForceStateInfo} from "../../../../baseUT/apr/aprDForce";
import {Misc} from "../../../../../scripts/utils/Misc";

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

    return await PredictBrUsesCase.makeTest(
      deployer,
      new DForcePlatformActor(collateralToken, borrowToken, comptroller),
      async controller => await AdaptersHelper.createHundredFinancePlatformAdapter(
        deployer,
        controller.address,
        comptroller.address,
        templateAdapterNormalStub.address,
        [collateralCToken, borrowCToken],
        MaticAddresses.HUNDRED_FINANCE_ORACLE
      ),
      collateralAsset,
      borrowAsset,
      collateralHolders,
      part10000
    );
  }
//endregion Test predict-br impl

//region Get conversion plan test impl
  /**
   * Ensure, that getConversionPlan returns same APR
   * as directly calculated one using DForceAprLibFacade
   */
  async function makeTestComparePlanWithDirectCalculations(
    collateralAsset: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    collateralCToken: string,
    borrowCToken: string
  ) : Promise<{sret: string, sexpected: string}> {
    const controller = await CoreContractsHelper.createController(deployer);
    const countBlocks = 10;
    const healthFactor18 = getBigNumberFrom(4, 18);

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

    const cTokenBorrowDecimals = await cTokenBorrow.decimals();
    const cTokenCollateralDecimals = await cTokenCollateral.decimals();

    // getUnderlyingPrice returns price/1e(36-underlineDecimals)
    const priceBorrow = await priceOracle.getUnderlyingPrice(borrowCToken);
    const priceCollateral = await priceOracle.getUnderlyingPrice(collateralCToken);
    console.log("priceBorrow", priceBorrow);
    console.log("priceCollateral", priceCollateral);

    const priceBorrow18 = (priceBorrow)
      .mul(getBigNumberFrom(1, cTokenBorrowDecimals))
      .div(getBigNumberFrom(1, 18));
    const priceCollateral18 = (priceCollateral)
      .mul(getBigNumberFrom(1, cTokenCollateralDecimals))
      .div(Misc.WEI);
    console.log("priceBorrow18", priceBorrow18);
    console.log("priceCollateral18", priceCollateral18);

    const collateralAssetData = await DForceHelper.getCTokenData(deployer, comptroller, cTokenCollateral);
    console.log("collateralAssetData", collateralAssetData);
    const borrowAssetData = await DForceHelper.getCTokenData(deployer, comptroller, cTokenBorrow);
    console.log("borrowAssetData", borrowAssetData);

    const borrowAmountFactor18 = Misc.WEI
      .mul(toMantissa(collateralAmount, await cTokenCollateral.decimals(), 18))
      .mul(priceCollateral18)
      .div(priceBorrow18)
      .div(healthFactor18);
    console.log("borrowAmountFactor18", borrowAmountFactor18, collateralAmount);

    const ret = await dForcePlatformAdapter.getConversionPlan(
      collateralAsset,
      collateralAmount,
      borrowAsset,
      borrowAmountFactor18,
      countBlocks
    );
    console.log("getConversionPlan", ret);

    const amountToBorrow18 = borrowAmountFactor18
      .mul(ret.liquidationThreshold18)
      .div(Misc.WEI);
    let amountToBorrow = toMantissa(amountToBorrow18, 18, await cTokenBorrow.decimals());
    if (amountToBorrow.gt(ret.maxAmountToBorrowBT)) {
      amountToBorrow = ret.maxAmountToBorrowBT;
    }

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
    const supplyApr = await libFacade.getSupplyApr36(
      supplyRatePredicted
      , countBlocks
      , cTokenCollateralDecimals
      , priceCollateral18
      , priceBorrow18
      , collateralAmount
    );
    const borrowApr = await libFacade.getBorrowApr36(
      borrowRatePredicted
      , amountToBorrow
      , countBlocks
      , cTokenBorrowDecimals
    );

    const sret = [
      ret.borrowApr36,
      ret.supplyAprBt36,
      ret.ltv18,
      ret.liquidationThreshold18,
      ret.maxAmountToBorrowBT,
      ret.maxAmountToSupplyCT,
    ].map(x => BalanceUtils.toString(x)) .join("\n");
    console.log("amountToBorrow", amountToBorrow);
    console.log("borrowAssetData.borrowRatePerBlock", borrowAssetData.borrowRatePerBlock);
    console.log("countBlocks", countBlocks);

    const sexpected = [
      borrowApr,
      supplyApr,
      collateralAssetData.collateralFactorMantissa
        .mul(borrowAssetData.borrowFactorMantissa)
        .div(Misc.WEI),
      collateralAssetData.collateralFactorMantissa,
      borrowAssetData.cash,
      BigNumber.from(2).pow(256).sub(1), // === type(uint).max
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
      describe("inactive", () => {
        describe("collateral token is inactive", () => {
          it("", async () =>{
            //expect.fail("TODO");
          });
        });
      });
    });
  });

  describe("getBorrowRateAfterBorrow", () => {
    describe("Good paths", () => {
      describe("small amount DAI => USDC", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
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
          expect(ret).true;
        });
      });

      describe("Huge amount DAI => USDC", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
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
          expect(ret).true;

        });
      });

      describe("Huge amount DAI => WBTC", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
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
          expect(ret).true;
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
          const controller = await CoreContractsHelper.createController(deployer);
          const bm = await CoreContractsHelper.createBorrowManager(deployer, controller);
          const dm = await MocksHelper.createDebtsMonitorStub(deployer, false);
          await controller.setBorrowManager(bm.address);
          await controller.setDebtMonitor(dm.address);

          const fabric: DForcePlatformFabric = new DForcePlatformFabric();
          await fabric.createAndRegisterPools(deployer, controller);
          console.log("Count registered platform adapters", await bm.platformAdaptersLength());

          const platformAdapter = DForcePlatformAdapter__factory.connect(
            await bm.platformAdaptersAt(0)
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
//endregion Unit tests

});