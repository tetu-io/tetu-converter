import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HARDHAT_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID,} from "../../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {MockERC20, CompoundCTokenBaseMock, CompoundPoolAdapterLibFacade, ConverterController, Borrower, IERC20Metadata__factory, TokenAddressProviderMock, CompoundComptrollerMockV2, IERC20__factory, CompoundComptrollerMockV1, CompoundPriceOracleMock, MockERC20__factory, DebtMonitorMock,} from "../../../typechain";
import {TetuConverterApp} from "../../baseUT/app/TetuConverterApp";
import {MocksHelper} from "../../baseUT/app/MocksHelper";
import {BigNumber} from "ethers";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {Misc} from "../../../scripts/utils/Misc";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {AppConstants} from "../../baseUT/types/AppConstants";

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
  let priceOracle: CompoundPriceOracleMock;
  let debtMonitor: DebtMonitorMock;

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

    debtMonitor = await MocksHelper.createDebtMonitorMock(signer);
    priceOracle = await MocksHelper.createCompoundPriceOracle(signer);

    controller = await TetuConverterApp.createController(signer, {
      networkId: POLYGON_NETWORK_ID,
      debtMonitorFabric: {
        deploy: async () => debtMonitor.address,
      },
      borrowManagerFabric: {
        deploy: async () => (await MocksHelper.createBorrowManagerStub(signer, true)).address
      },
      priceOracleFabric: async () => priceOracle.address
    });
    userContract = await MocksHelper.deployBorrower(signer.address, controller, 1);

    randomAddress = ethers.Wallet.createRandom().address;

    await comptrollerV1.setOracle(priceOracle.address);
    await comptrollerV2.setOracle(priceOracle.address);
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
  describe("Auxiliary functions", () => {
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
        await p.cTokenCollateral.setGetAccountSnapshotValues(0, 0, parseUnits("1", 18));

        // send amount to facade
        await p.collateralAsset.mint(facade.address, amountCollateral);
        const userAssetBalanceBefore = await p.collateralAsset.balanceOf(facade.address);

        // infinite approve
        const signerFacade = await Misc.impersonate(facade.address);
        await IERC20__factory.connect(p.collateralAsset.address, signerFacade).approve(
          p.cTokenCollateral.address,
          Misc.HUGE_UINT
        );

        const tokenBalanceBefore = await facade.callStatic._supply(p.cTokenCollateral.address, amountCollateral);
        await facade._supply(p.cTokenCollateral.address, amountCollateral);

        const tokenBalanceAfter = await p.cTokenCollateral.balanceOf(facade.address);

        return {
          tokenBalanceBefore: +formatUnits(tokenBalanceBefore, decimalsCTokenCollateral),
          tokenBalanceAfter: +formatUnits(tokenBalanceAfter, decimalsCTokenCollateral),
          userAssetBalanceBefore: +formatUnits(userAssetBalanceBefore, decimalsCollateral),
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

    describe("_getBaseAmounts", () => {
      interface IParams {
        cTokenCollateral: CompoundCTokenBaseMock;
        cTokenBorrow: CompoundCTokenBaseMock;

        collateralTokenBalance: string;
        exchangeRateCollateralValue: string;
        exchangeRateCollateralDecimals: number;
        borrowBalance: string;

        priceCollateral: string;
        priceBorrow: string;
      }

      interface IResults {
        collateralBase: number;
        borrowBase: number;
      }

      async function getBaseAmounts(p: IParams): Promise<IResults> {
        const collateralAsset = IERC20Metadata__factory.connect(await p.cTokenCollateral.underlying(), signer);
        const borrowAsset = IERC20Metadata__factory.connect(await p.cTokenBorrow.underlying(), signer);

        const decimalsCTokenCollateral = await p.cTokenCollateral.decimals();
        const decimalsBorrowAsset = await borrowAsset.decimals();
        const decimalsCollateralAsset = await collateralAsset.decimals();

        const ret = await facade._getBaseAmounts(
          {
            collateralTokenBalance: parseUnits(p.collateralTokenBalance, decimalsCTokenCollateral),
            exchangeRateCollateral: parseUnits(p.exchangeRateCollateralValue, p.exchangeRateCollateralDecimals),
            borrowBalance: parseUnits(p.borrowBalance, decimalsBorrowAsset),
          },
          {
            priceCollateral: parseUnits(p.priceCollateral, 36 - decimalsCollateralAsset),
            priceBorrow: parseUnits(p.priceBorrow, 36 - decimalsBorrowAsset),
          }
        );

        return {
          collateralBase: +formatUnits(ret.collateralBase, 18),
          borrowBase: +formatUnits(ret.borrowBase, 18)
        }
      }

      describe("Normal case", () => {
        describe("DAI : USDC", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });

          it("should return expected values", async () => {
            const ret = await getBaseAmounts({
              cTokenCollateral: cDai,
              cTokenBorrow: cUsdc,
              priceCollateral: "2",
              priceBorrow: "0.5",
              borrowBalance: "100",
              exchangeRateCollateralValue: "7",
              exchangeRateCollateralDecimals: 18,
              collateralTokenBalance: "5000"
            });

            expect(
              [ret.collateralBase, ret.borrowBase].join()
            ).eq(
              [70_000, 50].join()
            )
          })
        });
        describe("USDC : DAI", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });

          it("should return expected values", async () => {
            const ret = await getBaseAmounts({
              cTokenCollateral: cUsdc,
              cTokenBorrow: cDai,
              priceCollateral: "2",
              priceBorrow: "0.5",
              borrowBalance: "100",
              exchangeRateCollateralValue: "7",
              // cUsdc has decimals 18, usdc has decimals 6
              // exchange rate allows to do following conversion: USDC = cUSDC * ExchangeRate / 1e18
              exchangeRateCollateralDecimals: 6,
              collateralTokenBalance: "5000"
            });

            expect(
              [ret.collateralBase, ret.borrowBase].join()
            ).eq(
              [70_000, 50].join()
            )
          })
        });
      });
    });

    describe("_validateHealthFactor", () => {
      let snapshotLocal: string;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      interface IParams {
        minHealthFactor: string;
        healthFactorAfter: string;
        healthFactorBefore: string;
      }

      async function validateHealthFactor(p: IParams) {
        await controller.setMinHealthFactor2(parseUnits(p.minHealthFactor, 2));

        await facade._validateHealthFactor(
          controller.address,
          parseUnits(p.healthFactorAfter, 18),
          parseUnits(p.healthFactorBefore, 18)
        )
      }

      describe("Good paths", () => {
        describe("healthFactorAfter >= threshold", () => {
          it("shouldn't revert if health factor was increased", async () => {
            await validateHealthFactor({
              minHealthFactor: "1.1",
              healthFactorBefore: "2",
              healthFactorAfter: "3"
            })
          });
          it("shouldn't revert if health factor was decreased", async () => {
            await validateHealthFactor({
              minHealthFactor: "1.1",
              healthFactorBefore: "2",
              healthFactorAfter: "1.1"
            })
          });
        });
        describe("healthFactorAfter < threshold", () => {
          it("should revert if new borrow", async () => {
            await expect(validateHealthFactor({
              minHealthFactor: "1.1",
              healthFactorBefore: "0",
              healthFactorAfter: "1"
            })).rejectedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
          });
          it("shouldn't revert if reduction tiny", async () => {
            await validateHealthFactor({
              minHealthFactor: "1.1",
              healthFactorBefore: "1.1",
              healthFactorAfter: "1.099999999999" // delta < CompoundPoolAdapterLibFacade.MAX_ALLOWED_HEALTH_FACTOR_REDUCTION;
            })
          });
          it("shouldn't revert if health factor is increased", async () => {
            await validateHealthFactor({
              minHealthFactor: "1.1",
              healthFactorBefore: "1.0",
              healthFactorAfter: "1.05"
            })
          });
          it("should revert if reduction is huge", async () => {
            await expect(validateHealthFactor({
              minHealthFactor: "1.1",
              healthFactorBefore: "1.1",
              healthFactorAfter: "1.09" // delta > CompoundPoolAdapterLibFacade.MAX_ALLOWED_HEALTH_FACTOR_REDUCTION;
            })).rejectedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
          });
        });
      });
    });

    describe("_getAccountValues", () => {
      interface IParams {
        cTokenCollateral: CompoundCTokenBaseMock;
        cTokenBorrow: CompoundCTokenBaseMock;

        collateralTokenBalance: string;
        exchangeRateCollateralValue: string;
        exchangeRateCollateralDecimals: number;
        borrowBalance: string;

        priceCollateral: string;
        priceBorrow: string;

        collateralFactor: string;
      }

      interface IResults {
        healthFactor: number;
        collateralBase: number;
        borrowBase: number;
        safeDebtAmountBase: number;
      }

      async function getAccountValues(p: IParams): Promise<IResults> {
        const collateralAsset = IERC20Metadata__factory.connect(await p.cTokenCollateral.underlying(), signer);
        const borrowAsset = IERC20Metadata__factory.connect(await p.cTokenBorrow.underlying(), signer);

        const decimalsCTokenCollateral = await p.cTokenCollateral.decimals();
        const decimalsBorrowAsset = await borrowAsset.decimals();
        const decimalsCollateralAsset = await collateralAsset.decimals();

        await comptrollerV1.setMarkets(p.cTokenCollateral.address, false, parseUnits(p.collateralFactor, 18));
        const ret = await facade._getAccountValues(
          {
            cTokenNative: cWeth.address,
            nativeToken: weth.address,
            compoundStorageVersion: 1,
          },
          comptrollerV1.address,
          p.cTokenCollateral.address,
          {
            collateralTokenBalance: parseUnits(p.collateralTokenBalance, decimalsCTokenCollateral),
            exchangeRateCollateral: parseUnits(p.exchangeRateCollateralValue, p.exchangeRateCollateralDecimals),
            borrowBalance: parseUnits(p.borrowBalance, decimalsBorrowAsset),
          },
          {
            priceCollateral: parseUnits(p.priceCollateral, 36 - decimalsCollateralAsset),
            priceBorrow: parseUnits(p.priceBorrow, 36 - decimalsBorrowAsset),
          }
        );

        return {
          collateralBase: +formatUnits(ret.collateralBase, 18),
          borrowBase: +formatUnits(ret.borrowBase, 18),
          healthFactor: +formatUnits(ret.healthFactor18, 18),
          safeDebtAmountBase: +formatUnits(ret.safeDebtAmountBase, 18)
        }
      }

      describe("Normal case", () => {
        describe("DAI : USDC", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });

          it("should return expected values", async () => {
            const ret = await getAccountValues({
              cTokenCollateral: cDai,
              cTokenBorrow: cUsdc,
              priceCollateral: "2",
              priceBorrow: "0.5",
              borrowBalance: "100",
              exchangeRateCollateralValue: "7",
              exchangeRateCollateralDecimals: 18,
              collateralTokenBalance: "5000",
              collateralFactor: "0.5",
            });

            expect(
              [ret.collateralBase, ret.borrowBase, ret.safeDebtAmountBase, ret.healthFactor].join()
            ).eq(
              [70_000, 50, 35_000, 700].join()
            )
          })
        });
        describe("USDC : DAI", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });

          it("should return expected values", async () => {
            const ret = await getAccountValues({
              cTokenCollateral: cUsdc,
              cTokenBorrow: cDai,
              priceCollateral: "2",
              priceBorrow: "0.5",
              borrowBalance: "100",
              exchangeRateCollateralValue: "7",
              // cUsdc has decimals 18, usdc has decimals 6
              // exchange rate allows to do following conversion: USDC = cUSDC * ExchangeRate / 1e18
              exchangeRateCollateralDecimals: 6,
              collateralTokenBalance: "5000",
              collateralFactor: "0.5",
            });

            expect(
              [ret.collateralBase, ret.borrowBase, ret.safeDebtAmountBase, ret.healthFactor].join()
            ).eq(
              [70_000, 50, 35_000, 700].join()
            )
          })
        });
      });
    });

    describe("_getCollateralTokensToRedeem", () => {
      let snapshotLocal: string;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      interface IParams {
        cTokenCollateral: CompoundCTokenBaseMock;
        cTokenBorrow: CompoundCTokenBaseMock;

        collateralTokenBalance: string;
        borrowBalance: string;

        amountToRepay: string;
        closePosition: boolean;
      }

      interface IResults {
        collateralTokenToRedeem: number;
      }

      async function getCollateralTokensToRedeem(p: IParams): Promise<IResults> {
        const borrowAsset = IERC20Metadata__factory.connect(await p.cTokenBorrow.underlying(), signer);

        const decimalsCTokenCollateral = await p.cTokenCollateral.decimals();
        const decimalsBorrowAsset = await borrowAsset.decimals();

        const collateralTokenToRedeem = await facade._getCollateralTokensToRedeem(
          {
            collateralTokenBalance: parseUnits(p.collateralTokenBalance, decimalsCTokenCollateral),
            exchangeRateCollateral: 0, // not used here
            borrowBalance: parseUnits(p.borrowBalance, decimalsBorrowAsset),
          },
          p.closePosition,
          parseUnits(p.amountToRepay, decimalsBorrowAsset)
        );

        return {
          collateralTokenToRedeem: +formatUnits(collateralTokenToRedeem, decimalsCTokenCollateral),
        }
      }

      describe("Good paths", () => {
        describe("Close position", () => {
          it("should return expected values if amountToRepay == borrowBalance", async () => {
            const ret = await getCollateralTokensToRedeem({
              cTokenCollateral: cDai,
              cTokenBorrow: cUsdc,
              borrowBalance: "100",
              collateralTokenBalance: "5000",
              closePosition: true,
              amountToRepay: "100"
            });

            expect(ret.collateralTokenToRedeem).eq(5000);
          });

          it("should return expected values if amountToRepay > borrowBalance", async () => {
            const ret = await getCollateralTokensToRedeem({
              cTokenCollateral: cDai,
              cTokenBorrow: cUsdc,
              borrowBalance: "100",
              collateralTokenBalance: "5000",
              closePosition: true,
              amountToRepay: "200"
            });

            expect(ret.collateralTokenToRedeem).eq(5000);
          })

        });
        describe("Don't close position", () => {
          it("should return expected values if amountToRepay == borrowBalance", async () => {
            const ret = await getCollateralTokensToRedeem({
              cTokenCollateral: cUsdc,
              cTokenBorrow: cDai,
              borrowBalance: "100",
              collateralTokenBalance: "5000",
              closePosition: false,
              amountToRepay: "100"
            });

            expect(ret.collateralTokenToRedeem).eq(5000);
          });

          it("should return expected values if amountToRepay < borrowBalance", async () => {
            const ret = await getCollateralTokensToRedeem({
              cTokenCollateral: cUsdc,
              cTokenBorrow: cDai,
              borrowBalance: "100",
              collateralTokenBalance: "5000",
              closePosition: false,
              amountToRepay: "50"
            });

            expect(ret.collateralTokenToRedeem).eq(2500);
          });
        });
      });

      describe("Bad paths", () => {
        it("should revert if amountToRepay is too low to close position", async () => {
          await expect(getCollateralTokensToRedeem({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            borrowBalance: "100",
            collateralTokenBalance: "5000",
            closePosition: true,
            amountToRepay: "99.9"
          })).rejectedWith("TC-55 close position not allowed"); // CLOSE_POSITION_PARTIAL
        });

        it("should revert if amount to repay exceeds borrow balance, but position is not closed", async () => {
          await expect(getCollateralTokensToRedeem({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            borrowBalance: "100",
            collateralTokenBalance: "5000",
            closePosition: false,
            amountToRepay: "101"
          })).rejectedWith("TC-15 wrong borrow balance"); // WRONG_BORROWED_BALANCE
        });

        it("should revert if the debt is zero", async () => {
          await expect(getCollateralTokensToRedeem({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            borrowBalance: "0",
            collateralTokenBalance: "5000",
            closePosition: true,
            amountToRepay: "100"
          })).rejectedWith("TC-28 zero balance"); // ZERO_BALANCE
        })
      });
    });

    describe("_validateHealthStatusAfterBorrow", () => {
      // todo
    })

    describe("getCollateralAmountToReturn", () => {
      let snapshotLocal: string;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      interface IParams {
        cTokenCollateral: CompoundCTokenBaseMock;
        cTokenBorrow: CompoundCTokenBaseMock;

        collateralTokenBalance: string;
        borrowBalance: string;

        exchangeRateCollateralValue: string;
        exchangeRateCollateralDecimals: number;

        amountToRepay: string;
        closePosition: boolean;
      }

      interface IResults {
        collateralTokenToRedeem: number;
      }

      async function getCollateralAmountToReturn(p: IParams): Promise<IResults> {
        const collateralAsset = IERC20Metadata__factory.connect(await p.cTokenCollateral.underlying(), signer);
        const borrowAsset = IERC20Metadata__factory.connect(await p.cTokenBorrow.underlying(), signer);

        const decimalsCTokenCollateral = await p.cTokenCollateral.decimals();
        const decimalsBorrowAsset = await borrowAsset.decimals();

        await facade.setState(
          collateralAsset.address,
          borrowAsset.address,
          p.cTokenCollateral.address,
          p.cTokenBorrow.address,
          userContract.address,
          controller.address,
          comptrollerV1.address,
          ethers.Wallet.createRandom().address,
          0
        );

        await p.cTokenCollateral.setGetAccountSnapshotValues(
          parseUnits(p.collateralTokenBalance, decimalsCTokenCollateral),
          0,
          parseUnits(p.exchangeRateCollateralValue, p.exchangeRateCollateralDecimals),
        );
        await p.cTokenBorrow.setGetAccountSnapshotValues(
          0,
          parseUnits(p.borrowBalance, decimalsBorrowAsset),
          9,
        );

        const collateralTokenToRedeem = await facade.getCollateralAmountToReturn(
          parseUnits(p.amountToRepay, decimalsBorrowAsset),
          p.closePosition,
        );

        return {
          collateralTokenToRedeem: +formatUnits(collateralTokenToRedeem, decimalsCTokenCollateral),
        }
      }

      describe("Good paths", () => {
        it("should return all collateral when close position", async () => {
          const ret = await getCollateralAmountToReturn({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            borrowBalance: "100",
            collateralTokenBalance: "5000",
            closePosition: true,
            amountToRepay: "200",
            exchangeRateCollateralDecimals: 18,
            exchangeRateCollateralValue: "7"
          });

          expect(ret.collateralTokenToRedeem).eq(35000); // 7 * 5000 / 1
        });
        it("should return expected amount when position is not closed", async () => {
          const ret = await getCollateralAmountToReturn({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            borrowBalance: "100",
            collateralTokenBalance: "5000",
            closePosition: false,
            amountToRepay: "50",
            exchangeRateCollateralDecimals: 18,
            exchangeRateCollateralValue: "7"
          });

          expect(ret.collateralTokenToRedeem).eq(17500); // 7 * 5000 / 2
        });
      });

    });

    describe("getStatus", () => {
      let snapshotLocal: string;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      interface IParams {
        cTokenCollateral: CompoundCTokenBaseMock;
        cTokenBorrow: CompoundCTokenBaseMock;

        collateralTokenBalance: string;
        borrowBalance: string;

        exchangeRateCollateralValue: string;
        exchangeRateCollateralDecimals: number;

        amountToRepay: string;
        closePosition: boolean;

        priceCollateral: string;
        priceBorrow: string;

        collateralFactor: string;
        collateralTokensBalanceInState?: string;
      }

      interface IResults {
        collateralAmount: number;
        amountToPay: number;
        healthFactor: number;
        opened: boolean;
        collateralAmountLiquidated: number;
        debtGapRequired: boolean;
      }

      async function getStatus(p: IParams): Promise<IResults> {
        const collateralAsset = IERC20Metadata__factory.connect(await p.cTokenCollateral.underlying(), signer);
        const borrowAsset = IERC20Metadata__factory.connect(await p.cTokenBorrow.underlying(), signer);

        const decimalsCTokenCollateral = await p.cTokenCollateral.decimals();
        const decimalsBorrowAsset = await borrowAsset.decimals();
        const decimalsCollateralAsset = await collateralAsset.decimals();

        await facade.setProtocolFeatures({
          cTokenNative: cWeth.address,
          nativeToken: weth.address,
          compoundStorageVersion: 1
        });

        await facade.setState(
          collateralAsset.address,
          borrowAsset.address,
          p.cTokenCollateral.address,
          p.cTokenBorrow.address,
          userContract.address,
          controller.address,
          comptrollerV1.address,
          ethers.Wallet.createRandom().address,
          parseUnits((p?.collateralTokensBalanceInState || "0"), decimalsCTokenCollateral),
        );

        await p.cTokenCollateral.setGetAccountSnapshotValues(
          parseUnits(p.collateralTokenBalance, decimalsCTokenCollateral),
          0,
          parseUnits(p.exchangeRateCollateralValue, p.exchangeRateCollateralDecimals),
        );
        await p.cTokenBorrow.setGetAccountSnapshotValues(
          0,
          parseUnits(p.borrowBalance, decimalsBorrowAsset),
          9,
        );

        await priceOracle.setUnderlyingPrice(p.cTokenBorrow.address, parseUnits(p.priceBorrow, 36 - decimalsBorrowAsset));
        await priceOracle.setUnderlyingPrice(p.cTokenCollateral.address, parseUnits(p.priceCollateral, 36 - decimalsCollateralAsset));

        await comptrollerV1.setMarkets(p.cTokenCollateral.address, false, parseUnits(p.collateralFactor, 18));

        const status = await facade.getStatus();

        return {
          collateralAmount: +formatUnits(status.collateralAmount, decimalsCollateralAsset),
          amountToPay: +formatUnits(status.amountToPay, decimalsBorrowAsset),
          collateralAmountLiquidated: +formatUnits(status.collateralAmountLiquidated, decimalsCollateralAsset),
          opened: status.opened,
          debtGapRequired: status.debtGapRequired,
          healthFactor: +formatUnits(status.healthFactor18, 18)
        }
      }

      describe("Good paths", () => {
        describe("DAI : USDC", () => {
          async function getStatusTest(): Promise<IResults> {
            return getStatus({
              cTokenCollateral: cDai,
              cTokenBorrow: cUsdc,
              borrowBalance: "100",
              collateralTokenBalance: "5000",
              closePosition: true,
              amountToRepay: "200",
              exchangeRateCollateralDecimals: 18,
              exchangeRateCollateralValue: "7",
              priceCollateral: "2",
              priceBorrow: "0.5",
              collateralFactor: "0.5"
            });
          }

          it("should return expected amounts", async () => {
            const ret = await loadFixture(getStatusTest);
            expect(
              [ret.collateralAmount, ret.amountToPay, ret.collateralAmountLiquidated].join()
            ).eq(
              [35_000, 100, 0].join()
            );
          });

          it("should return expected flags", async () => {
            const ret = await loadFixture(getStatusTest);
            expect([ret.opened, ret.debtGapRequired].join()).eq([true, false].join());
          });

          it("should return expected health factor", async () => {
            const ret = await loadFixture(getStatusTest);
            expect(ret.healthFactor).eq(700);
          });
        });
        describe("USDC : DAI, liquidation happened", () => {
          async function getStatusTest(): Promise<IResults> {
            return getStatus({
              cTokenCollateral: cUsdc,
              cTokenBorrow: cDai,
              borrowBalance: "100",
              collateralTokenBalance: "5000",
              collateralTokensBalanceInState: "8000",
              closePosition: true,
              amountToRepay: "200",
              exchangeRateCollateralDecimals: 6,
              exchangeRateCollateralValue: "7",
              priceCollateral: "2",
              priceBorrow: "0.5",
              collateralFactor: "0.5"
            });
          }

          it("should return expected amounts", async () => {
            const ret = await loadFixture(getStatusTest);
            expect(
              [ret.collateralAmount, ret.amountToPay, ret.collateralAmountLiquidated].join()
            ).eq(
              [35_000, 100, (8000 - 5000) * 7].join()
            );
          });

          it("should return expected flags", async () => {
            const ret = await loadFixture(getStatusTest);
            expect([ret.opened, ret.debtGapRequired].join()).eq([true, false].join());
          });

          it("should return expected health factor", async () => {
            const ret = await loadFixture(getStatusTest);
            expect(ret.healthFactor).eq(700);
          });
        });
      });

    });
  });

  describe("Main actions", () => {
    describe("borrow", () => {
      interface IParams {
        cTokenCollateral: CompoundCTokenBaseMock;
        cTokenBorrow: CompoundCTokenBaseMock;

        collateralAmount: string;
        borrowAmount: string;

        compoundStorageVersion?: number; // COMPOUND_STORAGE_V1 by default
        approvedCollateralAmount?: string; // collateralAmount by default
        amountInPool?: string; // initial amount of borrow asset on borrow-token's balance, default = borrowAmount
        stateCollateralTokenBalanceInitial?: string; // 0 by default
        priceCollateral?: string; // "1" by default
        priceBorrow?: string; // "1" by default

        borrowErrorCode?: number; // 0 by default
        collateralFactor?: string; // 0.5 by default

        exchangeRateCollateralValue?: string; // 1 by default
        exchangeRateCollateralDecimals?: number; // 18 by default

        borrowAmountToSendToPoolAdapter?: string; // 0 by default - it means, borrowAmount will be sent
        notTetuConverter?: boolean; // false by default
      }

      interface IResults {
        gasUsed: BigNumber;
        returnedBorrowAmount: number;
        receiverBorrowBalance: number;
        userCollateralBalance: number;
        marketsAreEntered: boolean[]; // collateral, borrow
        isDebtMonitorPositionOpened: boolean;
        stateCollateralTokenBalance: number;
        amountInPool: number;
      }

      async function borrow(p: IParams): Promise<IResults> {
        const receiver = ethers.Wallet.createRandom().address;
        const tetuConverter = await Misc.impersonate(await controller.tetuConverter());
        const facadeAsTetuConverter = p.notTetuConverter
          ? facade.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
          : facade.connect(tetuConverter);

        const collateralAsset = MockERC20__factory.connect(await p.cTokenCollateral.underlying(), signer);
        const borrowAsset = MockERC20__factory.connect(await p.cTokenBorrow.underlying(), signer);

        const decimalsCTokenCollateral = await p.cTokenCollateral.decimals();
        const decimalsBorrowAsset = await borrowAsset.decimals();
        const decimalsCollateralAsset = await collateralAsset.decimals();

        const approvedCollateralAmount = parseUnits(p.approvedCollateralAmount ?? p.collateralAmount, decimalsCollateralAsset);
        const compoundStorageVersion = p?.compoundStorageVersion ?? AppConstants.COMPOUND_STORAGE_V1;
        const stateCollateralTokenBalanceInitial = parseUnits(p?.stateCollateralTokenBalanceInitial || "0", decimalsCTokenCollateral);
        const initialAmountInPool = parseUnits(p?.amountInPool || p.borrowAmount, decimalsBorrowAsset);
        const collateralFactor = parseUnits(p?.collateralFactor || "0.5", 18);
        const exchangeRateCollateral = parseUnits(p?.exchangeRateCollateralValue ?? "1", p?.exchangeRateCollateralDecimals ?? 18);

        const comptroller = compoundStorageVersion === AppConstants.COMPOUND_STORAGE_V1 ? comptrollerV1 : comptrollerV2;

        const signerUser = await Misc.impersonate(userContract.address);

        // prepare initial amounts, set approve
        await borrowAsset.mint(p.cTokenBorrow.address, initialAmountInPool);
        await collateralAsset.mint(tetuConverter.address, approvedCollateralAmount);
        await collateralAsset.connect(tetuConverter).approve(facade.address, approvedCollateralAmount);
        await collateralAsset.connect(await Misc.impersonate(facade.address)).approve(p.cTokenCollateral.address, Misc.MAX_UINT);

        // set up price oracle
        await priceOracle.setUnderlyingPrice(p.cTokenCollateral.address, parseUnits(p?.priceCollateral ?? "1", 36 - decimalsCollateralAsset));
        await priceOracle.setUnderlyingPrice(p.cTokenBorrow.address, parseUnits(p?.priceBorrow ?? "1", 36 - decimalsBorrowAsset));

        // set up comptroller
        if (compoundStorageVersion === AppConstants.COMPOUND_STORAGE_V1) {
          await comptrollerV1.setMarkets(p.cTokenCollateral.address, false, collateralFactor);
        } else {
          await comptrollerV2.setMarkets(p.cTokenCollateral.address, false, collateralFactor, false);
        }

        // set up cTokens
        await p.cTokenCollateral.setGetAccountSnapshotValues(0, 0, exchangeRateCollateral);
        if (p.borrowAmountToSendToPoolAdapter) {
          await p.cTokenBorrow.setBorrowAmountToSendToPoolAdapter(parseUnits(p.borrowAmountToSendToPoolAdapter, decimalsBorrowAsset));
        }
        if (p.borrowErrorCode) {
          await p.cTokenBorrow.setBorrowErrorCode(p.borrowErrorCode);
        }

        // set up facade
        await facade.setProtocolFeatures({
          cTokenNative: cWeth.address,
          nativeToken: weth.address,
          compoundStorageVersion
        });
        await facade.setState(
          collateralAsset.address,
          borrowAsset.address,
          p.cTokenCollateral.address,
          p.cTokenBorrow.address,
          userContract.address,
          controller.address,
          comptroller.address,
          ethers.Wallet.createRandom().address,
          stateCollateralTokenBalanceInitial
        );

        // borrow
        const ret = await facadeAsTetuConverter.callStatic.borrow(
          parseUnits(p.collateralAmount, decimalsCollateralAsset),
          parseUnits(p.borrowAmount, decimalsBorrowAsset),
          receiver
        );

        const tx = await facadeAsTetuConverter.borrow(
          parseUnits(p.collateralAmount, decimalsCollateralAsset),
          parseUnits(p.borrowAmount, decimalsBorrowAsset),
          receiver
        );
        const cr = await tx.wait();
        const gasUsed = cr.gasUsed;

        const marketsAreEntered = [
          await comptroller.isMarketEntered(p.cTokenCollateral.address),
          await comptroller.isMarketEntered(p.cTokenBorrow.address),
        ];

        return {
          gasUsed,
          amountInPool: +formatUnits(await borrowAsset.balanceOf(p.cTokenBorrow.address), decimalsBorrowAsset),
          returnedBorrowAmount: +formatUnits(ret, decimalsBorrowAsset),
          receiverBorrowBalance: +formatUnits(await borrowAsset.balanceOf(receiver), decimalsBorrowAsset),
          userCollateralBalance: +formatUnits(await collateralAsset.balanceOf(userContract.address), decimalsCollateralAsset),
          stateCollateralTokenBalance: +formatUnits((await facade.getState()).collateralTokensBalance, decimalsCTokenCollateral),
          isDebtMonitorPositionOpened: await debtMonitor.connect(signerUser)._isOpenedPosition(facade.address),
          marketsAreEntered
        }
      }

      describe("Simple case DAI : USDC", () => {
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function borrowTest(): Promise<IResults> {
          return borrow({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            borrowAmount: "1",
            collateralAmount: "4"
          });
        }

        it("should set expected user balances", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.userCollateralBalance).eq(0);
        });
        it("should set expected receiver balances", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.receiverBorrowBalance).eq(1);
        });
        it("should enter to both markets", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.marketsAreEntered.join()).eq([true, true].join());
        });
        it("should open position in debt monitor", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.isDebtMonitorPositionOpened).eq(true);
        });
        it("should leave zero amountInPool", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.amountInPool).eq(0);
        });
        it("should set expected collateralTokenBalance", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.stateCollateralTokenBalance).eq(4);
        });
        it("should return expected amount", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.returnedBorrowAmount).eq(1);
        });
      });
      describe("Normal case USDC : DAI", () => {
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function borrowTest(): Promise<IResults> {
          return borrow({
            cTokenCollateral: cUsdc,
            cTokenBorrow: cDai,
            borrowAmount: "1",
            collateralAmount: "4",

            stateCollateralTokenBalanceInitial: "500",
            compoundStorageVersion: AppConstants.COMPOUND_STORAGE_V2,
            exchangeRateCollateralValue: "5",
            // cUsdc has decimals 18, usdc has decimals 6
            // exchange rate allows to do following conversion: USDC = cUSDC * ExchangeRate / 1e18
            exchangeRateCollateralDecimals: 6,
            amountInPool: "7000"
          });
        }

        it("should set expected user balances", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.userCollateralBalance).eq(0);
        });
        it("should set expected receiver balances", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.receiverBorrowBalance).eq(1);
        });
        it("should enter to both markets", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.marketsAreEntered.join()).eq([true, true].join());
        });
        it("should open position in debt monitor", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.isDebtMonitorPositionOpened).eq(true);
        });
        it("should leave zero amountInPool", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.amountInPool).eq(6999);
        });
        it("should set expected collateralTokenBalance", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.stateCollateralTokenBalance).eq(500 + 4/5);
        });
        it("should return expected amount", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.returnedBorrowAmount).eq(1);
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

        it("should revert if not tetu converter", async () => {
          await expect(borrow({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            borrowAmount: "1",
            collateralAmount: "4",
            collateralFactor: "0.5",
            notTetuConverter: true
          })).rejectedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
        })
        it("should revert if borrow fails", async () => {
          await expect(borrow({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            borrowAmount: "1",
            collateralAmount: "4",
            borrowErrorCode: 7
          })).rejectedWith("TC-20 borrow failed7"); // BORROW_FAILED
        })
        describe("wrong received borrowed amount", () => {
          it("should revert if the receive amount is too few", async () => {
            await expect(borrow({
              cTokenCollateral: cDai,
              cTokenBorrow: cUsdc,
              borrowAmount: "1",
              collateralAmount: "4",

              borrowAmountToSendToPoolAdapter: "0.9"
            })).rejectedWith("TC-15 wrong borrow balance"); // WRONG_BORROWED_BALANCE
          })
          it("should send full received amount to receiver if the received amount is more than expected", async () => {
            const ret = await borrow({
              cTokenCollateral: cDai,
              cTokenBorrow: cUsdc,
              borrowAmount: "1",
              collateralAmount: "4",

              borrowAmountToSendToPoolAdapter: "1.1",
              amountInPool: "1.1"
            });
            expect(ret.receiverBorrowBalance).eq(1.1);
          })
        })
        it("should revert it attempt to borrow too much (_validateHealthStatusAfterBorrow is called)", async () => {
          await expect(borrow({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            borrowAmount: "1",
            collateralAmount: "2",
            collateralFactor: "0.5"
          })).rejectedWith("TC-23 incorrect liquidity"); // WRONG_BORROWED_BALANCE
        })
      });
    });
    describe("repay", () => {
      interface IParams {
        cTokenCollateral: CompoundCTokenBaseMock;
        cTokenBorrow: CompoundCTokenBaseMock;

        collateralTokensBalance: string;
        borrowBalance: string;
        exchangeRateCollateralValue?: string; // 1 by default
        exchangeRateCollateralDecimals?: number; // 18 by default

        amountToRepay: string;
        closePosition: boolean;

        compoundStorageVersion?: number; // COMPOUND_STORAGE_V1 by default
        approvedBorrowAmount?: string; // amountToRepay by default
        amountInPool?: string; // initial amount of collateral asset on collateral token's balance, default = collateralAmount
        stateCollateralTokenBalanceInitial?: string; // 0 by default
        priceCollateral?: string; // "1" by default
        priceBorrow?: string; // "1" by default

        repayBorrowErrorCode?: number; // 0 by default
        redeemErrorCode?: number; // 0 by default
        collateralFactor?: string; // 0.5 by default

        collateralAmountToSendToPoolAdapter?: string; // 0 by default - it means, required amount will be sent
        notTetuConverter?: boolean;
      }

      interface IResults {
        gasUsed: BigNumber;
        returnedCollateralAmount: number;
        receiverCollateralBalance: number;
        tetuConverterBorrowBalance: number;
        isDebtMonitorPositionClosed: boolean;
        stateCollateralTokenBalance: number;
        collateralAmountInPool: number;
        borrowAmountInPool: number;
      }

      async function repay(p: IParams): Promise<IResults> {
        const receiver = ethers.Wallet.createRandom().address;
        const tetuConverter = await Misc.impersonate(await controller.tetuConverter());
        const facadeAsTetuConverter = p.notTetuConverter
          ? facade.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
          : facade.connect(tetuConverter);

        const collateralAsset = MockERC20__factory.connect(await p.cTokenCollateral.underlying(), signer);
        const borrowAsset = MockERC20__factory.connect(await p.cTokenBorrow.underlying(), signer);

        const decimalsCTokenCollateral = await p.cTokenCollateral.decimals();
        const decimalsBorrowAsset = await borrowAsset.decimals();
        const decimalsCollateralAsset = await collateralAsset.decimals();

        const approvedBorrowAmount = parseUnits(p.approvedBorrowAmount ?? p.amountToRepay, decimalsBorrowAsset);
        const compoundStorageVersion = p?.compoundStorageVersion ?? AppConstants.COMPOUND_STORAGE_V1;
        const stateCollateralTokenBalanceInitial = parseUnits(p?.stateCollateralTokenBalanceInitial || "0", decimalsCTokenCollateral);
        const exchangeRateCollateral = parseUnits(p?.exchangeRateCollateralValue ?? "1", p?.exchangeRateCollateralDecimals ?? 18);
        const initialAmountInPool = p?.amountInPool
          ? parseUnits(p?.amountInPool, decimalsCollateralAsset)
          : parseUnits(p.collateralTokensBalance, decimalsCTokenCollateral).mul(exchangeRateCollateral).div(Misc.WEI);
        console.log("initialAmountInPool", initialAmountInPool);

        const comptroller = compoundStorageVersion === AppConstants.COMPOUND_STORAGE_V1 ? comptrollerV1 : comptrollerV2;
        const collateralFactor = parseUnits(p?.collateralFactor || "0.5", 18);

        const signerUser = await Misc.impersonate(userContract.address);

        // prepare initial amounts, set approve
        await collateralAsset.mint(p.cTokenCollateral.address, initialAmountInPool);
        await p.cTokenCollateral["mint(address,uint256)"](facade.address, stateCollateralTokenBalanceInitial);
        await borrowAsset.mint(tetuConverter.address, approvedBorrowAmount);
        await borrowAsset.connect(tetuConverter).approve(facade.address, approvedBorrowAmount);
        await borrowAsset.connect(await Misc.impersonate(facade.address)).approve(p.cTokenBorrow.address, Misc.MAX_UINT);

        // set up price oracle
        await priceOracle.setUnderlyingPrice(p.cTokenCollateral.address, parseUnits(p?.priceCollateral ?? "1", 36 - decimalsCollateralAsset));
        await priceOracle.setUnderlyingPrice(p.cTokenBorrow.address, parseUnits(p?.priceBorrow ?? "1", 36 - decimalsBorrowAsset));
        await priceOracle.setAssetPrice(collateralAsset.address, parseUnits(p?.priceCollateral ?? "1", 18));
        await priceOracle.setAssetPrice(borrowAsset.address, parseUnits(p?.priceBorrow ?? "1", 18));

        // set up cTokens
        await p.cTokenCollateral.setGetAccountSnapshotValues(
          parseUnits(p.collateralTokensBalance, decimalsCTokenCollateral),
          0,
          exchangeRateCollateral
        );
        if (p.collateralAmountToSendToPoolAdapter) {
          await p.cTokenCollateral.setCollateralAmountToSendToPoolAdapter(parseUnits(p.collateralAmountToSendToPoolAdapter, decimalsCTokenCollateral));
        }
        if (p.redeemErrorCode) {
          await p.cTokenCollateral.setRedeemErrorCode(p.redeemErrorCode);
        }
        if (p.repayBorrowErrorCode) {
          await p.cTokenBorrow.setRepayBorrowErrorCode(p.repayBorrowErrorCode);
        }
        await p.cTokenBorrow.setGetAccountSnapshotValues(
          0,
          parseUnits(p.borrowBalance, decimalsBorrowAsset),
          0
        );

        // set up facade
        await facade.setProtocolFeatures({
          cTokenNative: cWeth.address,
          nativeToken: weth.address,
          compoundStorageVersion
        });
        await facade.setState(
          collateralAsset.address,
          borrowAsset.address,
          p.cTokenCollateral.address,
          p.cTokenBorrow.address,
          userContract.address,
          controller.address,
          comptroller.address,
          ethers.Wallet.createRandom().address,
          stateCollateralTokenBalanceInitial
        );

        // set up comptroller
        if (compoundStorageVersion === AppConstants.COMPOUND_STORAGE_V1) {
          await comptrollerV1.setMarkets(p.cTokenCollateral.address, false, collateralFactor);
        } else {
          await comptrollerV2.setMarkets(p.cTokenCollateral.address, false, collateralFactor, false);
        }

        // borrow
        const ret = await facadeAsTetuConverter.callStatic.repay(
          parseUnits(p.amountToRepay, decimalsBorrowAsset),
          receiver,
          p.closePosition,
        );

        const tx = await facadeAsTetuConverter.repay(
          parseUnits(p.amountToRepay, decimalsBorrowAsset),
          receiver,
          p.closePosition,
        );
        const cr = await tx.wait();
        const gasUsed = cr.gasUsed;

        return {
          gasUsed,
          borrowAmountInPool: +formatUnits(await borrowAsset.balanceOf(p.cTokenBorrow.address), decimalsBorrowAsset),
          collateralAmountInPool: +formatUnits(await collateralAsset.balanceOf(p.cTokenCollateral.address), decimalsCollateralAsset),
          returnedCollateralAmount: +formatUnits(ret, decimalsCollateralAsset),
          receiverCollateralBalance: +formatUnits(await collateralAsset.balanceOf(receiver), decimalsCollateralAsset),
          tetuConverterBorrowBalance: +formatUnits(await borrowAsset.balanceOf(tetuConverter.address), decimalsBorrowAsset),
          stateCollateralTokenBalance: +formatUnits((await facade.getState()).collateralTokensBalance, decimalsCTokenCollateral),
          isDebtMonitorPositionClosed: await debtMonitor.connect(signerUser)._isClosedPosition(facade.address),
        }
      }

      describe("Full repay DAI : USDC", () => {
        const closePositions = [true, false];

        closePositions.forEach((closePositionValue: boolean) => {
          describe(`closePosition ${closePositionValue}`, () => {
            let snapshotLocal: string;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });

            async function borrowTest(): Promise<IResults> {
              return repay({
                cTokenCollateral: cDai,
                cTokenBorrow: cUsdc,
                collateralTokensBalance: "400",
                borrowBalance: "100",
                amountToRepay: "100",
                closePosition: closePositionValue,
                stateCollateralTokenBalanceInitial: "551"
              });
            }

            it("should set expected user balances", async () => {
              const ret = await loadFixture(borrowTest);
              expect(ret.tetuConverterBorrowBalance).eq(0);
            });
            it("should set expected receiver balances", async () => {
              const ret = await loadFixture(borrowTest);
              expect(ret.receiverCollateralBalance).eq(400);
            });
            it("should close position in debt monitor", async () => {
              const ret = await loadFixture(borrowTest);
              expect(ret.isDebtMonitorPositionClosed).eq(true);
            });
            it("should leave zero amountInPool", async () => {
              const ret = await loadFixture(borrowTest);
              expect(ret.collateralAmountInPool).eq(0);
              expect(ret.borrowAmountInPool).eq(100);
            });
            it("should set expected collateralTokenBalance", async () => {
              const ret = await loadFixture(borrowTest);
              expect(ret.stateCollateralTokenBalance).eq(151);
            });
            it("should return expected amount", async () => {
              const ret = await loadFixture(borrowTest);
              expect(ret.returnedCollateralAmount).eq(400);
            });
          });
        });
      });

      describe("Partial repay USDC : DAI, don't close position", () => {
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function borrowTest(): Promise<IResults> {
          return repay({
            cTokenCollateral: cUsdc,
            cTokenBorrow: cDai,
            collateralTokensBalance: "400",
            exchangeRateCollateralValue: "1",
            // cUsdc has decimals 18, usdc has decimals 6
            // exchange rate allows to do following conversion: USDC = cUSDC * ExchangeRate / 1e18
            exchangeRateCollateralDecimals: 6,
            borrowBalance: "100",
            amountToRepay: "70",
            approvedBorrowAmount: "100",
            closePosition: false,
            stateCollateralTokenBalanceInitial: "551",
            compoundStorageVersion: AppConstants.COMPOUND_STORAGE_V2,
          });
        }

        it("should set expected tetuConverter balances", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.tetuConverterBorrowBalance).eq(30);
        });
        it("should set expected receiver balances", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.receiverCollateralBalance).eq(400 * 70 / 100);
        });
        it("should not close position in debt monitor", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.isDebtMonitorPositionClosed).eq(false);
        });
        it("should leave expected amountInPool", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.collateralAmountInPool).eq(400 * 30 / 100);
          expect(ret.borrowAmountInPool).eq(70);
        });
        it("should set expected collateralTokenBalance", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.stateCollateralTokenBalance).eq(151 + 400 * 30 / 100);
        });
        it("should return expected amount", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.returnedCollateralAmount).eq(400 * 70 / 100);
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

        it("should revert if not tetu converter", async () => {
          await expect(repay({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            collateralTokensBalance: "400",
            borrowBalance: "100",
            amountToRepay: "100",
            closePosition: true,
            notTetuConverter: true
          })).rejectedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
        })
        it("should revert if repayBorrow fails", async () => {
          await expect(repay({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            collateralTokensBalance: "400",
            borrowBalance: "100",
            amountToRepay: "100",
            closePosition: true,
            repayBorrowErrorCode: 7
          })).rejectedWith("TC-27 repay failed7"); // REPAY_FAILED
        })
        it("should revert if redeem fails", async () => {
          await expect(repay({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            collateralTokensBalance: "400",
            borrowBalance: "100",
            amountToRepay: "100",
            closePosition: true,
            stateCollateralTokenBalanceInitial: "551",
            redeemErrorCode: 7
          })).rejectedWith("TC-26 redeem failed7"); // REDEEM_FAILED
        })

        it("should revert it attempt to borrow too much (_validateHealthStatusAfterBorrow is called)", async () => {
          await expect(repay({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            collateralTokensBalance: "200",
            borrowBalance: "100",
            amountToRepay: "1",
            closePosition: false,
            stateCollateralTokenBalanceInitial: "551",
            collateralAmountToSendToPoolAdapter: "199",
          })).rejectedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
        })
      });
    });
    describe("repayToRebalance", () => {
      interface IParams {
        cTokenCollateral: CompoundCTokenBaseMock;
        cTokenBorrow: CompoundCTokenBaseMock;

        collateralTokensBalance: string;
        borrowBalance: string;
        exchangeRateCollateralValue?: string; // 1 by default
        exchangeRateCollateralDecimals?: number; // 18 by default

        amountIn: string;
        isCollateral: boolean;
        isPositionOpened?: boolean; // true by default

        compoundStorageVersion?: number; // COMPOUND_STORAGE_V1 by default
        approvedAmount?: string; // amountIn by default
        amountInPool?: string; // initial amount of collateral asset on collateral token's balance, default = collateralAmount
        stateCollateralTokenBalanceInitial?: string; // 0 by default
        priceCollateral?: string; // "1" by default
        priceBorrow?: string; // "1" by default

        repayBorrowErrorCode?: number; // 0 by default
        mintErrorCode?: number; // 0 by default
        collateralFactor?: string; // 0.5 by default

        collateralAmountToSendToPoolAdapter?: string; // 0 by default - it means, required amount will be sent
        notTetuConverter?: boolean;
      }

      interface IResults {
        gasUsed: BigNumber;
        resultHealthFactor: number;
        tetuConverterBorrowBalance: number;
        stateCollateralTokenBalance: number;
        collateralAmountInPool: number;
        borrowAmountInPool: number;
        tokenBalance: number;
        borrowBalance: number;
      }

      async function repayToRebalance(p: IParams): Promise<IResults> {
        const tetuConverter = await Misc.impersonate(await controller.tetuConverter());
        const facadeAsTetuConverter = p.notTetuConverter
          ? facade.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
          : facade.connect(tetuConverter);

        const collateralAsset = MockERC20__factory.connect(await p.cTokenCollateral.underlying(), signer);
        const borrowAsset = MockERC20__factory.connect(await p.cTokenBorrow.underlying(), signer);

        const decimalsCTokenCollateral = await p.cTokenCollateral.decimals();
        const decimalsBorrowAsset = await borrowAsset.decimals();
        const decimalsCollateralAsset = await collateralAsset.decimals();

        const amountIn = parseUnits(
          p.amountIn,
          p.isCollateral ? decimalsCollateralAsset : decimalsBorrowAsset
        );
        const approvedAmount = parseUnits(
          p.approvedAmount ?? p.amountIn,
          p.isCollateral ? decimalsCollateralAsset : decimalsBorrowAsset
        );
        const compoundStorageVersion = p?.compoundStorageVersion ?? AppConstants.COMPOUND_STORAGE_V1;
        const stateCollateralTokenBalanceInitial = parseUnits(p?.stateCollateralTokenBalanceInitial || "0", decimalsCTokenCollateral);
        const exchangeRateCollateral = parseUnits(p?.exchangeRateCollateralValue ?? "1", p?.exchangeRateCollateralDecimals ?? 18);
        const initialAmountInPool = p?.amountInPool
          ? parseUnits(p?.amountInPool, decimalsCollateralAsset)
          : parseUnits(p.collateralTokensBalance, decimalsCTokenCollateral).mul(exchangeRateCollateral).div(Misc.WEI);
        console.log("initialAmountInPool", initialAmountInPool);

        const comptroller = compoundStorageVersion === AppConstants.COMPOUND_STORAGE_V1 ? comptrollerV1 : comptrollerV2;
        const collateralFactor = parseUnits(p?.collateralFactor || "0.5", 18);

        const signerUser = await Misc.impersonate(userContract.address);

        // prepare initial amounts, set approve
        await collateralAsset.mint(p.cTokenCollateral.address, initialAmountInPool);
        await p.cTokenCollateral["mint(address,uint256)"](facade.address, stateCollateralTokenBalanceInitial);
        if (p.isCollateral) {
          await collateralAsset.mint(tetuConverter.address, approvedAmount);
          await collateralAsset.connect(tetuConverter).approve(facade.address, approvedAmount);
        } else {
          await borrowAsset.mint(tetuConverter.address, approvedAmount);
          await borrowAsset.connect(tetuConverter).approve(facade.address, approvedAmount);
        }
        await borrowAsset.connect(await Misc.impersonate(facade.address)).approve(p.cTokenBorrow.address, Misc.MAX_UINT);
        await collateralAsset.connect(await Misc.impersonate(facade.address)).approve(p.cTokenCollateral.address, Misc.MAX_UINT);

        // set up price oracle
        await priceOracle.setUnderlyingPrice(p.cTokenCollateral.address, parseUnits(p?.priceCollateral ?? "1", 36 - decimalsCollateralAsset));
        await priceOracle.setUnderlyingPrice(p.cTokenBorrow.address, parseUnits(p?.priceBorrow ?? "1", 36 - decimalsBorrowAsset));

        // set up cTokens
        await p.cTokenCollateral.setGetAccountSnapshotValues(
          parseUnits(p.collateralTokensBalance, decimalsCTokenCollateral),
          0,
          exchangeRateCollateral
        );
        if (p.collateralAmountToSendToPoolAdapter) {
          await p.cTokenCollateral.setCollateralAmountToSendToPoolAdapter(parseUnits(p.collateralAmountToSendToPoolAdapter, decimalsCTokenCollateral));
        }
        if (p.mintErrorCode) {
          await p.cTokenCollateral.setMintErrorCode(p.mintErrorCode);
        }
        if (p.repayBorrowErrorCode) {
          await p.cTokenBorrow.setRepayBorrowErrorCode(p.repayBorrowErrorCode);
        }
        await p.cTokenBorrow.setGetAccountSnapshotValues(
          0,
          parseUnits(p.borrowBalance, decimalsBorrowAsset),
          0
        );

        // set up facade
        await facade.setProtocolFeatures({
          cTokenNative: cWeth.address,
          nativeToken: weth.address,
          compoundStorageVersion
        });
        await facade.setState(
          collateralAsset.address,
          borrowAsset.address,
          p.cTokenCollateral.address,
          p.cTokenBorrow.address,
          userContract.address,
          controller.address,
          comptroller.address,
          ethers.Wallet.createRandom().address,
          stateCollateralTokenBalanceInitial
        );

        // set up comptroller
        if (compoundStorageVersion === AppConstants.COMPOUND_STORAGE_V1) {
          await comptrollerV1.setMarkets(p.cTokenCollateral.address, false, collateralFactor);
        } else {
          await comptrollerV2.setMarkets(p.cTokenCollateral.address, false, collateralFactor, false);
        }

        // set up DebtMonitor
        if (p.isPositionOpened ?? true) {
          await debtMonitor.connect(await Misc.impersonate(facade.address)).onOpenPosition();
        }

        // borrow
        const ret = await facadeAsTetuConverter.callStatic.repayToRebalance(amountIn, p.isCollateral);
        const tx = await facadeAsTetuConverter.repayToRebalance(amountIn, p.isCollateral);
        const cr = await tx.wait();
        const gasUsed = cr.gasUsed;

        const cret = await p.cTokenCollateral.getAccountSnapshot(facade.address);
        const bret = await p.cTokenBorrow.getAccountSnapshot(facade.address);

        return {
          gasUsed,
          borrowAmountInPool: +formatUnits(await borrowAsset.balanceOf(p.cTokenBorrow.address), decimalsBorrowAsset),
          collateralAmountInPool: +formatUnits(await collateralAsset.balanceOf(p.cTokenCollateral.address), decimalsCollateralAsset),
          resultHealthFactor: +formatUnits(ret, 18),
          tetuConverterBorrowBalance: +formatUnits(await borrowAsset.balanceOf(tetuConverter.address), decimalsBorrowAsset),
          stateCollateralTokenBalance: +formatUnits((await facade.getState()).collateralTokensBalance, decimalsCTokenCollateral),
          tokenBalance: +formatUnits(cret.tokenBalance, decimalsCTokenCollateral),
          borrowBalance: +formatUnits(bret.borrowBalance, decimalsBorrowAsset),
        }
      }

      describe("repayToRebalance using collateral asset", () => {
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function borrowTest(): Promise<IResults> {
          return repayToRebalance({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            collateralTokensBalance: "400",
            borrowBalance: "100",
            amountIn: "400",
            isCollateral: true,
            collateralFactor: "0.5"
          });
        }

        it("should return expected health factor", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.resultHealthFactor).eq(4);
        });
        it("should have expected collateral tokenBalance", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.tokenBalance).eq(800);
        });
        it("should have expected borrowBalance", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.borrowBalance).eq(100);
        });
        it("should have expected collateralAmountInPool", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.collateralAmountInPool).eq(800);
        });
      });
      describe("repayToRebalance using borrow asset", () => {
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function borrowTest(): Promise<IResults> {
          return repayToRebalance({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            collateralTokensBalance: "400",
            borrowBalance: "100",
            amountIn: "50",
            isCollateral: false,
            collateralFactor: "0.5"
          });
        }

        it("should return expected health factor", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.resultHealthFactor).eq(4);
        });
        it("should have expected collateral tokenBalance", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.tokenBalance).eq(400);
        });
        it("should have expected borrowBalance", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.borrowBalance).eq(50);
        });
        it("should have expected collateralAmountInPool", async () => {
          const ret = await loadFixture(borrowTest);
          expect(ret.collateralAmountInPool).eq(400);
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

        it("should revert if not tetu converter", async () => {
          await expect(repayToRebalance({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            collateralTokensBalance: "400",
            borrowBalance: "100",
            amountIn: "50",
            isCollateral: false,
            collateralFactor: "0.5",
            notTetuConverter: true
          })).rejectedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
        })
        it("should revert if mint fails", async () => {
          await expect(repayToRebalance({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            collateralTokensBalance: "400",
            borrowBalance: "100",
            amountIn: "50",
            isCollateral: true,
            collateralFactor: "0.5",
            mintErrorCode: 7
          })).rejectedWith("TC-17 mint failed:7"); // MINT_FAILED
        })
        it("should revert if repayBorrow fails", async () => {
          await expect(repayToRebalance({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            collateralTokensBalance: "400",
            borrowBalance: "100",
            amountIn: "50",
            isCollateral: false,
            collateralFactor: "0.5",
            repayBorrowErrorCode: 7
          })).rejectedWith("TC-27 repay failed7"); // REPAY_FAILED
        })
        it("should revert if try to repay too much", async () => {
          await expect(repayToRebalance({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            collateralTokensBalance: "400",
            borrowBalance: "100",
            amountIn: "150",
            isCollateral: false,
            collateralFactor: "0.5",
          })).rejectedWith("TC-40 repay to rebalance not allowed"); // REPAY_TO_REBALANCE_NOT_ALLOWED
        })

        it("should revert it the position is not registered", async () => {
          await expect(repayToRebalance({
            cTokenCollateral: cDai,
            cTokenBorrow: cUsdc,
            collateralTokensBalance: "400",
            borrowBalance: "100",
            amountIn: "50",
            isCollateral: false,
            collateralFactor: "0.5",
            isPositionOpened: false
          })).rejectedWith("TC-11 position not registered"); // BORROW_POSITION_IS_NOT_REGISTERED
        })
      });
    });
  });
//endregion Unit tests
});