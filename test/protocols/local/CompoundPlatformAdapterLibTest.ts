import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HARDHAT_NETWORK_ID, HardhatUtils, } from "../../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {
  MockERC20,
  CompoundPlatformAdapterLibFacade,
  CompoundCTokenBaseMock,
  PoolAdapterInitializerWithAPMock,
  BorrowManagerMock,
  ConverterControllerMock,
  MockERC20__factory
} from "../../../typechain";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {Misc} from "../../../scripts/utils/Misc";
import {formatUnits, parseUnits} from "ethers/lib/utils";

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

    cUsdc = await DeployUtils.deployContract(deployer, 'CompoundCTokenBaseMock') as CompoundCTokenBaseMock;
    await cUsdc.setUnderlying(usdc.address);
    cUsdt = await DeployUtils.deployContract(deployer, 'CompoundCTokenBaseMock') as CompoundCTokenBaseMock;
    await cUsdt.setUnderlying(usdt.address);
    cDai = await DeployUtils.deployContract(deployer, 'CompoundCTokenBaseMock') as CompoundCTokenBaseMock;
    await cDai.setUnderlying(dai.address);
    cWeth = await DeployUtils.deployContract(deployer, 'CompoundCTokenBaseMock') as CompoundCTokenBaseMock;
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
          async x => await facade.getActiveAsset(x.address)
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
      collateralCToken?: CompoundCTokenBaseMock; // cUsdc by default
      borrowCToken?: CompoundCTokenBaseMock; // cUsdt by default

      borrowCap: string;
      totalBorrows: string;
      cash: string;
    }

    interface IResults {
      maxAmountToBorrow: number;
    }

    // async function getMaxAmountToBorrow(p: IParams): Promise<IResults> {
    //
    // }
  });


  describe("TODO getConversionPlan", () => {
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

      plan: {
        cTokenCollateral: CompoundCTokenBaseMock;
        cTokenBorrow: CompoundCTokenBaseMock;
        entryData: string;
        countBlocks: number;
        amountIn: string;
      }
      healthFactor: string;
      decimalsAmountIn?: number; // decimals of collateral by default
    }

    interface IResults {
      converter: string;
      liquidationThreshold: number;
      amountToBorrow: number;
      collateralAmount: number;
      borrowCost: number;
      supplyIncomeInBorrowAsset: number;
      rewardsAmountInBorrowAsset: number;
      amountCollateralInBorrowAsset: number;
      ltv: number;
      maxAmountToBorrow: number;
      maxAmountToSupply: number;
    }

    async function getConversionPlan(p: IParams): Promise<IResults> {
      const governance = ethers.Wallet.createRandom().address;
      const controller = await DeployUtils.deployContract(deployer, "ConverterControllerMock") as ConverterControllerMock;
      await controller.setGovernance(governance);

      const borrowAsset = MockERC20__factory.connect(await p.plan.cTokenBorrow.underlying(), deployer);
      const collateralAsset = MockERC20__factory.connect(await p.plan.cTokenCollateral.underlying(), deployer);

      await setState({
        controller: controller.address,
        comptroller: ethers.Wallet.createRandom().address,
        converter: ethers.Wallet.createRandom().address,
        frozen: false,
        cTokens: [p.plan.cTokenBorrow, p.plan.cTokenCollateral],
        underlying: [borrowAsset, collateralAsset]
      });

      const ret = await facade.getConversionPlan(
        {
          cTokenNative: p.protocolFeatures.cTokenNative.address,
          nativeToken: p.protocolFeatures.nativeToken.address,
          compoundStorageVersion: 0 // not used here
        },
        {
          borrowAsset: borrowAsset.address,
          collateralAsset: collateralAsset.address,
          entryData: p.plan.entryData,
          countBlocks: p.plan.countBlocks,
          amountIn: parseUnits(p.plan.amountIn, p.decimalsAmountIn ?? await collateralAsset.decimals())
        },
        parseUnits(p.healthFactor, 2)
      )
      return {
        converter: ret.converter,
        liquidationThreshold: +formatUnits(ret.liquidationThreshold18, 18),
        amountToBorrow: +formatUnits(ret.amountToBorrow, await borrowAsset.decimals()),
        collateralAmount: +formatUnits(ret.collateralAmount, await collateralAsset.decimals()),
        borrowCost: +formatUnits(ret.borrowCost36, 36),
        supplyIncomeInBorrowAsset: +formatUnits(ret.supplyIncomeInBorrowAsset36, 36),
        rewardsAmountInBorrowAsset: +formatUnits(ret.rewardsAmountInBorrowAsset36, 36),
        amountCollateralInBorrowAsset: +formatUnits(ret.amountCollateralInBorrowAsset36, 36),
        ltv: +formatUnits(ret.ltv18, 18),
        maxAmountToBorrow: +formatUnits(ret.maxAmountToBorrow, await borrowAsset.decimals()),
        maxAmountToSupply: +formatUnits(ret.maxAmountToSupply, await collateralAsset.decimals()),
      }
    }

  });
});