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
  ICompoundComptrollerBase, CompoundComptrollerMock, TokenAddressProviderMock,
} from "../../../../typechain";
import {TetuConverterApp} from "../../../baseUT/app/TetuConverterApp";
import {MocksHelper} from "../../../baseUT/app/MocksHelper";
import {BigNumber} from "ethers";
import {stat} from "fs";
import {formatUnits} from "ethers/lib/utils";
import {Misc} from "../../../../scripts/utils/Misc";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";

describe("CompoundPoolAdapterLibTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;
  let controller: ConverterController;
  let userContract: Borrower;
  let facade: CompoundPoolAdapterLibFacade;
  let comptroller: CompoundComptrollerMock;
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
    comptroller = await DeployUtils.deployContract(signer, "CompoundComptrollerMock") as CompoundComptrollerMock;
    tokenAddressProviderMock = await DeployUtils.deployContract(signer, "TokenAddressProviderMock") as TokenAddressProviderMock;

    usdc = await DeployUtils.deployContract(signer, 'MockERC20', 'USDC', 'USDC', 6) as MockERC20;
    usdt = await DeployUtils.deployContract(signer, 'MockERC20', 'USDT', 'USDT', 6) as MockERC20;
    dai = await DeployUtils.deployContract(signer, 'MockERC20', 'Dai', 'DAI', 18) as MockERC20;
    weth = await DeployUtils.deployContract(signer, 'MockERC20', 'Wrapped Ether', 'WETH', 18) as MockERC20;

    cUsdc = await DeployUtils.deployContract(signer, 'CompoundCTokenBaseMock') as CompoundCTokenBaseMock;
    await cUsdc.setUnderlying(usdc.address);
    cUsdt = await DeployUtils.deployContract(signer, 'CompoundCTokenBaseMock') as CompoundCTokenBaseMock;
    await cUsdt.setUnderlying(usdt.address);
    cDai = await DeployUtils.deployContract(signer, 'CompoundCTokenBaseMock') as CompoundCTokenBaseMock;
    await cDai.setUnderlying(dai.address);
    cWeth = await DeployUtils.deployContract(signer, 'CompoundCTokenBaseMock') as CompoundCTokenBaseMock;
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
        infiniteBorrowApprove: collateralAllowance.eq(Misc.MAX_UINT),
        infiniteCollateralApprove: borrowAllowance.eq(Misc.MAX_UINT),
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
          await tokenAddressProviderMock.initExplicit(
            usdc.address,
            cUsdc.address,
            usdt.address,
            cUsdt.address
          );
          return initialize({
            controller: controller.address,
            comptroller: comptroller.address,
            cTokenAddressProvider: tokenAddressProviderMock.address,
            user: userContract.address,
            borrowAsset: usdc.address,
            collateralAsset: usdt.address,
            originConverter: randomAddress
          })
        }

        it("should set expected controller and comptroller", async () => {
          const {state} = await loadFixture(initializeTest);
          expect([state.controller, state.comptroller].join()).eq([controller.address, comptroller.address].join());
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
    });
    describe("Bad paths", () => {

    });
  });

//endregion Unit tests
});