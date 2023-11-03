import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {Misc} from "../../../scripts/utils/Misc";
import {expect} from "chai";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {Aave3AprLibFacade} from "../../../typechain";
import {MocksHelper} from "../../baseUT/app/MocksHelper";

describe("AaveSharedLibTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let facade: Aave3AprLibFacade;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);

    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    facade = await MocksHelper.getAave3AprLibFacade(deployer);
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
  describe("getCostForPeriodAfter", () => {
    describe("Bad paths", () => {
      it("reserveNormalizedAfterPeriod < reserveNormalized (edge case, improve coverage)", async () => {
        const cost = await facade.getCostForPeriodAfter(
          1,
          Misc.MAX_UINT, // > 1
          0,
          0,
          1,
          1,
          0
        );
        expect(cost.eq(0)).eq(true);
      });
    });
  });

//endregion Unit tests
});
