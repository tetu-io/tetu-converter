import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {BASE_NETWORK_ID, HardhatUtils, ZKEVM_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {PriceOracleZerovixZkevm} from "../../../typechain";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {formatUnits} from "ethers/lib/utils";
import {expect} from "chai";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";

describe.skip("PriceOracleZerovixZkevmTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;

  let priceOracle: PriceOracleZerovixZkevm;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(ZKEVM_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];

    priceOracle = await DeployUtils.deployContract(signer, "PriceOracleZerovixZkevm", ZkevmAddresses.ZEROVIX_PRICE_ORACLE) as PriceOracleZerovixZkevm;
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Unit tests
  describe("getAssetPrice", () => {
    async function getAssetPrice(asset: string) : Promise<number> {
      const price = await priceOracle.getAssetPrice(asset);
      console.log("price", price.toString())
      return +formatUnits(price, 18);
    }

    it("check USDC price", async () => {
      expect(await getAssetPrice(ZkevmAddresses.USDC)).approximately(1, 0.1);
    })
    it("check USDT price", async () => {
      expect(await getAssetPrice(ZkevmAddresses.USDT)).approximately(1, 0.1);
    })

    it("check WETH price", async () => {
      expect(await getAssetPrice(ZkevmAddresses.WETH)).gt(0);
    })
    it("check Matic price", async () => {
      expect(await getAssetPrice(ZkevmAddresses.MATIC)).gt(0);
    })
    it("check WBTC price", async () => {
      expect(await getAssetPrice(ZkevmAddresses.WBTC)).gt(0);
    })

    it("Bad path: check price of unknown asset", async () => {
      expect(await getAssetPrice(ZkevmAddresses.ZEROVIX_COMPTROLLER)).eq(0);
    })
  });

//endregion Unit tests
});