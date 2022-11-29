import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {HfAprLibFacade} from "../../../typechain";
import {HundredFinanceChangePriceUtils} from "../../baseUT/protocols/hundred-finance/HundredFinanceChangePriceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {expect} from "chai";

describe("HfAprLib unit tests", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let investor: SignerWithAddress;
  let libFacade: HfAprLibFacade;

//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    investor = signers[0];
    libFacade = await DeployUtils.deployContract(deployer, "HfAprLibFacade") as HfAprLibFacade;
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
  describe("getPrice", () => {
    it("should revert if zero", async () => {
      const priceOracle = await HundredFinanceChangePriceUtils.setupPriceOracleMock(
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
    it("should return DAI for hDAI", async () => {
      expect(await libFacade.getUnderlying(MaticAddresses.hDAI), MaticAddresses.DAI);
    });
    it("should return WMATIC for hMATIC", async () => {
      expect(await libFacade.getUnderlying(MaticAddresses.hMATIC), MaticAddresses.WMATIC);
    });
  });
//endregion Unit tests

});