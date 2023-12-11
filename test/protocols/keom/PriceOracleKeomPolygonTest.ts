import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {HardhatUtils, POLYGON_NETWORK_ID, ZKEVM_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {formatUnits} from "ethers/lib/utils";
import {expect} from "chai";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {PriceOracleKeomPolygon} from "../../../typechain";
import {MaticCore} from "../../baseUT/chains/polygon/maticCore";
import {KeomSetupUtils} from "../../baseUT/protocols/keom/KeomSetupUtils";

describe("PriceOracleKeomPolygonTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;

  let priceOracle: PriceOracleKeomPolygon;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];

    priceOracle = await DeployUtils.deployContract(signer, "PriceOracleKeomPolygon", MaticAddresses.KEOM_PRICE_ORACLE) as PriceOracleKeomPolygon;

    const core = MaticCore.getCoreKeom();
    await KeomSetupUtils.disableHeartbeat(signer, core);
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
      expect(await getAssetPrice(MaticAddresses.USDC)).approximately(1, 0.1);
    })
    it("check USDT price", async () => {
      expect(await getAssetPrice(MaticAddresses.USDT)).approximately(1, 0.1);
    })
    it("check DAI price", async () => {
      expect(await getAssetPrice(MaticAddresses.DAI)).approximately(1, 0.1);
    })
    it("check WMATIC price", async () => {
      expect(await getAssetPrice(MaticAddresses.WMATIC)).approximately(1, 0.7);
    })
    it("check MaticX price", async () => {
      expect(await getAssetPrice(MaticAddresses.MaticX)).approximately(1, 0.7);
    })
    it("check stMATIC price", async () => {
      expect(await getAssetPrice(MaticAddresses.stMATIC)).approximately(1, 0.7);
    })
  });

//endregion Unit tests
});