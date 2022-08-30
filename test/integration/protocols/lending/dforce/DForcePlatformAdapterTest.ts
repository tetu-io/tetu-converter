import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
  IERC20Extended__factory,
  IDForceController,
  IDForceCToken,
  IDForceCToken__factory,
  DForcePlatformAdapter__factory,
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
import {areAlmostEqual} from "../../../../baseUT/utils/CommonUtils";
import {TokenDataTypes} from "../../../../baseUT/types/TokenDataTypes";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {SupplyBorrowUsingDForce} from "../../../../baseUT/uses-cases/dforce/SupplyBorrowUsingDForce";
import {DForcePlatformFabric} from "../../../../baseUT/fabrics/DForcePlatformFabric";
import {MocksHelper} from "../../../../baseUT/helpers/MocksHelper";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";

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
      const countBlocks = 10;

      const comptroller = await DForceHelper.getController(deployer);
      const dForcePlatformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
        deployer,
        controller.address,
        comptroller.address,
        templateAdapterNormalStub.address,
        [cTokenCollateral, cTokenBorrow],
      );

      const collateralAssetData = await DForceHelper.getCTokenData(deployer, comptroller
        , IDForceCToken__factory.connect(cTokenCollateral, deployer)
      );
      const borrowAssetData = await DForceHelper.getCTokenData(deployer, comptroller
        , IDForceCToken__factory.connect(cTokenBorrow, deployer));

      console.log("getConversionPlan", collateralAsset, borrowAsset);
      const ret = await dForcePlatformAdapter.getConversionPlan(
        collateralAsset,
        0,
        borrowAsset,
        0,
        countBlocks
      );

      const sret = [
        ret.apr18,
        ret.ltv18,
        ret.liquidationThreshold18,
        ret.maxAmountToBorrowBT,
        ret.maxAmountToSupplyCT,
      ].map(x => BalanceUtils.toString(x)) .join("\n");

      const sexpected = [
        borrowAssetData.borrowRatePerBlock.mul(countBlocks),
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
          const collateralCToken = MaticAddresses.dForce_iDAI;
          const borrowCToken = MaticAddresses.dForce_iUSDC;

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

          const ret = areAlmostEqual(r.br, r.brPredicted, 5);
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

          const ret = areAlmostEqual(r.br, r.brPredicted, 5);
          expect(ret).true;

        });
      });

      describe("Huge amount DAI => WBTS", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          const collateralAsset = MaticAddresses.DAI;
          const collateralCToken = MaticAddresses.dForce_iDAI;
          const borrowAsset = MaticAddresses.WBTS;
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