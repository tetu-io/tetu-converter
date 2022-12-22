import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {expect} from "chai";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {Controller, IPriceOracle} from "../../typechain";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {areAlmostEqual} from "../baseUT/utils/CommonUtils";
import {parseUnits} from "ethers/lib/utils";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";

describe("Price oracle tests", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let controller: Controller;
  let priceOracle: IPriceOracle;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    controller = await TetuConverterApp.createController(deployer,
      {
        tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR
      }
    );
    priceOracle = await CoreContractsHelper.createPriceOracle(deployer, controller.address);
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
  describe("getAssetPrice", () => {
    describe("Good paths", () => {
      it("should return almost 1e18 for USDC", async () => {
        if (!await isPolygonForkInUse()) return;
        const price = await priceOracle.getAssetPrice(MaticAddresses.USDC);
        const ret = areAlmostEqual(price, parseUnits("1", 18), 3);
        expect(ret).eq(true);
      });
      it("should return not zero for DAI", async () => {
        if (!await isPolygonForkInUse()) return;
        expect((await priceOracle.getAssetPrice(MaticAddresses.DAI)).eq(0)).eq(false);
      });
      it("should return not zero for USDT", async () => {
        if (!await isPolygonForkInUse()) return;
        expect((await priceOracle.getAssetPrice(MaticAddresses.USDT)).eq(0)).eq(false);
      });
      it("should return not zero for WETH", async () => {
        if (!await isPolygonForkInUse()) return;
        expect((await priceOracle.getAssetPrice(MaticAddresses.WETH)).eq(0)).eq(false);
      });
      it("should return not zero for WBTC", async () => {
        if (!await isPolygonForkInUse()) return;
        expect((await priceOracle.getAssetPrice(MaticAddresses.WBTC)).eq(0)).eq(false);
      });
      it("should return not zero for WMATIC", async () => {
        if (!await isPolygonForkInUse()) return;
        expect((await priceOracle.getAssetPrice(MaticAddresses.WMATIC)).eq(0)).eq(false);
      });
      it("should return not zero for EURS", async () => {
        if (!await isPolygonForkInUse()) return;
        expect((await priceOracle.getAssetPrice(MaticAddresses.EURS)).eq(0)).eq(false);
      });
    });
    describe("Bad paths", () => {
      it("should return 0 if the asset is unknown", async () => {
        if (!await isPolygonForkInUse()) return;
        const ret = await priceOracle.getAssetPrice(ethers.Wallet.createRandom().address);
        expect(ret.eq(0)).eq(true);
      });
    });
  });
//endregion Unit tests

});