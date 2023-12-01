import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HardhatUtils, ZKEVM_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {CompoundLibFacade, ICompoundPriceOracle__factory, IERC20Metadata, IERC20Metadata__factory, CompoundAprLibFacade, IZerovixToken, IZerovixToken__factory} from "../../../typechain";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";

describe("Zerovix: CompoundLibTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let deployer: SignerWithAddress;
  let facade: CompoundLibFacade;
  let facadeApr: CompoundAprLibFacade;
  let usdc: IERC20Metadata;
  let usdt: IERC20Metadata;
  let weth: IERC20Metadata;

  let cUsdc: IZerovixToken;
  let cWeth: IZerovixToken;

//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(ZKEVM_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    facade = await DeployUtils.deployContract(deployer, "CompoundLibFacade") as CompoundLibFacade;
    facadeApr = await DeployUtils.deployContract(deployer, "CompoundAprLibFacade") as CompoundAprLibFacade;

    usdc = IERC20Metadata__factory.connect(ZkevmAddresses.USDC, deployer);
    usdt = IERC20Metadata__factory.connect(ZkevmAddresses.USDT, deployer);
    weth = IERC20Metadata__factory.connect(ZkevmAddresses.WETH, deployer);

    cUsdc = IZerovixToken__factory.connect(ZkevmAddresses.oUSDC, deployer);
    cWeth = IZerovixToken__factory.connect(ZkevmAddresses.oUSDT, deployer);
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

//endregion before, after

//region Unit tests
  describe("getUnderlying", () => {
    interface IGetUnderlyingParams {
      cToken: IZerovixToken;
      nativeToken: IERC20Metadata;
      cTokenNative: IZerovixToken;
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
        expect(ret.underlying.toLowerCase()).eq(usdc.address.toLowerCase());
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
          nativeToken: usdt, // use dai instead weth to be sure that the value is taken from ProtocolFeatures
          cToken: cWeth
        });
      }

      it("should return expected underlying asset", async () => {
        const ret = await loadFixture(getUnderlyingTest);
        expect(ret.underlying.toLowerCase()).eq(usdt.address.toLowerCase());
      });
    });
  });

  describe("getPrice", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    it("should return expected price if cToken is registered", async () => {
      const oracle = ICompoundPriceOracle__factory.connect(ZkevmAddresses.ZEROVIX_PRICE_ORACLE, deployer);
      const price = +formatUnits(await facade.getPrice(oracle.address, cUsdc.address), 36-6);
      expect(price).approximately(1, 0.1);
    });

    it("should revert if cToken is not registered", async () => {
      const unknownAsset = ethers.Wallet.createRandom().address;
      const oracle = ICompoundPriceOracle__factory.connect(ZkevmAddresses.ZEROVIX_PRICE_ORACLE, deployer);
      await expect(facade.getPrice(oracle.address, unknownAsset)).revertedWith("TC-4 zero price"); // ZERO_PRICE
    });
  });

  describe("getEstimatedBorrowRate", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IGetEstimatedBorrowRateParams {
      cTokenToBorrow: IZerovixToken;
      amountToBorrow: string;
    }
    interface IGetEstimatedBorrowRateResults {
      currentRate: number;
      expectedRate: number;
    }

    async function getEstimatedBorrowRate(p: IGetEstimatedBorrowRateParams): Promise<IGetEstimatedBorrowRateResults> {
      const decimalsBorrow = await IERC20Metadata__factory.connect(await p.cTokenToBorrow.underlying(), deployer).decimals();
      const model = await p.cTokenToBorrow.interestRateModel();

      // ~881121350
      const currentRate = await p.cTokenToBorrow.callStatic.borrowRatePerTimestamp();

      const rate = await facadeApr.getEstimatedBorrowRate(
        model,
        p.cTokenToBorrow.address,
        parseUnits(p.amountToBorrow, decimalsBorrow)
      );

      return {
        expectedRate: +formatUnits(rate, decimalsBorrow),
        currentRate: +formatUnits(currentRate, decimalsBorrow),
      };
    }

    it("should return current rate for zero amount to borrow", async () => {
      const ret = await getEstimatedBorrowRate({
        cTokenToBorrow: cUsdc,
        amountToBorrow: "0",
      });
      expect(ret.expectedRate).eq(ret.currentRate);
    });

    it("should return increased rate for not-zero amount to borrow", async () => {
      const ret = await getEstimatedBorrowRate({
        cTokenToBorrow: cUsdc,
        amountToBorrow: "11",
      });
      expect(ret.expectedRate).gt(ret.currentRate);
    });
  });

  describe("getEstimatedSupplyRate", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IGetEstimatedSupplyRateParams {
      cTokenToSupply: IZerovixToken;
      amountToSupply: string;
    }
    interface IGetEstimatedSupplyRateResults {
      expectedRate: number;
      currentRate: number;
    }

    async function getEstimatedSupplyRate(p: IGetEstimatedSupplyRateParams): Promise<IGetEstimatedSupplyRateResults> {
      const decimalsCollateral = await IERC20Metadata__factory.connect(await p.cTokenToSupply.underlying(), deployer).decimals();

      const model = await p.cTokenToSupply.interestRateModel();

      // ~462470961
      const currentRate = await p.cTokenToSupply.callStatic.supplyRatePerTimestamp();

      const rate = await facadeApr.getEstimatedSupplyRate(
        model,
        p.cTokenToSupply.address,
        parseUnits(p.amountToSupply, decimalsCollateral)
      );
      return {
        expectedRate: +formatUnits(rate, decimalsCollateral),
        currentRate: +formatUnits(currentRate, decimalsCollateral),
      };
    }

    it("should return current rate for zero amount to supply", async () => {
      const ret = await getEstimatedSupplyRate({
        cTokenToSupply: cUsdc,
        amountToSupply: "0",
      });
      expect(ret.expectedRate).eq(ret.currentRate);
    });
    it("should return reduced rate for not-zero amount to supply", async () => {
      const ret = await getEstimatedSupplyRate({
        cTokenToSupply: cUsdc,
        amountToSupply: "11",
      });
      expect(ret.expectedRate).lt(ret.currentRate);
    });
  });
});