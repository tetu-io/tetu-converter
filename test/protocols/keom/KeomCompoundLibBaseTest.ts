import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HardhatUtils, ZKEVM_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {CompoundLibFacade, ICompoundPriceOracle__factory, IERC20Metadata, IERC20Metadata__factory, CompoundAprLibFacade, IKeomToken, IKeomToken__factory} from "../../../typechain";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {IKeomCore} from "../../baseUT/protocols/keom/IKeomCore";
import {ZkevmCore} from "../../baseUT/chains/zkevm/ZkevmCore";

describe("Keom: CompoundLibTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let deployer: SignerWithAddress;
  let facade: CompoundLibFacade;
  let facadeApr: CompoundAprLibFacade;
  let usdc: IERC20Metadata;
  let usdt: IERC20Metadata;
  let weth: IERC20Metadata;

  let kUsdc: IKeomToken;
  let kWeth: IKeomToken;
//endregion Global vars for all tests

//region Constants
  interface IChainInfo {
    chain: number;
    core: IKeomCore;
  }
  const NETWORKS: IChainInfo[] = [
    {
      chain: ZKEVM_NETWORK_ID,
      core: ZkevmCore.getCoreKeom()
    }
  ]
//endregion Constants

  NETWORKS.forEach(function(chainInfo: IChainInfo) {
    before(async function () {
      await HardhatUtils.setupBeforeTest(chainInfo.chain);
      this.timeout(1200000);
      snapshot = await TimeUtils.snapshot();
      const signers = await ethers.getSigners();
      deployer = signers[0];
      facade = await DeployUtils.deployContract(deployer, "CompoundLibFacade") as CompoundLibFacade;
      facadeApr = await DeployUtils.deployContract(deployer, "CompoundAprLibFacade") as CompoundAprLibFacade;

      usdc = IERC20Metadata__factory.connect(chainInfo.core.usdc, deployer);
      usdt = IERC20Metadata__factory.connect(chainInfo.core.usdt, deployer);
      weth = IERC20Metadata__factory.connect(chainInfo.core.weth, deployer);

      kUsdc = IKeomToken__factory.connect(chainInfo.core.kUsdc, deployer);
      kWeth = IKeomToken__factory.connect(chainInfo.core.kWeth, deployer);
    });

    after(async function () {
      await TimeUtils.rollback(snapshot);
    });


    describe("getUnderlying", () => {
      interface IGetUnderlyingParams {
        cToken: IKeomToken;
        nativeToken: IERC20Metadata;
        cTokenNative: IKeomToken;
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
        return {underlying};
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
            cTokenNative: kWeth,
            nativeToken: weth,
            cToken: kUsdc
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
            cTokenNative: kWeth,
            nativeToken: usdt, // use dai instead weth to be sure that the value is taken from ProtocolFeatures
            cToken: kWeth
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
        const oracle = ICompoundPriceOracle__factory.connect(chainInfo.core.priceOracle, deployer);
        const price = +formatUnits(await facade.getPrice(oracle.address, kUsdc.address), 36 - 6);
        expect(price).approximately(1, 0.1);
      });

      it("should revert if cToken is not registered", async () => {
        const unknownAsset = ethers.Wallet.createRandom().address;
        const oracle = ICompoundPriceOracle__factory.connect(chainInfo.core.priceOracle, deployer);
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
        cTokenToBorrow: IKeomToken;
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
          cTokenToBorrow: kUsdc,
          amountToBorrow: "0",
        });
        expect(ret.expectedRate).eq(ret.currentRate);
      });

      it("should return increased rate for not-zero amount to borrow", async () => {
        const ret = await getEstimatedBorrowRate({
          cTokenToBorrow: kUsdc,
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
        cTokenToSupply: IKeomToken;
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
          cTokenToSupply: kUsdc,
          amountToSupply: "0",
        });
        expect(ret.expectedRate).eq(ret.currentRate);
      });
      it("should return reduced rate for not-zero amount to supply", async () => {
        const ret = await getEstimatedSupplyRate({
          cTokenToSupply: kUsdc,
          amountToSupply: "11",
        });
        expect(ret.expectedRate).lt(ret.currentRate);
      });
    });
  });
});