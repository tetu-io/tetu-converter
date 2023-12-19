import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {HardhatUtils, ZKEVM_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {formatUnits} from "ethers/lib/utils";
import {expect} from "chai";
import {KeomSetupUtils} from "../../baseUT/protocols/keom/KeomSetupUtils";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";
import {PriceOracleKeomZkevm} from "../../../typechain";
import {ZkevmCore} from "../../baseUT/chains/zkevm/ZkevmCore";

describe("PriceOracleKeomZkevmTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;

  let priceOracle: PriceOracleKeomZkevm;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(ZKEVM_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];

    priceOracle = await DeployUtils.deployContract(signer, "PriceOracleKeomZkevm", ZkevmAddresses.KEOM_PRICE_ORACLE) as PriceOracleKeomZkevm;

    const core = ZkevmCore.getCoreKeom();
    await KeomSetupUtils.disableHeartbeatZkEvm(signer, core);
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
    it("check WMATIC price", async () => {
      expect(await getAssetPrice(ZkevmAddresses.MATIC)).approximately(1, 0.7);
    })
    it("check WETH price", async () => {
      expect(await getAssetPrice(ZkevmAddresses.WETH)).gt(0);
    })

    it("Bad path: check price of unknown asset", async () => {
      expect(await getAssetPrice(ZkevmAddresses.DAI)).eq(0);
    })
  });

//endregion Unit tests
});