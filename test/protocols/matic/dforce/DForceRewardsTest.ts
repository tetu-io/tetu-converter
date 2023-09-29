import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../../baseUT/types/TokenDataTypes";
import {SupplyBorrowUsingDForce} from "../../../baseUT/uses-cases/protocols/dforce/SupplyBorrowUsingDForce";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../../scripts/utils/HardhatUtils";

/**
 * Supply amount => claim rewards in specified period
 * Borrow amount => claim rewards in specified period
 */
describe("DForceRewardsTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
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
        describe("DAI-18 : XXX", () => {
          it("should return expected amount of rewards", async () => {
            const collateralAsset = MaticAddresses.DAI;
            const collateralHolder = MaticAddresses.HOLDER_DAI;
            const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);

            const collateralAmount1 = getBigNumberFrom(2_000, collateralToken.decimals);

            const periodInBlocks = 2_000;

            const r = await SupplyBorrowUsingDForce.makeSupplyRewardsTest(
              deployer
              , collateralToken
              , collateralCToken
              , collateralHolder
              , collateralAmount1
              , periodInBlocks
            );
            console.log(r);

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
        describe("USDC-6 : XXX", () => {
          it("should return expected amount of rewards", async () => {
            const collateralAsset = MaticAddresses.USDC;
            const collateralHolder = MaticAddresses.HOLDER_USDC;
            const collateralCTokenAddress = MaticAddresses.dForce_iUSDC;

            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);

            const collateralAmount1 = getBigNumberFrom(2_000, collateralToken.decimals);

            const periodInBlocks = 2_000;

            const r = await SupplyBorrowUsingDForce.makeSupplyRewardsTest(
              deployer
              , collateralToken
              , collateralCToken
              , collateralHolder
              , collateralAmount1
              , periodInBlocks
            );
            console.log(r);

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