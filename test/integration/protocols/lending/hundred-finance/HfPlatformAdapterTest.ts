import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
  IERC20Extended__factory, IHfComptroller, IHfCToken,
  IHfCToken__factory
} from "../../../../../typechain";
import {expect} from "chai";
import {AdaptersHelper} from "../../../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {BalanceUtils} from "../../../../baseUT/utils/BalanceUtils";
import {HundredFinanceHelper} from "../../../../../scripts/integration/helpers/HundredFinanceHelper";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {CoreContractsHelper} from "../../../../baseUT/helpers/CoreContractsHelper";
import {BigNumber} from "ethers";
import {areAlmostEqual} from "../../../../baseUT/utils/CommonUtils";
import {IPlatformActor, PredictBrUsesCase} from "../../../../baseUT/uses-cases/PredictBrUsesCase";

describe("Hundred finance integration tests, platform adapter", () => {
//region Constants
//endregion Constants

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

//region Unit tests
  describe("getConversionPlan", () => {
    async function makeTest(
      collateralAsset: string,
      borrowAsset: string,
      cTokenCollateral: string,
      cTokenBorrow: string
    ) : Promise<{sret: string, sexpected: string}> {
      const controller = await CoreContractsHelper.createController(deployer);
      const templateAdapterNormalStub = ethers.Wallet.createRandom();

      const comptroller = await HundredFinanceHelper.getComptroller(deployer);
      const hfPlatformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
        deployer,
        controller.address,
        comptroller.address,
        templateAdapterNormalStub.address,
        [cTokenCollateral, cTokenBorrow],
        MaticAddresses.HUNDRED_FINANCE_ORACLE
      );

      const collateralAssetData = await HundredFinanceHelper.getCTokenData(deployer, comptroller
        , IHfCToken__factory.connect(cTokenCollateral, deployer)
      );
      const borrowAssetData = await HundredFinanceHelper.getCTokenData(deployer, comptroller
        , IHfCToken__factory.connect(cTokenBorrow, deployer));

      const ret = await hfPlatformAdapter.getConversionPlan(collateralAsset, borrowAsset, 0);

      const sret = [
        ret.aprPerBlock18,
        ret.ltv18,
        ret.liquidationThreshold18,
        ret.maxAmountToBorrowBT,
        ret.maxAmountToSupplyCT,
      ].map(x => BalanceUtils.toString(x)) .join("\n");

      const sexpected = [
        borrowAssetData.borrowRatePerBlock,
        borrowAssetData.collateralFactorMantissa,
        borrowAssetData.collateralFactorMantissa,
        borrowAssetData.cash,
        BigNumber.from(2).pow(256).sub(1), // === type(uint).max
      ].map(x => BalanceUtils.toString(x)) .join("\n");

      return {sret, sexpected};
    }
    describe("Good paths", () => {
      describe("DAI : usdc", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.USDC;
          const collateralCToken = MaticAddresses.hDAI;
          const borrowCToken = MaticAddresses.hUSDC;

          const r = await makeTest(
            collateralAsset,
            borrowAsset,
            collateralCToken,
            borrowCToken
          );

          expect(r.sret).eq(r.sexpected);
        });
      });
    });
    describe("Bad paths", () => {
      describe("inactive", () => {
        describe("collateral token is inactive", () => {
          it("", async () =>{
            expect.fail("TODO");
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
            MaticAddresses.HUNDRED_FINANCE_ORACLE
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