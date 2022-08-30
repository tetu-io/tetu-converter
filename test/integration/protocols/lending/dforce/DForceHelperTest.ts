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
  IBorrowRewardsStatePoint,
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
            const ret = DForceHelper.getBorrowRewardsAmount(pt, r.blockUpdateDistributionState);

            console.log(`Generate source data for DForceRewardsLibTest`, r);

            const sret = ret.rewardsAmount.toString();
            const sexpected = r.rewardsEarnedActual.toString();

            expect(sret).eq(sexpected);
          });
        });
      });
    });

  });
//endregion Unit tests

});