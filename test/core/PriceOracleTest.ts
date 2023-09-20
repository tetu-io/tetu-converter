import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {expect} from "chai";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {PriceOracle} from "../../typechain";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {areAlmostEqual} from "../baseUT/utils/CommonUtils";
import {parseUnits} from "ethers/lib/utils";
import {Misc} from "../../scripts/utils/Misc";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../scripts/utils/HardhatUtils";

describe("Price oracle tests", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let priceOracle: PriceOracle;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);

    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    priceOracle = await CoreContractsHelper.createPriceOracle(deployer);
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
  describe("constructor", () => {
    describe("Good paths", () => {
      it("should use AAVE3 price oracle by default", async () => {
        expect(await priceOracle.priceOracle()).eq(MaticAddresses.AAVE_V3_PRICE_ORACLE);
      });
    });
    describe("Bad paths", () => {
      it("revert if zero address", async () => {
        await expect(
          CoreContractsHelper.createPriceOracle(deployer, Misc.ZERO_ADDRESS)
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
    });
  });

  describe("getAssetPrice", () => {
    describe("Good paths", () => {
      it("should return almost 1e18 for USDC", async () => {
        const price = await priceOracle.getAssetPrice(MaticAddresses.USDC);
        const ret = areAlmostEqual(price, parseUnits("1", 18), 3);
        expect(ret).eq(true);
      });
      it("should return not zero for DAI", async () => {
        expect((await priceOracle.getAssetPrice(MaticAddresses.DAI)).eq(0)).eq(false);
      });
      it("should return not zero for USDT", async () => {
        expect((await priceOracle.getAssetPrice(MaticAddresses.USDT)).eq(0)).eq(false);
      });
      it("should return not zero for WETH", async () => {
        expect((await priceOracle.getAssetPrice(MaticAddresses.WETH)).eq(0)).eq(false);
      });
      it("should return not zero for WBTC", async () => {
        expect((await priceOracle.getAssetPrice(MaticAddresses.WBTC)).eq(0)).eq(false);
      });
      it("should return not zero for WMATIC", async () => {
        expect((await priceOracle.getAssetPrice(MaticAddresses.WMATIC)).eq(0)).eq(false);
      });
      it("should return not zero for EURS", async () => {
        expect((await priceOracle.getAssetPrice(MaticAddresses.EURS)).eq(0)).eq(false);
      });
    });
    describe("Bad paths", () => {
      it("should return 0 if the asset is unknown", async () => {
        const ret = await priceOracle.getAssetPrice(ethers.Wallet.createRandom().address);
        expect(ret.eq(0)).eq(true);
      });
    });
  });
//endregion Unit tests

});