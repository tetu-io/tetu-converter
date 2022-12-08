import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {
  IBorrowRewardsPredictionInput,
  ISupplyRewardsStatePoint
} from "../../../scripts/integration/helpers/DForceHelper";
import {BigNumber} from "ethers";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {DForceAprLibFacade} from "../../../typechain";
import {parseUnits} from "ethers/lib/utils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {DForceChangePriceUtils} from "../../baseUT/protocols/dforce/DForceChangePriceUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";

describe("DForceHelper unit tests", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let investor: SignerWithAddress;
  let libFacade: DForceAprLibFacade;

//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    investor = signers[0];
    if (!await isPolygonForkInUse()) return;
    libFacade = await DeployUtils.deployContract(deployer, "DForceAprLibFacade") as DForceAprLibFacade;
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

//region Unit tests
  describe("DForceRewardsLib unit tests", () => {
    describe("supplyRewardAmounts", () => {
      describe("Use data generated by DForceHelper tests ", () => {
        it("should return amount of rewards same to really received", async () => {
          if (!await isPolygonForkInUse()) return;
          ///////////////////////////////////////////////////////
          // The data below was generated by DForceHelperTest
          // using SupplyBorrowUsingDForce.makeSupplyRewardsTestMinimumTransactions
          // variables supplyPoint and blockUpdateDistributionState
          // see "Test1. Supply, wait, get rewards"
          //
          // In result, the results are checked in two steps:
          // 1) "Test1. Supply, wait, get rewards" checks that DForceHelper.getSupplyRewardsAmount
          //    gives the same amount of rewards as it was actually generated
          // 2) This test checks that DForceRewardsLib.supplyRewardAmounts
          //    generates same amount of rewards as it was actually generated in Test1.
          ///////////////////////////////////////////////////////
          const supplyPoint: ISupplyRewardsStatePoint = {
            blockSupply: BigNumber.from("32290584"),
            beforeSupply: {
              stateIndex: BigNumber.from("215393053582243505"),
              stateBlock: BigNumber.from("32283228"),
              distributionSpeed: BigNumber.from("37268734194063624"),
              totalSupply: BigNumber.from("950110374878895912732010")
            },
            supplyAmount: BigNumber.from("19886232794746960750269")
          };
          const blockUpdateDistributionState = BigNumber.from("32291585");
          const rewardsEarnedActual = BigNumber.from("764823147837685042");
          ///////////////////////////////////////////////////////

          const ret = await libFacade.supplyRewardAmount(
            supplyPoint.blockSupply,
            supplyPoint.beforeSupply.stateIndex,
            supplyPoint.beforeSupply.stateBlock,
            supplyPoint.beforeSupply.distributionSpeed,
            supplyPoint.beforeSupply.totalSupply,
            supplyPoint.supplyAmount,
            blockUpdateDistributionState
          );

          const sret = [
            ret.toString()
          ].join("\n");
          const sexpected = [
            rewardsEarnedActual.toString()
          ].join("\n");

          expect(sret).eq(sexpected);
        });
      });
    });

    describe("borrowRewardAmounts", () => {
      describe("Use data generated by DForceHelper tests ", () => {
        it("should return amount of rewards same to really received", async () => {
          if (!await isPolygonForkInUse()) return;
          ///////////////////////////////////////////////////////
          // The data below was generated by DForceHelperTest
          // using SupplyBorrowUsingDForce.makeTestBorrowRewardsOnly
          // variables predictData, blockUpdateDistributionState, borrowRateBeforeBorrow, borrowRateAfterBorrow
          // see "Test2. Supply, borrow, wait, claim rewards; borrow rewards only"
          //
          // In result, the results are checked in two steps:
          // 1) "Test2" checks that DForceHelper.predictRewardsStatePointAfterBorrow
          //    gives the same amount of rewards as it was actually generated
          // 2) This test checks that DForceRewardsLib.borrowRewardAmounts
          //    generates same amount of rewards as it was actually generated in Test1.
          ///////////////////////////////////////////////////////
          const rewardsEarnedActual = BigNumber.from("210913823641407222");
          const blockUpdateDistributionState = BigNumber.from("32442504");
          const cashesAndBorrowRates: BigNumber[] = [
            BigNumber.from("188472893545567236961658"),
            BigNumber.from("3239384959"),
            BigNumber.from("198472893545567236961658"),
            BigNumber.from("3214056450")
          ];
          const predictData: IBorrowRewardsPredictionInput = {
            amountToBorrow: BigNumber.from("10000000000000000000000"),
            distributionSpeed: BigNumber.from("15972314654598696"),
            totalReserves: BigNumber.from("685078796128768463280"),
            totalBorrows: BigNumber.from("748769851167139472249361"),
            totalCash: BigNumber.from("188472893545567236961658"),
            accrualBlockNumber: BigNumber.from("32426759"),
            blockNumber: BigNumber.from("32441502"),
            reserveFactor: BigNumber.from("100000000000000000"),
            borrowIndex: BigNumber.from("1008235458586920493"),
            stateBlock: BigNumber.from("32426759"),
            stateIndex: BigNumber.from("133007866972213896")
          };
          ///////////////////////////////////////////////////////
          const interestRateModel = await MocksHelper.createDForceInterestRateModelMock(deployer
            , cashesAndBorrowRates[0]
            , cashesAndBorrowRates[1]
            , cashesAndBorrowRates[2]
            , cashesAndBorrowRates[3]
          );

          const ret = await libFacade.borrowRewardAmountInternal(
            {
              amountToBorrow: predictData.amountToBorrow,
              accrualBlockNumber: predictData.accrualBlockNumber,
              borrowIndex: predictData.borrowIndex,
              stateBlock: predictData.stateBlock,
              blockNumber: predictData.blockNumber,
              distributionSpeed: predictData.distributionSpeed,
              stateIndex: predictData.stateIndex,
              reserveFactor: predictData.reserveFactor,
              totalBorrows: predictData.totalBorrows,
              totalCash: predictData.totalCash,
              totalReserves: predictData.totalReserves,
              interestRateModel: interestRateModel.address
            },
            blockUpdateDistributionState
          );

          const sret = [
            ret.toString()
          ].join("\n");
          const sexpected = [
            rewardsEarnedActual.toString()
          ].join("\n");

          expect(sret).eq(sexpected);
        });
      });
    });
  });

  describe("getEstimatedSupplyRatePure", () => {
    it("should return zero if totalSupply + amountToSupply is zero", async () => {
      if (!await isPolygonForkInUse()) return;
      const ret = await libFacade.getEstimatedSupplyRatePure(
        BigNumber.from(0),
        BigNumber.from(0),
        parseUnits("2", 18),
        parseUnits("2", 18),
        parseUnits("2", 18),
        ethers.Wallet.createRandom().address,
        parseUnits("1", 18),
        parseUnits("1", 18),
      );
      expect(ret.eq(0)).eq(true);
    });
    it("should revert if reserve factor exceeds 1", async () => {
      await expect(
        libFacade.getEstimatedSupplyRatePure(
          parseUnits("2", 18),
          parseUnits("2", 18),
          parseUnits("2", 18),
          parseUnits("2", 18),
          parseUnits("2", 18),
          ethers.Wallet.createRandom().address,
          parseUnits("200", 18), // (!)
          parseUnits("1", 18),
        )
      ).revertedWith("TC-50 amount too big"); // AMOUNT_TOO_BIG
    });
  });

  describe("getPrice", () => {
    it("should revert if zero", async () => {
      if (!await isPolygonForkInUse()) return;
      const priceOracle = await DForceChangePriceUtils.setupPriceOracleMock(
        deployer,
        false // we don't copy prices, so all prices are zero
      );
      // await priceOracle.setUnderlyingPrice(MaticAddresses.hDAI, 0);
      await expect(
        libFacade.getPrice(priceOracle.address, MaticAddresses.hDAI)
      ).revertedWith("TC-4 zero price"); // ZERO_PRICE
    });
  });

  describe("getUnderlying", () => {
    it("should return DAI for iDAI", async () => {
      if (!await isPolygonForkInUse()) return;
      expect(await libFacade.getUnderlying(MaticAddresses.dForce_iDAI), MaticAddresses.DAI);
    });
    it("should return WMATIC for iMATIC", async () => {
      if (!await isPolygonForkInUse()) return;
      expect(await libFacade.getUnderlying(MaticAddresses.dForce_iMATIC), MaticAddresses.WMATIC);
    });
  });

  describe("rdiv", () => {
    it("should revert on division by zero", async () => {
      if (!await isPolygonForkInUse()) return;
      await expect(
        libFacade.rdiv(1, 0)
      ).revertedWith("TC-34 division by zero"); // DIVISION_BY_ZERO
    });
  });

  describe("divup", () => {
    it("should revert on division by zero", async () => {
      if (!await isPolygonForkInUse()) return;
      await expect(
        libFacade.divup(1, 0)
      ).revertedWith("TC-34 division by zero"); // DIVISION_BY_ZERO
    });
  });
//endregion Unit tests

});