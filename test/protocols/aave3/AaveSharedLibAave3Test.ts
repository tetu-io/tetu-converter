import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {AaveSharedLibFacade, IAavePriceOracle, IERC20__factory, IERC20Metadata__factory} from "../../../typechain";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {expect} from "chai";
import {parseUnits} from "ethers/lib/utils";

describe("AaveSharedLibTest", () => {
  const BASE_CURRENCY_DECIMALS = 8;
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let facade: AaveSharedLibFacade;
  let priceOracle: IAavePriceOracle;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    facade = await MocksHelper.getAaveSharedLibFacade(deployer);
    priceOracle = await Aave3Helper.getAavePriceOracle(deployer);
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
  describe("getReserveForDustDebt", () => {
    it("should return reserve > 0 for USDC", async () => {
      const asset = MaticAddresses.USDC;
      const decimals = await IERC20Metadata__factory.connect(asset, deployer).decimals();
      const maxAllowedAmount = parseUnits("2", 6);

      const price = await priceOracle.getAssetPrice(asset);
      const reserve = await facade.getReserveForDustDebt(parseUnits("1", decimals), price, BASE_CURRENCY_DECIMALS);
      console.log(reserve);
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
      console.log(reserve);
      expect(reserve.gt(0) && reserve.lt(maxAllowedAmount)).eq(true);
    });
  });

//endregion Unit tests
});
