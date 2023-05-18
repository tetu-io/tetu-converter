import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {Aave3AprLibFacade, IAavePriceOracle} from "../../../typechain";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {Misc} from "../../../scripts/utils/Misc";
import {expect} from "chai";

describe("AaveSharedLibTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let facade: Aave3AprLibFacade;
//endregion Global vars for all tests

//region before, after
  before(async function () {
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
