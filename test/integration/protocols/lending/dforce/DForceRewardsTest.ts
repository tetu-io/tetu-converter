import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {expect, use} from "chai";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../../../baseUT/types/TokenDataTypes";
import {SupplyBorrowUsingDForce} from "../../../../baseUT/uses-cases/dforce/SupplyBorrowUsingDForce";
import {DForcePlatformFabric} from "../../../../baseUT/fabrics/DForcePlatformFabric";
import {CoreContractsHelper} from "../../../../baseUT/helpers/CoreContractsHelper";
import {BorrowRepayUsesCase} from "../../../../baseUT/uses-cases/BorrowRepayUsesCase";
import {
  ITetuLiquidator__factory,
  IERC20__factory,
  IERC20Extended__factory,
  IDForceCToken__factory
} from "../../../../../typechain";
import {DForceHelper} from "../../../../../scripts/integration/helpers/DForceHelper";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";

/**
 * Supply amount => claim rewards in specified period
 * Borrow amount => claim rewards in specified period
 */
describe("DForce rewards tests", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
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
  describe("Rewards manual calculations", () => {
    describe("Good paths", () => {
      describe("Supply amount and claim supply-rewards", () => {
        describe("DAI-18 : usdc-6", () => {
          it("should return expected amount of rewards", async () => {
            if (!await isPolygonForkInUse()) return;

            const collateralAsset = MaticAddresses.DAI;
            const collateralHolder = MaticAddresses.HOLDER_DAI;
            const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);

            const collateralAmount1 = getBigNumberFrom(20_000, collateralToken.decimals);

            const periodInBlocks = 1_000;

            const r = await SupplyBorrowUsingDForce.makeSupplyRewardsTest(
              deployer
              , collateralToken
              , collateralCToken
              , collateralHolder
              , collateralAmount1
              , periodInBlocks
            );
            console.log(r.results);

            const ret = [
              r.rewardsEarnedManual.toString()
              , r.rewardsReceived.gt(r.rewardsEarnedManual)
            ].join("\n");
            const expected = [
              r.rewardsEarnedActual.toString()
              , true
            ].join("\n");

            expect(ret).eq(expected);
          });
        });
      });
    });
  });
//endregion Unit tests

});