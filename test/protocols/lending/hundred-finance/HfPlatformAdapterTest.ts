import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  HfAprLibFacade,
  IERC20Extended__factory, IHfComptroller, IHfCToken,
  IHfCToken__factory
} from "../../../../typechain";
import {expect} from "chai";
import {AdaptersHelper} from "../../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../../baseUT/utils/NetworkUtils";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";
import {HundredFinanceHelper} from "../../../../scripts/integration/helpers/HundredFinanceHelper";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {CoreContractsHelper} from "../../../baseUT/helpers/CoreContractsHelper";
import {BigNumber} from "ethers";
import {areAlmostEqual, toMantissa} from "../../../baseUT/utils/CommonUtils";
import {IPlatformActor, PredictBrUsesCase} from "../../../baseUT/uses-cases/PredictBrUsesCase";
import {Misc} from "../../../../scripts/utils/Misc";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {AprHundredFinance, getHfStateInfo} from "../../../baseUT/apr/aprHundredFinance";

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
  async function makeTestComparePlanWithDirectCalculations(
    collateralAsset: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    collateralCToken: string,
    borrowCToken: string
  ) : Promise<{sret: string, sexpected: string}> {
    const controller = await CoreContractsHelper.createController(deployer);
    const templateAdapterNormalStub = ethers.Wallet.createRandom();
    const countBlocks = 10;
    const healthFactor18 = getBigNumberFrom(4, 18);

    const comptroller = await HundredFinanceHelper.getComptroller(deployer);
    const priceOracle = await HundredFinanceHelper.getPriceOracle(deployer);
    const hfPlatformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
      deployer,
      controller.address,
      comptroller.address,
      templateAdapterNormalStub.address,
      [collateralCToken, borrowCToken],
      priceOracle.address
    );
    const cTokenBorrow = IHfCToken__factory.connect(borrowCToken, deployer);
    const cTokenCollateral = IHfCToken__factory.connect(collateralCToken, deployer);
    const borrowAssetDecimals = await (IERC20Extended__factory.connect(borrowAsset, deployer)).decimals();
    const collateralAssetDecimals = await (IERC20Extended__factory.connect(collateralAsset, deployer)).decimals();

    const cTokenBorrowDecimals = await cTokenBorrow.decimals();
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

    const borrowAmountFactor18 = Misc.WEI
      .mul(toMantissa(collateralAmount, await cTokenCollateral.decimals(), 18))
      .div(healthFactor18);
    console.log("borrowAmountFactor18", borrowAmountFactor18, collateralAmount);

    const ret = await hfPlatformAdapter.getConversionPlan(collateralAsset,
      collateralAmount,
      borrowAsset,
      borrowAmountFactor18,
      countBlocks
    );

    const amountToBorrow18 = borrowAmountFactor18
      .mul(ret.liquidationThreshold18)
      .div(Misc.WEI);
    let amountToBorrow = toMantissa(amountToBorrow18, 18, await cTokenBorrow.decimals());
    if (amountToBorrow.gt(ret.maxAmountToBorrowBT)) {
      amountToBorrow = ret.maxAmountToBorrowBT;
    }
    console.log("amountToBorrow", amountToBorrow);

    // predict APR
    const libFacade = await DeployUtils.deployContract(deployer, "HfAprLibFacade") as HfAprLibFacade;
    const borrowRatePredicted = await AprHundredFinance.getEstimatedBorrowRate(libFacade
      , cTokenBorrow
      , amountToBorrow
    );
    console.log("borrowRatePredicted", borrowRatePredicted);
    const supplyRatePredicted = await AprHundredFinance.getEstimatedSupplyRate(libFacade
      , cTokenCollateral
      , collateralAmount
    );
    console.log("supplyRatePredicted", supplyRatePredicted);

    console.log("libFacade.getSupplyApr36");
    const supplyApr = await libFacade.getSupplyApr36(
      supplyRatePredicted
      , countBlocks
      , collateralAssetDecimals
      , priceCollateral36
      , priceBorrow36
      , collateralAmount
    );
    console.log("supplyRatePredicted", supplyRatePredicted);
    console.log("countBlocks", countBlocks);
    console.log("cTokenCollateralDecimals", cTokenCollateralDecimals);
    console.log("priceCollateral18", priceCollateral36);
    console.log("priceBorrow18", priceBorrow36);
    console.log("collateralAmount", collateralAmount);

    const borrowApr = await libFacade.getBorrowApr36(
      borrowRatePredicted
      , amountToBorrow
      , countBlocks
      , borrowAssetDecimals
    );

    const sret = [
      ret.borrowApr36,
      ret.supplyAprBt36,
      ret.rewardsAmountBt36,
      ret.ltv18,
      ret.liquidationThreshold18,
      ret.maxAmountToBorrowBT,
      ret.maxAmountToSupplyCT,
    ].map(x => BalanceUtils.toString(x)) .join("\n");

    const sexpected = [
      borrowApr,
      supplyApr,
      BigNumber.from(0), // no rewards
      borrowAssetData.collateralFactorMantissa,
      collateralAssetData.collateralFactorMantissa,
      borrowAssetData.cash,
      BigNumber.from(2).pow(256).sub(1), // === type(uint).max
    ].map(x => BalanceUtils.toString(x)) .join("\n");

    return {sret, sexpected};
  }
//endregion getConversionPlan tests impl

//region Unit tests
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
      describe("inactive", () => {
        describe("collateral token is inactive", () => {
          it("", async () =>{
            //TODO: expect.fail("TODO");
          });
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

        return await PredictBrUsesCase.makeTest(
          deployer,
          new HfPlatformActor(borrowToken, collateralToken, comptroller),
          async controller => await AdaptersHelper.createHundredFinancePlatformAdapter(
            deployer,
            controller.address,
            comptroller.address,
            templateAdapterNormalStub.address,
            [collateralCToken, borrowCToken],
            MaticAddresses.HUNDRED_FINANCE_PRICE_ORACLE
          ),
          collateralAsset,
          borrowAsset,
          collateralHolders,
          part10000
        );
      }

      describe("small amount", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
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
          expect(ret).true;
        });
      });

      describe("Huge amount", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
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
          expect(ret).true;
        });
      });
    });

  });
//endregion Unit tests

});