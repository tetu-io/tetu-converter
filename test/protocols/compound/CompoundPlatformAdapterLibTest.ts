import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HARDHAT_NETWORK_ID, HardhatUtils, } from "../../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {MockERC20, CompoundPlatformAdapterLibFacade, CompoundCTokenBaseMock, PoolAdapterInitializerWithAPMock, BorrowManagerMock, ConverterControllerMock, MockERC20__factory, CompoundPriceOracleMock, IERC20Metadata__factory, CompoundInterestRateModelMock} from "../../../typechain";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {Misc} from "../../../scripts/utils/Misc";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {AppConstants} from "../../baseUT/types/AppConstants";
import {MocksHelper} from "../../baseUT/app/MocksHelper";

describe("CompoundPlatformAdapterLibTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let deployer: SignerWithAddress;
  let facade: CompoundPlatformAdapterLibFacade;
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
    facade = await DeployUtils.deployContract(deployer, "CompoundPlatformAdapterLibFacade") as CompoundPlatformAdapterLibFacade;

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

//region Utils
  interface ISetStateParams {
    controller: string;
    comptroller: string;
    converter: string;
    frozen: boolean;
    underlying: MockERC20[];
    cTokens: CompoundCTokenBaseMock[];
  }
  async function setState(p: ISetStateParams) {
    await facade.setState(
      p.controller,
      p.comptroller,
      p.converter,
      p.frozen,
      p.underlying.map(x => x.address),
      p.cTokens.map(x => x.address)
    );
  }

//endregion Utils

//region Unit tests
  describe("init", () => {
    interface IParams {
      protocolFeatures: {
        nativeToken: MockERC20;
        cTokenNative: CompoundCTokenBaseMock;
      }
      controller: string;
      comptroller: string;
      templatePoolAdapter: string;
      cTokens: CompoundCTokenBaseMock[];

      underlying: MockERC20[];
    }
    interface IResults {
      controllerExpected: boolean;
      comptrollerExpected: boolean;
      templatePoolAdapterExpected: boolean;
      cTokens: string[];
    }

    async function init(p: IParams): Promise<IResults> {
      await facade.init(
        {
          cTokenNative: p.protocolFeatures.cTokenNative.address,
          nativeToken: p.protocolFeatures.nativeToken.address,
          compoundStorageVersion: 0 // not used here
        },
        p.controller,
        p.comptroller,
        p.templatePoolAdapter,
        p.cTokens.map(x => x.address)
      );

      const state = await facade.getState();
      return {
        controllerExpected: state.controller.toLowerCase() === p.controller.toLowerCase(),
        comptrollerExpected: state.comptroller.toLowerCase() === p.comptroller.toLowerCase(),
        templatePoolAdapterExpected: state.converter.toLowerCase() === p.templatePoolAdapter.toLowerCase(),
        cTokens: await Promise.all(p.underlying.map(
          async x => facade.getActiveAsset(x.address)
        ))
      }
    }

    describe("Normal case", () => {
      let snapshotLocal: string;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      async function initTest(): Promise<IResults> {
        return init({
          controller: ethers.Wallet.createRandom().address,
          comptroller: ethers.Wallet.createRandom().address,
          templatePoolAdapter: ethers.Wallet.createRandom().address,
          cTokens: [cUsdc, cDai, cWeth],
          underlying: [dai, weth, usdc],
          protocolFeatures: {
            nativeToken: weth,
            cTokenNative: cWeth
          }
        })
      }

      it("should set expected addresses", async () => {
        const ret = await loadFixture(initTest);
        expect(ret.controllerExpected).eq(true);
        expect(ret.comptrollerExpected).eq(true);
        expect(ret.templatePoolAdapterExpected).eq(true);
      });

      it("should set expected active assets", async () => {
        const ret = await loadFixture(initTest);
        expect(ret.cTokens.join().toLowerCase()).eq([cDai.address, cWeth.address, cUsdc.address].join().toLowerCase());
      });
    });
    describe("Bad paths", () => {
      it("should revert if controller is zero", async () => {
        await expect(init({
          controller: Misc.ZERO_ADDRESS,
          comptroller: ethers.Wallet.createRandom().address,
          templatePoolAdapter: ethers.Wallet.createRandom().address,
          cTokens: [cUsdc, cDai, cWeth],
          underlying: [dai, weth, usdc],
          protocolFeatures: {nativeToken: weth, cTokenNative: cWeth}
        })).revertedWith("TC-1 zero address") // ZERO_ADDRESS
      });

      it("should revert if comptroller is zero", async () => {
        await expect(init({
          controller: ethers.Wallet.createRandom().address,
          comptroller: Misc.ZERO_ADDRESS,
          templatePoolAdapter: ethers.Wallet.createRandom().address,
          cTokens: [cUsdc, cDai, cWeth],
          underlying: [dai, weth, usdc],
          protocolFeatures: {nativeToken: weth, cTokenNative: cWeth}
        })).revertedWith("TC-1 zero address") // ZERO_ADDRESS
      });

      it("should revert if templatePoolAdapter is zero", async () => {
        await expect(init({
          controller: ethers.Wallet.createRandom().address,
          comptroller: ethers.Wallet.createRandom().address,
          templatePoolAdapter: Misc.ZERO_ADDRESS,
          cTokens: [cUsdc, cDai, cWeth],
          underlying: [dai, weth, usdc],
          protocolFeatures: {nativeToken: weth, cTokenNative: cWeth}
        })).revertedWith("TC-1 zero address") // ZERO_ADDRESS
      });
    });
  });

  describe("initializePoolAdapter", () => {
    interface IParams {
      comptroller: string;
      converterForInit: string;
      user: string;
      collateralAsset: string;
      borrowAsset: string;

      senderIsNotBorrowManager?: boolean;
      converter?: string;
    }
    interface IResults {
      controllerExpected: boolean;
      cTokenAddressProviderExpected: boolean;
      poolExpected: boolean;
      userExpected: boolean;
      collateralAssetExpected: boolean;
      borrowAssetExpected: boolean;
      originConverterExpected: boolean;
    }

    async function init(p: IParams): Promise<IResults> {
      const paMock = await DeployUtils.deployContract(deployer, "PoolAdapterInitializerWithAPMock") as PoolAdapterInitializerWithAPMock;

      const borrowManager = await DeployUtils.deployContract(deployer, "BorrowManagerMock") as BorrowManagerMock;
      const controller = await DeployUtils.deployContract(deployer, "ConverterControllerMock") as ConverterControllerMock;
      await controller.setupBorrowManager(borrowManager.address);

      await facade.init(
        {
          cTokenNative: ethers.Wallet.createRandom().address,
          nativeToken: ethers.Wallet.createRandom().address,
          compoundStorageVersion: 0 // not used here
        },
        controller.address,
        p.comptroller,
        p.converterForInit,
        []
      );

      const sender = p.senderIsNotBorrowManager
        ? await Misc.impersonate(ethers.Wallet.createRandom().address)
        : await Misc.impersonate(borrowManager.address);

      await facade.connect(sender).initializePoolAdapter(
        p?.converter || p.converterForInit,
        paMock.address,
        p.user,
        p.collateralAsset,
        p.borrowAsset
      );

      return {
        controllerExpected: await paMock.controller() === controller.address,
        cTokenAddressProviderExpected: await paMock.cTokenAddressProvider() === facade.address,
        userExpected: await paMock.user() === p.user,
        borrowAssetExpected: await paMock.borrowAsset() === p.borrowAsset,
        poolExpected: await paMock.pool() === p.comptroller,
        collateralAssetExpected: await paMock.collateralAsset() === p.collateralAsset,
        originConverterExpected: await paMock.originConverter() === p.converterForInit
      }
    }

    describe("Normal case", () => {
      let snapshotLocal: string;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      async function initTest(): Promise<IResults> {
        return init({
          comptroller: ethers.Wallet.createRandom().address,
          user: ethers.Wallet.createRandom().address,
          converterForInit: ethers.Wallet.createRandom().address,
          collateralAsset: ethers.Wallet.createRandom().address,
          borrowAsset: ethers.Wallet.createRandom().address,
        });
      }

      it("should set expected addresses", async () => {
        const ret = await loadFixture(initTest);
        expect(ret.controllerExpected).eq(true);
        expect(ret.userExpected).eq(true);
        expect(ret.borrowAssetExpected).eq(true);
        expect(ret.poolExpected).eq(true);
        expect(ret.collateralAssetExpected).eq(true);
        expect(ret.originConverterExpected).eq(true);
        expect(ret.cTokenAddressProviderExpected).eq(true);
      });
    });

    describe("Bad paths", () => {
      it("should revert if msg sender is not borrowManager", async () => {
        await expect(init({
          comptroller: ethers.Wallet.createRandom().address,
          user: ethers.Wallet.createRandom().address,
          converterForInit: ethers.Wallet.createRandom().address,
          collateralAsset: ethers.Wallet.createRandom().address,
          borrowAsset: ethers.Wallet.createRandom().address,
          senderIsNotBorrowManager: true
        })).revertedWith("TC-45 borrow manager only"); // BORROW_MANAGER_ONLY
      });

      it("should revert if converter is incorrect", async () => {
        await expect(init({
          comptroller: ethers.Wallet.createRandom().address,
          user: ethers.Wallet.createRandom().address,
          converterForInit: ethers.Wallet.createRandom().address,
          collateralAsset: ethers.Wallet.createRandom().address,
          borrowAsset: ethers.Wallet.createRandom().address,
          converter: ethers.Wallet.createRandom().address,
        })).revertedWith("TC-25 converter not found"); // CONVERTER_NOT_FOUND
      });
    });
  });

  describe("setFrozen", () => {
    let snapshotForEach: string;
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    interface IParams {
      initialFrozen: boolean;
    }

    interface IResults {
      governance: SignerWithAddress;
    }

    async function init(p: IParams): Promise<IResults> {
      const governance = ethers.Wallet.createRandom().address;
      const controller = await DeployUtils.deployContract(deployer, "ConverterControllerMock") as ConverterControllerMock;
      await controller.setGovernance(governance);
      await setState({
        controller: controller.address,
        comptroller: ethers.Wallet.createRandom().address,
        converter: ethers.Wallet.createRandom().address,
        frozen: p.initialFrozen,
        cTokens: [],
        underlying: []
      })
      return {
        governance: await Misc.impersonate(governance)
      }
    }

    it("should set frozen to false", async () => {
      const {governance} = await init({initialFrozen: true});
      await facade.connect(governance).setFrozen(false);
      expect((await facade.getState()).frozen).eq(false);
    });
    it("should set frozen to true", async () => {
      const {governance} = await init({initialFrozen: false});
      await facade.connect(governance).setFrozen(true);
      expect((await facade.getState()).frozen).eq(true);
    });
    it("should revert if not governance", async () => {
      await init({initialFrozen: false});
      const notGov = await Misc.impersonate(ethers.Wallet.createRandom().address);
      await expect(
        facade.connect(notGov).setFrozen(true)
      ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
    });
  });

  describe("registerCTokens", () => {
    let snapshotForEach: string;
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    interface IParams {
      protocolFeatures: {
        nativeToken: MockERC20;
        cTokenNative: CompoundCTokenBaseMock;
      }

      cTokens: CompoundCTokenBaseMock[];
      underlying: MockERC20[];

      notGovernance?: boolean;
    }

    interface IResults {
      cTokens: string[];
    }

    async function registerCTokens(p: IParams): Promise<IResults> {
      const governance = ethers.Wallet.createRandom().address;
      const controller = await DeployUtils.deployContract(deployer, "ConverterControllerMock") as ConverterControllerMock;
      await controller.setGovernance(governance);
      await setState({
        controller: controller.address,
        comptroller: ethers.Wallet.createRandom().address,
        converter: ethers.Wallet.createRandom().address,
        frozen: false,
        cTokens: [],
        underlying: []
      });

      const signer = p.notGovernance
        ? await Misc.impersonate(ethers.Wallet.createRandom().address)
        : await Misc.impersonate(governance);
      await facade.connect(signer).registerCTokens(
        {
          cTokenNative: p.protocolFeatures.cTokenNative.address,
          nativeToken: p.protocolFeatures.nativeToken.address,
          compoundStorageVersion: 0 // not used here
        },
        p.cTokens.map(x => x.address)
      )
      return {
        cTokens: await Promise.all(p.underlying.map(
          async x => facade.getActiveAsset(x.address)
        ))
      }
    }

    it("should set expected cTokens, cTokens doesn't include native token", async () => {
      const {cTokens} = await registerCTokens({
        cTokens: [cUsdc, cDai],
        underlying: [dai, usdc, weth],
        protocolFeatures: {
          nativeToken: weth,
          cTokenNative: cWeth
        }
      });
      expect(cTokens.join()).eq([cDai.address, cUsdc.address, Misc.ZERO_ADDRESS].join());
    });
    it("should set expected cTokens, cTokens includes native token", async () => {
      const {cTokens} = await registerCTokens({
        cTokens: [cUsdc, cDai, cWeth],
        underlying: [dai, usdc, weth],
        protocolFeatures: {
          nativeToken: weth,
          cTokenNative: cWeth
        }
      });
      expect(cTokens.join()).eq([cDai.address, cUsdc.address, cWeth.address].join());
    });
    it("should revert if not governance", async () => {
      await expect(
        registerCTokens({
          cTokens: [cUsdc, cDai, cWeth],
          underlying: [dai, usdt, weth],
          protocolFeatures: {
            nativeToken: weth,
            cTokenNative: cWeth
          },
          notGovernance: true
        })
      ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
    });
  });


  describe("reduceAmountsByMax", () => {
    let snapshotForEach: string;
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    interface IParams {
      collateralAsset?: MockERC20; // usdc by default
      borrowAsset?: MockERC20; // usdt by default

      /** by default type(uint).max */
      maxAmountToBorrow?: string;
      /** by default type(uint).max */
      maxAmountToSupply?: string;

      amountToBorrow: string;
      collateralAmount: string;
    }

    interface IResults {
      amountToBorrow: number;
      collateralAmount: number;
    }

    async function reduceAmountsByMax(p: IParams): Promise<IResults> {
      const decimalsBorrow = await (p.borrowAsset ?? usdt).decimals();
      const decimalsCollateral = await (p.collateralAsset ?? usdc).decimals();

      const ret = await facade.reduceAmountsByMax(
        {
          maxAmountToBorrow: p.maxAmountToBorrow === undefined
            ? Misc.MAX_UINT
            : parseUnits(p.maxAmountToBorrow, decimalsBorrow),
          maxAmountToSupply: p.maxAmountToSupply === undefined
            ? Misc.MAX_UINT
            : parseUnits(p.maxAmountToSupply, decimalsCollateral),

          // following params are not used in this test
          amountToBorrow: 0,
          collateralAmount: 0,
          converter: Misc.ZERO_ADDRESS,
          amountCollateralInBorrowAsset36: 0,
          ltv18: 0,
          borrowCost36: 0,
          rewardsAmountInBorrowAsset36: 0,
          supplyIncomeInBorrowAsset36: 0,
          liquidationThreshold18: 0
        },
        parseUnits(p.collateralAmount, decimalsCollateral),
        parseUnits(p.amountToBorrow, decimalsBorrow),
      );

      return {
        amountToBorrow: +formatUnits(ret.amountToBorrow, decimalsBorrow),
        collateralAmount: +formatUnits(ret.collateralAmount, decimalsCollateral)
      }
    }

    it("should return unmodified amounts if there are no limits", async () => {
      const ret = await reduceAmountsByMax({
        collateralAmount: "100",
        amountToBorrow: "200"
      });
      expect([ret.collateralAmount, ret.amountToBorrow].join()).eq([100, 200].join());
    });
    it("should return unmodified amounts if amounts are equal to limits", async () => {
      const ret = await reduceAmountsByMax({
        collateralAmount: "100",
        amountToBorrow: "200",
        maxAmountToSupply: "100",
        maxAmountToBorrow: "200"
      });
      expect([ret.collateralAmount, ret.amountToBorrow].join()).eq([100, 200].join());
    });
    it("should reduce amounts in expected way if borrow amount is less then the limit", async () => {
      const ret = await reduceAmountsByMax({
        collateralAmount: "100",
        amountToBorrow: "200",
        maxAmountToSupply: "100",
        maxAmountToBorrow: "50"
      });
      expect([ret.collateralAmount, ret.amountToBorrow].join()).eq([25, 50].join());
    });
    it("should reduce amounts in expected way if supply amount is less then the limit", async () => {
      const ret = await reduceAmountsByMax({
        collateralAmount: "100",
        amountToBorrow: "200",
        maxAmountToSupply: "50",
        maxAmountToBorrow: "200"
      });
      expect([ret.collateralAmount, ret.amountToBorrow].join()).eq([50, 100].join());
    });
    it("should return zero if borrow limit is zero", async () => {
      const ret = await reduceAmountsByMax({
        collateralAmount: "100",
        amountToBorrow: "200",
        maxAmountToSupply: "50",
        maxAmountToBorrow: "0"
      });
      expect([ret.collateralAmount, ret.amountToBorrow].join()).eq([0, 0].join());
    });
    it("should return zero if supply limit is zero", async () => {
      const ret = await reduceAmountsByMax({
        collateralAmount: "100",
        amountToBorrow: "200",
        maxAmountToSupply: "0",
        maxAmountToBorrow: "200"
      });
      expect([ret.collateralAmount, ret.amountToBorrow].join()).eq([0, 0].join());
    });
    it("should return zero if input amounts are zero", async () => {
      const ret = await reduceAmountsByMax({
        collateralAmount: "0",
        amountToBorrow: "0",
        maxAmountToSupply: "100",
        maxAmountToBorrow: "200"
      });
      expect([ret.collateralAmount, ret.amountToBorrow].join()).eq([0, 0].join());
    });
  });

  describe("getMaxAmountToBorrow", () => {
    let snapshotForEach: string;
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    interface IParams {
      borrowCToken?: CompoundCTokenBaseMock; // cUsdc by default

      borrowCap: string;
      totalBorrows: string;
      cash: string;
    }

    interface IResults {
      maxAmountToBorrow: number;
    }

    async function getMaxAmountToBorrow(p: IParams): Promise<IResults> {
      const comptroller = await MocksHelper.createCompoundComptrollerMockV2(deployer);

      const borrowCToken = p.borrowCToken ?? cUsdt;
      const borrowAsset = MockERC20__factory.connect(await borrowCToken.underlying(), deployer);
      const decimalsBorrow = await borrowAsset.decimals();

      await borrowCToken.setCash(parseUnits(p.cash, decimalsBorrow));
      await borrowCToken.setTotalBorrows(parseUnits(p.totalBorrows, decimalsBorrow));
      await comptroller.setBorrowCaps(borrowCToken.address, parseUnits(p.borrowCap, decimalsBorrow));

      const maxAmountToBorrow = await facade.getMaxAmountToBorrow({
        comptroller: comptroller.address,
        cTokenBorrow: borrowCToken.address,
        cTokenCollateral: Misc.ZERO_ADDRESS // not used here
      });

      return {
        maxAmountToBorrow: +formatUnits(maxAmountToBorrow, decimalsBorrow)
      }
    }

    it("should return cash if borrow cap is zero (not specified)", async () => {
      const {maxAmountToBorrow} = await getMaxAmountToBorrow({
        borrowCap: "0",
        totalBorrows: "0",
        cash: "1112"
      });
      expect(maxAmountToBorrow).eq(1112);
    });

    it("should return 0 if totalBorrows exceeds borrowCap", async () => {
      const {maxAmountToBorrow} = await getMaxAmountToBorrow({
        borrowCap: "5",
        totalBorrows: "6",
        cash: "2"
      });
      expect(maxAmountToBorrow).eq(0);
    });

    it("should return cash if new totalBorrows won't exceed borrowCap", async () => {
      const {maxAmountToBorrow} = await getMaxAmountToBorrow({
        borrowCap: "9",
        totalBorrows: "6",
        cash: "2"
      });
      expect(maxAmountToBorrow).eq(2);
    });

    it("should return expected amount if new totalBorrows exceeds borrowCap", async () => {
      const {maxAmountToBorrow} = await getMaxAmountToBorrow({
        borrowCap: "7",
        totalBorrows: "6",
        cash: "2"
      });
      expect(maxAmountToBorrow).eq(1);
    });
  });

  describe("initConversionPlanLocal", () => {
    let snapshotForEach: string;
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    interface IParams {
      frozen?: boolean; // false by default
      cTokens?: CompoundCTokenBaseMock[];
      assets?: MockERC20[];

      collateralAsset?: MockERC20; // usdc by default
      borrowAsset?: MockERC20; // usdt by default
    }

    interface IResults {
      result: boolean;
      cTokenCollateral: string;
      cTokenBorrow: string;
      comptrollerExpected: boolean;
    }

    async function initConversionPlanLocal(p: IParams): Promise<IResults> {
      const comptroller = ethers.Wallet.createRandom().address;
      await facade.setState(
        Misc.ZERO_ADDRESS,
        comptroller,
        Misc.ZERO_ADDRESS,
        p.frozen ?? false,
        p.assets
          ? p.assets.map(x => x.address)
          : [],
        p.cTokens
          ? p.cTokens.map(x => x.address)
          : []
      );

      const ret = await facade.initConversionPlanLocal(
        {
          collateralAsset: (p.collateralAsset ?? usdc).address,
          borrowAsset: (p.borrowAsset ?? usdt).address,

          // not used in the test
          amountIn: 0,
          countBlocks: 0,
          entryData: "0x"
        },
        {
          comptroller: Misc.ZERO_ADDRESS,
          cTokenBorrow: Misc.ZERO_ADDRESS,
          cTokenCollateral: Misc.ZERO_ADDRESS
        }
      );

      return {
        result: ret[0],
        comptrollerExpected: ret[1].comptroller === comptroller,
        cTokenBorrow: ret[1].cTokenBorrow,
        cTokenCollateral: ret[1].cTokenCollateral
      };
    }

    it("should return false if frozen", async () => {
      const ret = await initConversionPlanLocal({frozen: true});
      expect(ret.result).eq(false);
    });
    it("should return false if collateral asset is not active", async () => {
      const ret = await initConversionPlanLocal({
        cTokens: [cUsdc, cUsdt],
        assets: [usdc, usdt],

        collateralAsset: weth,
        borrowAsset: usdt
      });
      expect(ret.result).eq(false);
    });
    it("should return false if borrow asset is not active", async () => {
      const ret = await initConversionPlanLocal({
        cTokens: [cUsdc, cUsdt],
        assets: [usdc, usdt],

        collateralAsset: usdc,
        borrowAsset: weth
      });
      expect(ret.result).eq(false);
    });
    it("should return expected values in normal case", async () => {
      const ret = await initConversionPlanLocal({
        cTokens: [cUsdc, cUsdt],
        assets: [usdc, usdt],

        collateralAsset: usdc,
        borrowAsset: usdt,
      });
      expect(
        [ret.result, ret.comptrollerExpected, ret.cTokenCollateral, ret.cTokenBorrow].join()
      ).eq(
        [true, true, cUsdc.address, cUsdt.address].join()
      );
    });
  });

  describe("initPricesAndDecimals", () => {
    let snapshotForEach: string;
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    interface IParams {
      cTokens?: CompoundCTokenBaseMock[]; // collateral, borrow; cUsdc, cUsdt by default
      assets?: MockERC20[]; // collateral, borrow; usdc, usdt by default
      oraclePrices?: string[]; // 1 by default; decimals = 36 - assetDecimals
    }

    interface IResults {
      priceCollateral: number;
      priceBorrow: number;
      rc10powDec: number;
      rb10powDec: number;
    }

    async function initPricesAndDecimals(p: IParams): Promise<IResults> {
      const cTokens = p.cTokens ?? [cUsdc, cUsdt];
      const assets = p.assets ?? [usdc, usdt];

      const comptroller = await MocksHelper.createCompoundComptrollerMockV2(deployer);
      const oracle = await DeployUtils.deployContract(deployer, "CompoundPriceOracleMock") as CompoundPriceOracleMock;
      await comptroller.setOracle(oracle.address);
      for (let i = 0; i < cTokens.length; ++i) {
        await oracle.setUnderlyingPrice(
          cTokens[i].address,
          parseUnits(
            p.oraclePrices
              ? p.oraclePrices[i]
              : "1",
            36 - await assets[i].decimals()
          )
        );
      }

      const ret = await facade.initPricesAndDecimals(
        {
          priceCollateral: 0,
          priceBorrow: 0,
          rb10powDec: 0,
          rc10powDec: 0
        },
        assets[0].address,
        assets[1].address,
        {
          comptroller: comptroller.address,
          cTokenCollateral: cTokens[0].address,
          cTokenBorrow: cTokens[1].address
        }
      );

      return {
        priceBorrow: +formatUnits(ret.priceBorrow, 36),
        priceCollateral: +formatUnits(ret.priceCollateral, 36),
        rc10powDec: +formatUnits(ret.rc10powDec, await assets[0].decimals()),
        rb10powDec: +formatUnits(ret.rb10powDec, await assets[1].decimals()),
      }
    }

    it("should return expected values in normal case", async () => {
      const ret = await initPricesAndDecimals({
        cTokens: [cUsdc, cWeth],
        assets: [usdc, weth],
        oraclePrices: ["1.1", "1.7"]
      });
      expect(
        [ret.priceCollateral, ret.priceBorrow, ret.rc10powDec, ret.rb10powDec].join()
      ).eq(
        [1.1, 1.7, 1, 1].join()
      );
    });
  });

  describe("getAmountsForEntryKind", () => {
    let snapshotForEach: string;
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    interface IParams {
      cTokens?: CompoundCTokenBaseMock[]; // collateral, borrow; cUsdc, cUsdt by default
      prices?: string[]; // 1 by default

      entryData?: string; // 0x by default
      amountIn: string;
      isAmountInBorrowAsset?: boolean; // false by default
      liquidationThreshold: string;
      healthFactor: string;
      priceDecimals36: boolean;
    }

    interface IResults {
      collateralAmount: number;
      amountToBorrow: number;
    }

    async function getAmountsForEntryKind(p: IParams): Promise<IResults> {
      const cTokens = p.cTokens ?? [cUsdc, cUsdt];
      const prices = p.prices ?? ["1", "1"];
      const pricesDecimals = p.priceDecimals36 ? 36 : 18;

      const collateralAsset = await cTokens[0].underlying();
      const borrowAsset = await cTokens[1].underlying();

      const decimalsCollateral = await MockERC20__factory.connect(collateralAsset, deployer).decimals();
      const decimalsBorrow = await MockERC20__factory.connect(borrowAsset, deployer).decimals();

      const ret = await facade.getAmountsForEntryKind(
        {
          entryData: p.entryData ?? "0x",
          collateralAsset,
          borrowAsset,
          countBlocks: 1,
          amountIn: parseUnits(
            p.amountIn,
            p.isAmountInBorrowAsset ? decimalsBorrow : decimalsCollateral
          )
        },
        parseUnits(p.liquidationThreshold, 18),
        parseUnits(p.healthFactor, 2),
        {
          priceCollateral: parseUnits(prices[0], pricesDecimals),
          priceBorrow: parseUnits(prices[1], pricesDecimals),
          rc10powDec: parseUnits("1", decimalsCollateral),
          rb10powDec: parseUnits("1", decimalsBorrow),
        },
        p.priceDecimals36
      )

      return {
        collateralAmount: +formatUnits(ret.collateralAmount, decimalsCollateral),
        amountToBorrow: +formatUnits(ret.amountToBorrow, decimalsBorrow),
      }
    }

    describe("Price decimals 36", () => {
      describe("Entry kind 0", () => {
        it("should return expected values", async () => {
          const ret = await getAmountsForEntryKind({
            priceDecimals36: true,
            healthFactor: "2",
            liquidationThreshold: "0.5",
            amountIn: "1000",
          });
          expect([ret.collateralAmount, ret.amountToBorrow].join()).eq([1000, 250].join());
        });
      });
      describe("Entry kind 1", () => {
        it("should return expected values", async () => {
          const ret = await getAmountsForEntryKind({
            priceDecimals36: true,
            healthFactor: "2",
            liquidationThreshold: "0.5",
            amountIn: "1000",
            entryData: defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [AppConstants.ENTRY_KIND_1, 1, 1])
          });
          expect([ret.collateralAmount, ret.amountToBorrow].join()).eq([800, 200].join());
        });
      });
      describe("Entry kind 2", () => {
        it("should return expected values", async () => {
          const ret = await getAmountsForEntryKind({
            priceDecimals36: true,
            healthFactor: "2",
            liquidationThreshold: "0.5",
            amountIn: "250",
            isAmountInBorrowAsset: true,
            entryData: defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2])
          });
          expect([ret.collateralAmount, ret.amountToBorrow].join()).eq([1000, 250].join());
        });
      });
    });
    describe("Different prices with decimals 18", () => {
      it("should return expected values", async () => {
        const ret = await getAmountsForEntryKind({
          priceDecimals36: false,
          healthFactor: "2",
          liquidationThreshold: "0.5",
          amountIn: "1000",
          prices: ["2", "0.5"]
        });
        expect([ret.collateralAmount, ret.amountToBorrow].join()).eq([1000, 250 * 2 / 0.5].join());
      });
    });
  });

  describe("getValuesForApr", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IGetRawCostAndIncomesParams {
      cTokenToBorrow: CompoundCTokenBaseMock;
      cTokenToSupply: CompoundCTokenBaseMock;
      collateralAmount: string;
      borrowAmount: string;
      countBlocks: number;
      collateralPrice: string;
      borrowPrice: string;

      borrowToken: {
        cash: string;
        borrows: string;
        reserves: string;
      }
      collateralToken: {
        cash: string;
        borrows: string;
        reserves: string;
        reserveFactorMantissa: string;
      }

      InterestRateModelForSupply: {
        cash: string;
        borrows: string;
        reserves: string;
        reserveFactorMantissa: string;
        rate: string;
      }
      InterestRateModelForBorrow: {
        cash: string;
        borrows: string;
        reserves: string;
        reserveFactorMantissa: string;
        rate: string;
      }
    }
    interface IGetRawCostAndIncomesResults {
      borrowCost: number;
      supplyIncomeInBorrowAsset: number;
      amountCollateralInBorrowAsset: number;
    }

    async function getValuesForApr(p: IGetRawCostAndIncomesParams): Promise<IGetRawCostAndIncomesResults> {
      const decimalsCollateral = await IERC20Metadata__factory.connect(await p.cTokenToSupply.underlying(), deployer).decimals();
      const decimalsBorrow = await IERC20Metadata__factory.connect(await p.cTokenToBorrow.underlying(), deployer).decimals();

      const model = await DeployUtils.deployContract(deployer, 'CompoundInterestRateModelMock') as CompoundInterestRateModelMock;
      await model.setExpectedBorrowRate(
        parseUnits(p.InterestRateModelForBorrow.cash, decimalsBorrow),
        parseUnits(p.InterestRateModelForBorrow.borrows, decimalsBorrow),
        parseUnits(p.InterestRateModelForBorrow.reserves, decimalsBorrow),
        parseUnits(p.InterestRateModelForBorrow.rate, 18)
      );
      await model.setExpectedSupplyRate(
        parseUnits(p.InterestRateModelForSupply.cash, decimalsCollateral),
        parseUnits(p.InterestRateModelForSupply.borrows, decimalsCollateral),
        parseUnits(p.InterestRateModelForSupply.reserves, decimalsCollateral),
        parseUnits(p.InterestRateModelForSupply.reserveFactorMantissa, decimalsCollateral),
        parseUnits(p.InterestRateModelForSupply.rate, 18)
      );

      await p.cTokenToBorrow.setCash(parseUnits(p.borrowToken.cash, decimalsBorrow));
      await p.cTokenToBorrow.setTotalBorrows(parseUnits(p.borrowToken.borrows, decimalsBorrow));
      await p.cTokenToBorrow.setTotalReserves(parseUnits(p.borrowToken.reserves, decimalsBorrow));
      await p.cTokenToBorrow.setInterestRateModel(model.address);

      await p.cTokenToSupply.setCash(parseUnits(p.collateralToken.cash, decimalsCollateral));
      await p.cTokenToSupply.setTotalBorrows(parseUnits(p.collateralToken.borrows, decimalsCollateral));
      await p.cTokenToSupply.setTotalReserves(parseUnits(p.collateralToken.reserves, decimalsCollateral));
      await p.cTokenToSupply.setReserveFactorMantissa(parseUnits(p.collateralToken.reserveFactorMantissa, decimalsCollateral));
      await p.cTokenToSupply.setInterestRateModel(model.address);

      const ret = await facade.getValuesForApr(
        parseUnits(p.collateralAmount, decimalsCollateral),
        parseUnits(p.borrowAmount, decimalsBorrow),
        {
          nativeToken: weth.address,
          cTokenNative: cWeth.address,
          compoundStorageVersion: 0 // not used here
        },
        p.cTokenToSupply.address,
        p.cTokenToBorrow.address,
        p.countBlocks,
        {
          priceBorrow: parseUnits(p.borrowPrice, 18),
          priceCollateral: parseUnits(p.collateralPrice, 18),
          rb10powDec: parseUnits("1", decimalsBorrow),
          rc10powDec: parseUnits("1", decimalsCollateral),
        }
      );
      return {
        borrowCost: +formatUnits(ret.borrowCost36, 36),
        supplyIncomeInBorrowAsset: +formatUnits(ret.supplyIncomeInBorrowAsset36, 36),
        amountCollateralInBorrowAsset: +formatUnits(ret.amountCollateralInBorrowAsset36, 36),
      };
    }

    it("should return expected values", async () => {
      const ret = await getValuesForApr({
        cTokenToBorrow: cUsdt,
        cTokenToSupply: cWeth,
        collateralAmount: "31",
        borrowAmount: "17",
        countBlocks: 55,
        borrowPrice: "3",
        collateralPrice: "4",

        collateralToken: {
          cash: "1000",
          borrows: "500",
          reserves: "2000",
          reserveFactorMantissa: "41",
        },

        borrowToken: {
          cash: "1000",
          borrows: "500",
          reserves: "2000",
        },

        InterestRateModelForBorrow: {
          cash: (1000 - 17).toString(),
          borrows: (500 + 17).toString(),
          reserves: "2000",
          reserveFactorMantissa: "41",
          rate: "213"
        },

        InterestRateModelForSupply: {
          cash: (1000 + 31).toString(),
          borrows: "500",
          reserves: "2000",
          reserveFactorMantissa: "41",
          rate: "237"
        },
      });

      expect(
        [ret.borrowCost, ret.supplyIncomeInBorrowAsset, ret.amountCollateralInBorrowAsset].join()
      ).eq(
        [213 * 55 * 17,  237 * 55 * 31 * 4 / 3,  31 * 4 / 3].join()
      );
    });
  });
});