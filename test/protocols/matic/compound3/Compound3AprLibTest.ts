import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {Compound3AprLibFacade} from "../../../typechain";
import {expect} from "chai";
import {parseUnits} from "ethers/lib/utils";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../../scripts/utils/HardhatUtils";

describe("Compound3AprLibTests", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let facade: Compound3AprLibFacade;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);

    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    facade = await MocksHelper.getCompound3AprLibFacade(deployer);
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
  describe("getBorrowRate", () => {
    describe("Good paths", () => {
      it("should return zero if totalSupply is zero", async () => {
        const cometMock = await MocksHelper.createCometMock(deployer);
        await cometMock.setTotalSupply(3);
        await cometMock.setTotalBorrow(20);
        await cometMock.setBorrowRate(
          parseUnits("10", 18),
          77
        );
        expect(await facade.getBorrowRate(cometMock.address, 10)).eq(77);
      })
    });
    describe("Bad paths", () => {
      it("should return zero if totalSupply is zero", async () => {
        const cometMock = await MocksHelper.createCometMock(deployer);
        await cometMock.setTotalSupply(0);
        await cometMock.setTotalBorrow(1);
        await cometMock.setBorrowRate(0, 2);
        expect(await facade.getBorrowRate(cometMock.address, 1)).eq(2);
      })
    });
  });

  describe("getPrice", () => {
    describe("Good paths", () => {
      it("should return zero if totalSupply is zero", async () => {
        const priceFeed = await MocksHelper.createPriceFeed(deployer);
        await priceFeed.setLatestRoundData(1, 2, 3, 4, 5);
        expect((await facade.getPrice(priceFeed.address)).toNumber()).eq(2);
      })
    });
    describe("Bad paths", () => {
      it("should revert if price is zero", async () => {
        const priceFeed = await MocksHelper.createPriceFeed(deployer);
        await priceFeed.setLatestRoundData(1, 0, 3, 4, 5);
        await expect(facade.getPrice(priceFeed.address)).revertedWith("TC-4 zero price"); // ZERO_PRICE
      })
    });
  });
//endregion Unit tests
});
