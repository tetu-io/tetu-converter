import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {expect} from "chai";
import {Aave3PriceOracleMock, MockERC20} from "../../typechain";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {Misc} from "../../scripts/utils/Misc";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../../scripts/utils/HardhatUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {MocksHelper} from "../baseUT/app/MocksHelper";
import {CoreContractsHelper} from "../baseUT/app/CoreContractsHelper";

describe("PriceOracleTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let priceOracleMocked: Aave3PriceOracleMock;
  let usdc: MockERC20;
  let dai: MockERC20;
  let matic: MockERC20;
  let weth: MockERC20;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    priceOracleMocked = await MocksHelper.createAave3PriceOracleMock(
      deployer,
      ethers.Wallet.createRandom().address,
      Misc.ZERO_ADDRESS,
      parseUnits("1", 8),
      ethers.Wallet.createRandom().address
    );

    usdc = await DeployUtils.deployContract(deployer, 'MockERC20', 'USDC', 'USDC', 6) as MockERC20;
    dai = await DeployUtils.deployContract(deployer, 'MockERC20', 'Dai', 'DAI', 18) as MockERC20;
    matic = await DeployUtils.deployContract(deployer, 'MockERC20', 'Matic', 'MATIC', 18) as MockERC20;
    weth = await DeployUtils.deployContract(deployer, 'MockERC20', 'WETH', 'WETH', 18) as MockERC20;
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
        const priceOracle = await CoreContractsHelper.createPriceOracle(deployer, priceOracleMocked.address);
        expect(await priceOracle.priceOracle()).eq(priceOracleMocked.address);
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
    interface IGetAssetPriceParams {
      assets: MockERC20[];
      prices: string[];
    }
    interface IGetAssetPriceResults {
      prices: number[];
    }
    async function getAssetPrice(p: IGetAssetPriceParams): Promise<IGetAssetPriceResults> {
      await priceOracleMocked.setPrices(
        p.assets.map(x => x.address),
        p.prices.map(x => parseUnits(x, 8))  // prices in aave 3 has decimals = 8 (base currency)
      );
      const priceOracle = await CoreContractsHelper.createPriceOracle(deployer, priceOracleMocked.address);
      return {
        prices: await Promise.all(p.assets.map(
          async asset => +formatUnits(await priceOracle.getAssetPrice(asset.address), 18)
        ))
      }
    }
    describe("Good paths", () => {
      it("should return expected value for USDC", async () => {
        const r = await getAssetPrice({assets: [usdc, dai, matic], prices: ["2", "3.5", "0.1"]});
        expect(r.prices.join()).eq([2, 3.5, 0.1].join());
      });
    });
    describe("Bad paths", () => {
      it("should return 0 if the asset is unknown", async () => {
        const priceOracle = await CoreContractsHelper.createPriceOracle(deployer, priceOracleMocked.address);
        await priceOracleMocked.setThrowIfZeroPrice();
        const ret = await priceOracle.getAssetPrice(weth.address);
        expect(ret.eq(0)).eq(true);
      });
    });
  });
//endregion Unit tests

});