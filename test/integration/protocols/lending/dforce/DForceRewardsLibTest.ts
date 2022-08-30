import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
  DForceRewardsLibFacade,
} from "../../../../../typechain";
import {expect} from "chai";
import {
  ISupplyRewardsStatePoint
} from "../../../../../scripts/integration/helpers/DForceHelper";
import {BigNumber} from "ethers";
import {DeployUtils} from "../../../../../scripts/utils/DeployUtils";

describe("DForceHelper unit tests", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let investor: SignerWithAddress;
  let libFacade: DForceRewardsLibFacade;

//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    investor = signers[0];
    libFacade = await DeployUtils.deployContract(deployer
      , "DForceRewardsLibFacade"
    ) as DForceRewardsLibFacade;
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

          ///////////////////////////////////////////////////////
          // The data below was generated by DForceHelperTest
          // using SupplyBorrowUsingDForce.makeSupplyRewardsTestMinimumTransactions
          // variables supplyPoint and blockUpdateDistributionState
          // see "Test1. Supply, wait, get rewards"
          //
          // In result, the results are checked in two steps:
          // 1) "Test1. Supply, wait, get rewards" checks that DForceHelper.getSupplyRewardsAmount
          //    gives same amount of rewards are it was actually generated
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

  });
//endregion Unit tests

});