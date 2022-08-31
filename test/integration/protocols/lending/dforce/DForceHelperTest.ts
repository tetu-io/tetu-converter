import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
  DForcePlatformAdapter__factory,
} from "../../../../../typechain";
import {expect} from "chai";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {CoreContractsHelper} from "../../../../baseUT/helpers/CoreContractsHelper";
import {
  DForceHelper,
  IBorrowRewardsStatePoint, IRewardsStatePoint,
  ISupplyRewardsStatePoint
} from "../../../../../scripts/integration/helpers/DForceHelper";
import {TokenDataTypes} from "../../../../baseUT/types/TokenDataTypes";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {SupplyBorrowUsingDForce} from "../../../../baseUT/uses-cases/dforce/SupplyBorrowUsingDForce";
import {DForcePlatformFabric} from "../../../../baseUT/fabrics/DForcePlatformFabric";
import {MocksHelper} from "../../../../baseUT/helpers/MocksHelper";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {BigNumber} from "ethers";

describe("DForceHelper tests", () => {
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

//region Unit tests impl
  async function makeTestSupplyRewardsOnly(
    collateralAsset: string,
    collateralCTokenAddress: string,
    collateralHolder: string,
    collateralAmount0: number,
    periodInBlocks0: number
  ) : Promise<{
    rewardsEarnedActual: BigNumber,
    rewardsReceived: BigNumber,
    supplyPoint: ISupplyRewardsStatePoint,
    blockUpdateDistributionState: BigNumber
  }>{
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);

    const collateralAmount = getBigNumberFrom(collateralAmount0, collateralToken.decimals);
    const periodInBlocks = periodInBlocks0;

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
    return await SupplyBorrowUsingDForce.makeSupplyRewardsTestMinimumTransactions(
      deployer
      , user
      , collateralToken
      , collateralCToken
      , collateralHolder
      , collateralAmount
      , periodInBlocks
    );
  }

  async function makeTestBorrowRewardsOnly(
    collateralAsset: string,
    collateralCTokenAddress: string,
    collateralHolder: string,
    collateralAmount0: number,
    borrowAsset: string,
    borrowCTokenAddress: string,
    borrowHolder: string,
    borrowAmount0: number,
    periodInBlocks0: number
  ) : Promise<{
    rewardsEarnedActual: BigNumber,
    rewardsReceived: BigNumber,
    borrowPoint: IBorrowRewardsStatePoint,
    blockUpdateDistributionState: BigNumber
  }>{
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
    const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

    const collateralAmount = getBigNumberFrom(collateralAmount0, collateralToken.decimals);
    const borrowAmount = getBigNumberFrom(borrowAmount0, borrowToken.decimals);
    const periodInBlocks = periodInBlocks0;

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
    return await SupplyBorrowUsingDForce.makeBorrowRewardsOnlyTest(
      deployer
      , collateralToken
      , collateralCToken
      , collateralHolder
      , collateralAmount
      , borrowToken
      , borrowCToken
      , borrowHolder
      , borrowAmount
      , periodInBlocks
    );
  }
//endregion Unit tests impl

//region Unit tests
  describe("Rewards calculations", () => {
    describe("getSupplyRewardsAmount", () => {
      describe("Test1. Supply, wait, get rewards; supply rewards only", () => {
        describe("Supply 20_000 DAI, 1000 blocks", () => {
          it("should return amount of rewards same to really received", async () => {
            if (!await isPolygonForkInUse()) return;

            // get amount of really earned supply-rewards
            const r = await makeTestSupplyRewardsOnly(
              MaticAddresses.DAI,
              MaticAddresses.dForce_iDAI,
              MaticAddresses.HOLDER_DAI,
              20_000,
              1_000
            );

            // estimate amount of rewards using DForceHelper utils
            const pt = DForceHelper.predictRewardsStatePointAfterSupply(r.supplyPoint);
            const ret = DForceHelper.getSupplyRewardsAmount(pt, r.blockUpdateDistributionState);

            console.log(`Generate source data for DForceRewardsLibTest`, r);

            const sret = ret.rewardsAmount.toString();
            const sexpected = r.rewardsEarnedActual.toString();

            expect(sret).eq(sexpected);
          });
        });
        describe("300 USDC, 10_000 blocks", () => {
          it("should return amount of rewards same to really received", async () => {
            if (!await isPolygonForkInUse()) return;

            // get amount of really earned supply-rewards
            const r = await makeTestSupplyRewardsOnly(
              MaticAddresses.USDC,
              MaticAddresses.dForce_iUSDC,
              MaticAddresses.HOLDER_USDC,
              300,
              10_000
            );

            // estimate amount of rewards using DForceHelper utils
            const pt = DForceHelper.predictRewardsStatePointAfterSupply(r.supplyPoint);
            const ret = DForceHelper.getSupplyRewardsAmount(pt, r.blockUpdateDistributionState);

            console.log(`Generate source data for DForceRewardsLibTest`, r);

            const sret = ret.rewardsAmount.toString();
            const sexpected = r.rewardsEarnedActual.toString();

            expect(sret).eq(sexpected);
          });
        });
      });
    });
    describe("getBorrowRewardsAmount", () => {
      describe("Test2. Supply, borrow, wait, claim rewards; borrow rewards only", () => {
        describe("Borrow 10_000 DAI, 1000 blocks", () => {
          it("should return amount of rewards same to really received", async () => {
            if (!await isPolygonForkInUse()) return;

            // get amount of really earned supply-rewards
            const r = await makeTestBorrowRewardsOnly(
              MaticAddresses.WETH, //WETH doesn't have supply-rewards
              MaticAddresses.dForce_iWETH,
              MaticAddresses.HOLDER_WETH,
              1_000,
              MaticAddresses.DAI,
              MaticAddresses.dForce_iDAI,
              MaticAddresses.HOLDER_DAI,
              10_000,
              1_000
            );

            // estimate amount of rewards using DForceHelper utils
            const pt = DForceHelper.predictRewardsStatePointAfterBorrow(r.borrowPoint);
            console.log("PT", pt);
            const ret = DForceHelper.getBorrowRewardsAmount(pt, r.blockUpdateDistributionState);

            console.log(`Generate source data for DForceRewardsLibTest`, r);

            const sret = ret.rewardsAmount.toString();
            const sexpected = r.rewardsEarnedActual.toString();

            expect(sret).eq(sexpected);
          });
          it("temp", async()=>{
            const userInterest = BigNumber.from("1007792047531702871");
            const borrowIndex0: BigNumber = BigNumber.from("1007768505397815983");
            const totalBorrows0 = BigNumber.from("748722543290648981048813");
            const totalToken0 = DForceHelper.getTotalTokenForBorrowCase(totalBorrows0, borrowIndex0);
            const borrowBalanceStored0 = BigNumber.from("0");
            const accountBalance0 = DForceHelper.rdiv(borrowBalanceStored0, borrowIndex0);
            const stateIndex0 = BigNumber.from("129921656642613910");
            const stateBlock0 = BigNumber.from("32283228");
            const distributionSpeed0 = BigNumber.from("15972314654598696");
            const amountToBorrow = BigNumber.from("10000000000000000000000");
            const blockNumber1 = BigNumber.from("32290586");
            const accrualBlockNumber1 = BigNumber.from("32283228");

            const borrowRate1 = BigNumber.from("3174864977");
            const getCash0 = BigNumber.from("207457975647111909044867");
            const totalReserves0 = BigNumber.from("650392243307287326761");
            const reserveFactor = BigNumber.from("100000000000000000");

            const simpleInterestFactor1 = (blockNumber1.sub(accrualBlockNumber1).mul(borrowRate1));
            const interestAccumulated1 = DForceHelper.rmul(simpleInterestFactor1, totalBorrows0);
            const totalBorrows1 = totalBorrows0.add(interestAccumulated1);
            const totalReserves1 = totalReserves0.add(DForceHelper.rmul(interestAccumulated1, reserveFactor));
            const borrowIndex1 = DForceHelper.rmul(simpleInterestFactor1, borrowIndex0).add(borrowIndex0);
            console.log("simpleInterestFactor1", simpleInterestFactor1);
            console.log("interestAccumulated1", interestAccumulated1);
            console.log("totalBorrows1", totalBorrows1);
            console.log("borrowIndex1", borrowIndex1);
            console.log("totalReserves1", totalReserves1);
            const stateIndex1 = DForceHelper.calcDistributionStateSupply(
              blockNumber1, stateBlock0, stateIndex0, distributionSpeed0
              , DForceHelper.getTotalTokenForBorrowCase(totalBorrows1, borrowIndex1)
            );
            const stateBlock1 = blockNumber1;
            console.log("stateIndex1", stateIndex1);
            console.log("stateBlock1", stateBlock1);
            const totalBorrowsAfterBorrow1 = totalBorrows1.add(amountToBorrow)
            console.log("totalBorrowsAfterBorrow1", totalBorrowsAfterBorrow1);
            console.log("borrowIndex1", borrowIndex1);

            const blockNumber2 = BigNumber.from("32291587");
            const accrualBlockNumber2 = blockNumber1;

            const borrowRate2 = BigNumber.from("3217289900");
            const getCash21 = getCash0.add(amountToBorrow);
            const totalBorrows21 = totalBorrowsAfterBorrow1;
            const totalReserves21 = totalReserves1;

            const simpleInterestFactor2 = (blockNumber2.sub(accrualBlockNumber2).mul(borrowRate2));
            const interestAccumulated2 = DForceHelper.rmul(simpleInterestFactor2, totalBorrowsAfterBorrow1);
            const totalBorrows2 = totalBorrowsAfterBorrow1.add(interestAccumulated2);
            const borrowIndex2 = DForceHelper.rmul(simpleInterestFactor2, borrowIndex1).add(borrowIndex1);
            console.log("totalBorrows2", totalBorrows2);
            console.log("borrowIndex2", borrowIndex2);
            const blockNumber3 = BigNumber.from("32291588");

            const stateIndex3 = DForceHelper.calcDistributionStateSupply(
              blockNumber3, stateBlock1, stateIndex1, distributionSpeed0
              , DForceHelper.getTotalTokenForBorrowCase(totalBorrows2, borrowIndex2)
            );
            const stateBlock3 = blockNumber3;
            console.log("stateIndex3", stateIndex3);
            console.log("stateBlock3", stateBlock3);

            const borrowIndex: BigNumber = borrowIndex2;
            const totalBorrows = totalBorrows2;
            const totalToken = DForceHelper.getTotalTokenForBorrowCase(totalBorrows, borrowIndex);
            const borrowBalanceStored1 = DForceHelper.divup(amountToBorrow.mul(borrowIndex), userInterest);
            console.log("borrowBalanceStored", borrowBalanceStored1);
            const borrowBalanceStored = BigNumber.from(borrowBalanceStored1);
            const accountBalance = DForceHelper.rdiv(borrowBalanceStored, borrowIndex);

            const pt: IRewardsStatePoint = {
              stateIndex: stateIndex1,
              stateBlock: stateBlock1,
              accountIndex: stateIndex1,
              distributionSpeed: BigNumber.from("15972314654598696"),
              accountBalance: accountBalance,
              totalToken: totalToken,
            }
            const blockUpdateDistributionState: BigNumber = BigNumber.from("32291588");
            //const pt = DForceHelper.predictRewardsStatePointAfterBorrow(borrowPoint);
            console.log("PT", pt);
            const ret = DForceHelper.getBorrowRewardsAmount(pt, blockUpdateDistributionState);
            console.log(ret);
            expect(ret.rewardsAmount.toString()).eq("210932052718815335");
          });
        });
      });
    });

  });
//endregion Unit tests

});