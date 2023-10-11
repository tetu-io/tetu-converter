import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HARDHAT_NETWORK_ID, HardhatUtils, } from "../../../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {
  MockERC20,
  CompoundCTokenBaseMock,
  CompoundPoolAdapterLibFacade,
  ConverterController,
  Borrower,
  IERC20Metadata__factory,
  CompoundComptrollerMock,
  TokenAddressProviderMock,
  IERC20__factory,
  CompoundComptrollerMockV2,
  CompoundComptrollerMockV1,
} from "../../../../typechain";
import {TetuConverterApp} from "../../../baseUT/app/TetuConverterApp";
import {MocksHelper} from "../../../baseUT/app/MocksHelper";
import {BigNumber} from "ethers";
import {stat} from "fs";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {Misc} from "../../../../scripts/utils/Misc";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";
import {AppConstants} from "../../../baseUT/types/AppConstants";

describe("CompoundPoolAdapterLibTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;
  let controller: ConverterController;
  let userContract: Borrower;
  let facade: CompoundPoolAdapterLibFacade;
  let comptrollerV1: CompoundComptrollerMockV1;
  let comptrollerV2: CompoundComptrollerMockV2;
  let tokenAddressProviderMock: TokenAddressProviderMock;

  let usdc: MockERC20;
  let usdt: MockERC20;
  let dai: MockERC20;
  let weth: MockERC20;

  let cUsdc: CompoundCTokenBaseMock;
  let cUsdt: CompoundCTokenBaseMock;
  let cDai: CompoundCTokenBaseMock;
  let cWeth: CompoundCTokenBaseMock;

  let randomAddress: string;

//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];
    facade = await DeployUtils.deployContract(signer, "CompoundPoolAdapterLibFacade") as CompoundPoolAdapterLibFacade;
    comptrollerV1 = await MocksHelper.createCompoundComptrollerMockV1(signer);
    comptrollerV2 = await MocksHelper.createCompoundComptrollerMockV2(signer);
    tokenAddressProviderMock = await DeployUtils.deployContract(signer, "TokenAddressProviderMock") as TokenAddressProviderMock;

    usdc = await DeployUtils.deployContract(signer, 'MockERC20', 'USDC', 'USDC', 6) as MockERC20;
    usdt = await DeployUtils.deployContract(signer, 'MockERC20', 'USDT', 'USDT', 6) as MockERC20;
    dai = await DeployUtils.deployContract(signer, 'MockERC20', 'Dai', 'DAI', 18) as MockERC20;
    weth = await DeployUtils.deployContract(signer, 'MockERC20', 'Wrapped Ether', 'WETH', 18) as MockERC20;

    cUsdc = await MocksHelper.createCompoundCTokenBaseMock(signer, "cUsdc", 18);
    await cUsdc.setUnderlying(usdc.address);
    cUsdt = await MocksHelper.createCompoundCTokenBaseMock(signer, "cUsdt", 18);
    await cUsdt.setUnderlying(usdt.address);
    cDai = await MocksHelper.createCompoundCTokenBaseMock(signer, "cDai", 18)
    await cDai.setUnderlying(dai.address);
    cWeth = await MocksHelper.createCompoundCTokenBaseMock(signer, "cWeth", 18)
    await cWeth.setUnderlying(weth.address);

    controller = await TetuConverterApp.createController(signer);
    userContract = await MocksHelper.deployBorrower(signer.address, controller, 1);

    randomAddress = ethers.Wallet.createRandom().address;
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

//endregion before, after

//region Utils
  interface IState {
    collateralAsset: string;
    borrowAsset: string;
    collateralCToken: string;
    borrowCToken: string;
    user: string;
    controller: string;
    comptroller: string;
    originConverter: string;
    collateralTokensBalance: BigNumber;
  }
  interface IStateNum {
    collateralAsset: string;
    borrowAsset: string;
    collateralCToken: string;
    borrowCToken: string;
    user: string;
    controller: string;
    comptroller: string;
    originConverter: string;
    collateralTokensBalance: number;
  }
  async function getStateNum(state: IState): Promise<IStateNum> {
    return {
      borrowAsset: state.borrowAsset,
      borrowCToken: state.borrowCToken,
      collateralAsset: state.collateralAsset,
      collateralCToken: state.collateralCToken,
      controller: state.controller,
      collateralTokensBalance: +formatUnits(state.collateralTokensBalance, await IERC20Metadata__factory.connect(state.collateralCToken, signer).decimals()),
      user: state.user,
      comptroller: state.comptroller,
      originConverter: state.originConverter
    }
  }//endregion Utils

//region Unit tests
  describe("initialize", () => {
    interface IParams {
      controller: string;
      cTokenAddressProvider: string;
      comptroller: string;
      user: string;
      collateralAsset: string;
      borrowAsset: string;
      originConverter: string;
    }

    interface IResults {
      infiniteCollateralApprove: boolean;
      infiniteBorrowApprove: boolean;
      state: IStateNum;
    }

    async function initialize(p: IParams): Promise<IResults> {
      await facade.initialize(
        p.controller,
        p.cTokenAddressProvider,
        p.comptroller,
        p.user,
        p.collateralAsset,
        p.borrowAsset,
        p.originConverter
      );

      const state = await facade.getState();
      const collateralAllowance = await IERC20Metadata__factory.connect(p.collateralAsset, signer).allowance(facade.address, state.collateralCToken);
      const borrowAllowance = await IERC20Metadata__factory.connect(p.borrowAsset, signer).allowance(facade.address, state.borrowCToken);
      return {
        state: await getStateNum(state),
        infiniteBorrowApprove: collateralAllowance.eq(Misc.HUGE_UINT),
        infiniteCollateralApprove: borrowAllowance.eq(Misc.HUGE_UINT),
      };
    }

    describe("Good paths", () => {
      describe("Normal case", () => {
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function initializeTest(): Promise<IResults> {
          await tokenAddressProviderMock.initExplicit(usdc.address, cUsdc.address, usdt.address, cUsdt.address);
          return initialize({
            controller: controller.address,
            comptroller: comptrollerV2.address,
            cTokenAddressProvider: tokenAddressProviderMock.address,
            user: userContract.address,
            collateralAsset: usdc.address,
            borrowAsset: usdt.address,
            originConverter: randomAddress
          })
        }

        it("should set expected controller and comptroller", async () => {
          const {state} = await loadFixture(initializeTest);
          expect([state.controller, state.comptroller].join()).eq([controller.address, comptrollerV2.address].join());
        });
        it("should set expected user and originConverter", async () => {
          const {state} = await loadFixture(initializeTest);
          expect([state.user, state.originConverter].join()).eq([userContract.address, randomAddress].join());
        });
        it("should set expected assets", async () => {
          const {state} = await loadFixture(initializeTest);
          expect([state.collateralAsset, state.borrowAsset].join()).eq([usdc.address, usdt.address].join());
        });
        it("should set expected c-token", async () => {
          const {state} = await loadFixture(initializeTest);
          expect([state.collateralCToken, state.borrowCToken].join()).eq([cUsdc.address, cUsdt.address].join());
        });
        it("should set zero collateralTokensBalance", async () => {
          const {state} = await loadFixture(initializeTest);
          expect(state.collateralTokensBalance).eq(0);
        });
        it("should set infinite allowance of collateral-asset for cTokenCollateral", async () => {
          const {infiniteCollateralApprove} = await loadFixture(initializeTest);
          expect(infiniteCollateralApprove).eq(true);
        });
        it("should set infinite allowance of borrow-asset for cTokenBorrow", async () => {
          const {infiniteBorrowApprove} = await loadFixture(initializeTest);
          expect(infiniteBorrowApprove).eq(true);
        });
      });
      describe("Bad paths", () => {
        let snapshotLocal: string;
        beforeEach(async function () {
          snapshotLocal = await TimeUtils.snapshot();
        });
        afterEach(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function initializeTest(p: {
          controller?: string;
          cTokenAddressProvider?: string;
          comptroller?: string;
          user?: string;
          collateralAsset?: string;
          borrowAsset?: string;
          originConverter?: string;
        }): Promise<IResults> {
          await tokenAddressProviderMock.initExplicit(
            usdc.address,
            cUsdc.address,
            usdt.address,
            cUsdt.address
          );
          return initialize({
            controller: p?.controller || controller.address,
            comptroller: p?.comptroller || comptrollerV2.address,
            cTokenAddressProvider: p?.cTokenAddressProvider || tokenAddressProviderMock.address,
            user: p?.user || userContract.address,
            borrowAsset: p?.borrowAsset || usdc.address,
            collateralAsset: p?.collateralAsset || usdt.address,
            originConverter: p?.originConverter || randomAddress
          })
        }

        it("should revert if controller is zero", async () => {
          await expect(initializeTest({controller: Misc.ZERO_ADDRESS})).rejectedWith("TC-1 zero address"); // ZERO_ADDRESS
        });
        it("should revert if originConverter is zero", async () => {
          await expect(initializeTest({originConverter: Misc.ZERO_ADDRESS})).rejectedWith("TC-1 zero address"); // ZERO_ADDRESS
        });
        it("should revert if borrowAsset is zero", async () => {
          await expect(initializeTest({borrowAsset: Misc.ZERO_ADDRESS})).rejectedWith("TC-1 zero address"); // ZERO_ADDRESS
        });
        it("should revert if collateralAsset is zero", async () => {
          await expect(initializeTest({collateralAsset: Misc.ZERO_ADDRESS})).rejectedWith("TC-1 zero address"); // ZERO_ADDRESS
        });
        it("should revert if comptroller is zero", async () => {
          await expect(initializeTest({comptroller: Misc.ZERO_ADDRESS})).rejectedWith("TC-1 zero address"); // ZERO_ADDRESS
        });
        it("should revert if cTokenAddressProvider is zero", async () => {
          await expect(initializeTest({cTokenAddressProvider: Misc.ZERO_ADDRESS})).rejectedWith("TC-1 zero address"); // ZERO_ADDRESS
        });
        it("should revert if user is zero", async () => {
          await expect(initializeTest({user: Misc.ZERO_ADDRESS})).rejectedWith("TC-1 zero address"); // ZERO_ADDRESS
        });
      });
    });
  });

  describe("_supply", () => {
    interface IParams {
      initialTokenBalance?: string;

      cTokenCollateral: CompoundCTokenBaseMock;
      collateralAsset: MockERC20;
      amountCollateral: string;

      nativeCToken?: string; // cEther by default
      nativeToken?: string; // ether by default
    }

    interface IResults {
      tokenBalanceBefore: number;
      tokenBalanceAfter: number;
      userAssetBalanceBefore: number;
      userAssetBalanceAfter: number;
    }

    async function supply(p: IParams): Promise<IResults> {
      const decimalsCTokenCollateral = await p.cTokenCollateral.decimals();
      const decimalsCollateral = await p.collateralAsset.decimals();
      const amountCollateral = parseUnits(p.amountCollateral, decimalsCollateral);

      await facade.setProtocolFeatures({
        cTokenNative: p?.nativeCToken || cWeth.address, // todo
        nativeToken: p?.nativeCToken || weth.address, // todo
        compoundStorageVersion: 1
      });

      if (p.initialTokenBalance) {
        await p.cTokenCollateral["mint(address,uint256)"](facade.address, parseUnits(p.initialTokenBalance, decimalsCTokenCollateral));
      }

      // send amount to facade
      await p.collateralAsset.mint(facade.address, amountCollateral);
      const userAssetBalanceBefore = await p.collateralAsset.balanceOf(facade.address);

      // infinite approve
      const signerFacade = await Misc.impersonate(facade.address);
      await IERC20__factory.connect(p.collateralAsset.address, signerFacade).approve(
        p.cTokenCollateral.address,
        Misc.HUGE_UINT
      );

      const tokenBalanceBefore = await facade.callStatic._supply(p.cTokenCollateral.address, p.collateralAsset.address, amountCollateral);
      await facade._supply(p.cTokenCollateral.address, p.collateralAsset.address, amountCollateral);

      const tokenBalanceAfter = await p.cTokenCollateral.balanceOf(facade.address);

      return {
        tokenBalanceBefore: +formatUnits(tokenBalanceBefore, decimalsCTokenCollateral),
        tokenBalanceAfter: +formatUnits(tokenBalanceAfter, decimalsCTokenCollateral),
        userAssetBalanceBefore:  +formatUnits(userAssetBalanceBefore, decimalsCollateral),
        userAssetBalanceAfter: +formatUnits(await p.collateralAsset.balanceOf(facade.address), decimalsCollateral)
      }
    }

    describe("Collateral is not native token", () => {
      describe("Normal case", () => {
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function supplyTest(): Promise<IResults> {
          return supply({
            collateralAsset: dai,
            cTokenCollateral: cDai,
            amountCollateral: "1",
            initialTokenBalance: "2"
          });
        }

        it("should return expected balance of cToken", async () => {
          const ret = await loadFixture(supplyTest);
          expect([ret.tokenBalanceBefore, ret.tokenBalanceAfter].join()).eq([2, 3].join());
        });
        it("should return expected balance of collateral", async () => {
          const ret = await loadFixture(supplyTest);
          expect([ret.userAssetBalanceBefore, ret.userAssetBalanceAfter].join()).eq([1, 0].join());
        });
      });
      describe("Bad paths", () => {
        let snapshotLocal: string;
        beforeEach(async function () {
          snapshotLocal = await TimeUtils.snapshot();
        });
        afterEach(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        it("should revert if mint produces an error", async () => {
          await cDai.setMintErrorCode(999);
          await expect(supply({
            collateralAsset: dai,
            cTokenCollateral: cDai,
            amountCollateral: "1",
            initialTokenBalance: "2"
          })).rejectedWith("TC-17 mint failed:999"); // MINT_FAILED
        });
      });
    });
  });

  describe("_getCollateralFactor", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IParams {
      cTokenCollateral: CompoundCTokenBaseMock;
      compoundStorageVersion: number;
      collateralFactor: string;
    }

    interface IResults {
      collateralFactor: number;
    }

    async function getCollateralFactor(p: IParams): Promise<IResults> {
      const comptroller = p.compoundStorageVersion === AppConstants.COMPOUND_STORAGE_V1
        ? comptrollerV1
        : comptrollerV2;

      if (p.compoundStorageVersion === AppConstants.COMPOUND_STORAGE_V1) {
        await comptrollerV1.setMarkets(p.cTokenCollateral.address, false, parseUnits(p.collateralFactor, 5));
      } else {
        await comptrollerV2.setMarkets(p.cTokenCollateral.address, false, parseUnits(p.collateralFactor, 5), false);
      }

      await facade.setProtocolFeatures({
        cTokenNative: cWeth.address,
        nativeToken: weth.address,
        compoundStorageVersion: p.compoundStorageVersion
      });
      const collateralFactor = await facade._getCollateralFactor(comptroller.address, p.cTokenCollateral.address);
      return {
        collateralFactor: +formatUnits(collateralFactor, 5)
      }
    }
    describe("ICompoundComptrollerBaseV1", () => {
      describe("Normal case", () => {
        it("should return expected collateral factor", async () => {
          const {collateralFactor} = await getCollateralFactor({
            collateralFactor: "0.1",
            cTokenCollateral: cDai,
            compoundStorageVersion: 1
          });
          expect(collateralFactor).eq(0.1);
        })
      });
    });
    describe("ICompoundComptrollerBaseV2", () => {
      describe("Normal case", () => {
        it("should return expected collateral factor", async () => {
          const {collateralFactor} = await getCollateralFactor({
            collateralFactor: "0.1",
            cTokenCollateral: cDai,
            compoundStorageVersion: 2
          });
          expect(collateralFactor).eq(0.1);
        })
      });
    });
  });

  describe("_getHealthFactor", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IParams {
      collateralFactor: string;
      collateralAmountBase: string;
      borrowAmountBase: string;
    }

    interface IResults {
      collateralAmountBaseSafeToUse: number;
      healthFactor: number;
    }

    async function getHealthFactor(p: IParams): Promise<IResults> {
      const ret = await facade._getHealthFactor(
        parseUnits(p.collateralFactor, 18),
        parseUnits(p.collateralAmountBase, 8),
        parseUnits(p.borrowAmountBase, 8),
      );
      return {
        healthFactor: ret.healthFactor18.eq(Misc.MAX_UINT)
          ? Number.MAX_VALUE
          : +formatUnits(ret.healthFactor18, 18),
        collateralAmountBaseSafeToUse: +formatUnits(ret.collateralAmountBaseSafeToUse, 8)
      }
    }

    it("should return expected values in normal case", async () => {
      const {collateralAmountBaseSafeToUse, healthFactor} = await getHealthFactor({
        collateralAmountBase: "800",
        borrowAmountBase: "500",
        collateralFactor: "0.5"
      });
      expect([collateralAmountBaseSafeToUse, healthFactor].join()).eq([400, 0.8].join());
    });

    it("should return healthFactor=MAX_UINT if there is no borrow", async () => {
      const {collateralAmountBaseSafeToUse, healthFactor} = await getHealthFactor({
        collateralAmountBase: "800",
        borrowAmountBase: "0",
        collateralFactor: "0.5"
      });
      expect([collateralAmountBaseSafeToUse, healthFactor].join()).eq([400, Number.MAX_VALUE].join());
    });
  });

  describe("_validateHealthStatusAfterBorrow", () => {
    interface IParams {
      initialTokenBalance?: string;

      cTokenCollateral: CompoundCTokenBaseMock;
      cTokenBorrow: CompoundCTokenBaseMock;

      nativeCToken?: string; // cEther by default
      nativeToken?: string; // ether by default
    }

    interface IResults {
      tokenBalanceBefore: number;
      tokenBalanceAfter: number;
      userAssetBalanceBefore: number;
      userAssetBalanceAfter: number;
    }

    async function validateHealthStatusAfterBorrow(p: IParams): Promise<IResults> {

    }

    describe("Normal case", () => {

    });
    describe("Bad paths", () => {

    });
  });
//endregion Unit tests
});