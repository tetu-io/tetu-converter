import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {BASE_NETWORK_ID, HardhatUtils} from "../../../scripts/utils/HardhatUtils";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {PriceOracleMoonwell} from "../../../typechain";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {BaseAddresses} from "../../../scripts/addresses/BaseAddresses";
import {formatUnits} from "ethers/lib/utils";
import {expect} from "chai";

describe("PriceOracleCompoundTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;

  let priceOracle: PriceOracleMoonwell;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];

    priceOracle = await DeployUtils.deployContract(signer, "PriceOracleMoonwell", BaseAddresses.MOONWELL_CHAINLINK_ORACLE) as PriceOracleMoonwell;
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
      expect(await getAssetPrice(BaseAddresses.USDC)).approximately(1, 0.1);
    })
    it("check USDbC price", async () => {
      expect(await getAssetPrice(BaseAddresses.USDbC)).approximately(1, 0.1);
    })
    it("check USDbC price", async () => {
      expect(await getAssetPrice(BaseAddresses.DAI)).approximately(1, 0.1);
    })
  });

//endregion Unit tests
});