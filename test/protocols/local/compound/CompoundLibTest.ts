import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HARDHAT_NETWORK_ID, HardhatUtils, } from "../../../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {
  CompoundCTokenBaseMock,
  CompoundLibFacade,
  MockERC20,
  CompoundPriceOracleMock,
  CompoundInterestRateModelMock, IERC20Metadata__factory
} from "../../../../typechain";
import {expect} from "chai";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {MocksHelper} from "../../../baseUT/app/MocksHelper";

describe("CompoundLibTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let deployer: SignerWithAddress;
  let facade: CompoundLibFacade;
  let usdc: MockERC20;
  let usdt: MockERC20;
  let dai: MockERC20;
  let weth: MockERC20;

  let cUsdc: CompoundCTokenBaseMock;
  let cUsdt: CompoundCTokenBaseMock;
  let cDai: CompoundCTokenBaseMock;
  let cWeth: CompoundCTokenBaseMock;

//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    facade = await DeployUtils.deployContract(deployer, "CompoundLibFacade") as CompoundLibFacade;

    usdc = await DeployUtils.deployContract(deployer, 'MockERC20', 'USDC', 'USDC', 6) as MockERC20;
    usdt = await DeployUtils.deployContract(deployer, 'MockERC20', 'USDT', 'USDT', 6) as MockERC20;
    dai = await DeployUtils.deployContract(deployer, 'MockERC20', 'Dai', 'DAI', 18) as MockERC20;
    weth = await DeployUtils.deployContract(deployer, 'MockERC20', 'Wrapped Ether', 'WETH', 18) as MockERC20;

    cUsdc = await MocksHelper.createCompoundCTokenBaseMock(deployer, "cUsdc", 18);
    await cUsdc.setUnderlying(usdc.address);
    cUsdt = await MocksHelper.createCompoundCTokenBaseMock(deployer, "cUsdt", 18);
    await cUsdt.setUnderlying(usdt.address);
    cDai = await MocksHelper.createCompoundCTokenBaseMock(deployer, "cDai", 18)
    await cDai.setUnderlying(dai.address);
    cWeth = await MocksHelper.createCompoundCTokenBaseMock(deployer, "cWeth", 18)
    await cWeth.setUnderlying(weth.address);
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

//endregion before, after

//region Unit tests
  describe("getUnderlying", () => {
    interface IGetUnderlyingParams {
      cToken: CompoundCTokenBaseMock;
      nativeToken: MockERC20;
      cTokenNative: CompoundCTokenBaseMock;
    }
    interface IGetUnderlyingResults {
      underlying: string;
    }

    async function getUnderlying(p: IGetUnderlyingParams): Promise<IGetUnderlyingResults> {
      const underlying = await facade.getUnderlying(
        {
          cTokenNative: p.cTokenNative.address,
          nativeToken: p.nativeToken.address,
          compoundStorageVersion: 0 // not used here
        },
        p.cToken.address
      );
      return { underlying };
    }

    describe("not native tokens", () => {
      let snapshotLocal: string;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      async function getUnderlyingTest(): Promise<IGetUnderlyingResults> {
        return getUnderlying({
          cTokenNative: cWeth,
          nativeToken: weth,
          cToken: cUsdc
        });
      }

      it("should return expected underlying asset", async () => {
        const ret = await loadFixture(getUnderlyingTest);
        expect(ret.underlying).eq(usdc.address);
      });
    });

    describe("native tokens", () => {
      let snapshotLocal: string;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      async function getUnderlyingTest(): Promise<IGetUnderlyingResults> {
        return getUnderlying({
          cTokenNative: cWeth,
          nativeToken: dai, // use dai instead weth to be sure that the value is taken from ProtocolFeatures
          cToken: cWeth
        });
      }

      it("should return expected underlying asset", async () => {
        const ret = await loadFixture(getUnderlyingTest);
        expect(ret.underlying).eq(dai.address);
      });
    });
  });

  describe("getPrice", () => {
    interface IGetPriceParams {
      cTokens: CompoundCTokenBaseMock[];
      prices: string[];
      priceDecimals: number;
    }

    async function preparePriceOracle(p: IGetPriceParams): Promise<CompoundPriceOracleMock> {
      const oracle = await DeployUtils.deployContract(deployer, 'CompoundPriceOracleMock') as CompoundPriceOracleMock;
      for (let i = 0; i < p.cTokens.length; ++i) {
        oracle.setUnderlyingPrice(p.cTokens[i].address, parseUnits(p.prices[i], p.priceDecimals));
      }
      return oracle;
    }

    describe("Two registered cTokens", () => {
      let snapshotLocal: string;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      async function getPriceTest(): Promise<CompoundPriceOracleMock> {
        return preparePriceOracle({
          cTokens: [cUsdc, cUsdt],
          priceDecimals: 7,
          prices: ["1.1", "1.7"],
        });
      }

      it("should return expected price if cToken is registered", async () => {
        const oracle = await loadFixture(getPriceTest);
        const price = +formatUnits(await facade.getPrice(oracle.address, cUsdt.address), 7);
        expect(price).eq(1.7);
      });

      it("should revert if cToken is not registered", async () => {
        const oracle = await loadFixture(getPriceTest);
        await expect(facade.getPrice(oracle.address, cWeth.address)).revertedWith("TC-4 zero price"); // ZERO_PRICE
      });
    });
  });
});