import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {AaveSharedLibFacade, IAaveTwoPriceOracle, IERC20Metadata__factory} from "../../../typechain";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {expect} from "chai";
import {parseUnits} from "ethers/lib/utils";
import {AaveTwoHelper} from "../../../scripts/integration/helpers/AaveTwoHelper";

describe("AaveSharedLibTest", () => {
  const BASE_CURRENCY_DECIMALS = 18;
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let facade: AaveSharedLibFacade;
  let priceOracle: IAaveTwoPriceOracle;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    facade = await MocksHelper.getAaveSharedLibFacade(deployer);
    priceOracle = await AaveTwoHelper.getAavePriceOracle(deployer);
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
  /**
   * Not valid anymore
   * AAVE2 uses 0.1% of debt, it doesn't use getReserveForDustDebt
   */
  describe.skip("getReserveForDustDebt", () => {
    it("should return reserve > 0 for USDC", async () => {
      const asset = MaticAddresses.USDC;
      const decimals = await IERC20Metadata__factory.connect(asset, deployer).decimals();
      const maxAllowedAmount = parseUnits("2", 6);

      const price = await priceOracle.getAssetPrice(asset);
      const reserve = await facade.getReserveForDustDebt(parseUnits("1", decimals), price, BASE_CURRENCY_DECIMALS);
      console.log("price", price);
      console.log("reserve", reserve);
      expect(reserve.gt(0) && reserve.lt(maxAllowedAmount)).eq(true);
    });
    it("should return reserve > 0 for WETH", async () => {
      const asset = MaticAddresses.WETH;
      const maxAllowedAmount = parseUnits("1", 18-3);
      const decimals = await IERC20Metadata__factory.connect(asset, deployer).decimals();
      const price = await priceOracle.getAssetPrice(asset);
      const reserve = await facade.getReserveForDustDebt(parseUnits("1", decimals), price, BASE_CURRENCY_DECIMALS);
      console.log(reserve);
      expect(reserve.gt(0) && reserve.lt(maxAllowedAmount)).eq(true);
    });
    it("should return reserve > 0 for WBTC", async () => {
      const asset = MaticAddresses.WBTC;
      const maxAllowedAmount = parseUnits("1", 18-3);
      const decimals = await IERC20Metadata__factory.connect(asset, deployer).decimals();
      const price = await priceOracle.getAssetPrice(asset);
      const reserve = await facade.getReserveForDustDebt(parseUnits("1", decimals), price, BASE_CURRENCY_DECIMALS);
      console.log("price", price);
      console.log("reserve", reserve);
      expect(reserve.gt(0) && reserve.lt(maxAllowedAmount)).eq(true);
    });
  });

//endregion Unit tests
});
