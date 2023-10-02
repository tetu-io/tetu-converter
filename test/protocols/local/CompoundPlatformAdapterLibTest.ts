import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HARDHAT_NETWORK_ID, HardhatUtils, } from "../../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {
  MockERC20,
  CompoundPlatformAdapterLibFacade,
  CompoundCTokenBaseMock
} from "../../../typechain";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";

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
      )

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
  });
});