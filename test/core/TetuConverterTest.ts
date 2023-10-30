import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {IERC20__factory, MockERC20, MockERC20__factory, TetuConverter, Borrower, PoolAdapterMock__factory, LendingPlatformMock__factory, BorrowManager__factory, IPoolAdapter__factory, PoolAdapterMock, ITetuConverter__factory, TetuConverter__factory, TetuLiquidatorMock__factory, SwapManagerMock, ConverterUnknownKind, DebtMonitorMock, ConverterController, PoolAdapterStub__factory, IPoolAdapter, DebtMonitorMock__factory, SwapManagerMock__factory, PriceOracleMock__factory, PoolAdapterMock2__factory, IERC20Metadata__factory, CTokenMock} from "../../typechain";
import {CoreContracts} from "../baseUT/types/CoreContracts";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BalanceUtils, IContractToInvestigate} from "../baseUT/utils/BalanceUtils";
import {BigNumber, ContractTransaction} from "ethers";
import {Misc} from "../../scripts/utils/Misc";
import {IPoolAdapterStatus, IPoolAdapterStatusNum} from "../baseUT/types/BorrowRepayDataTypes";
import {getExpectedApr18} from "../baseUT/protocols/shared/aprUtils";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {controlGasLimitsEx2, HARDHAT_NETWORK_ID, HardhatUtils} from "../../scripts/utils/HardhatUtils";
import {
  GAS_FIND_CONVERSION_STRATEGY_ONLY_BORROW_AVAILABLE,
  GAS_FIND_SWAP_STRATEGY, GAS_LIMIT, GAS_TC_BORROW, GAS_TC_QUOTE_REPAY, GAS_TC_REPAY, GAS_TC_SAFE_LIQUIDATE,
} from "../baseUT/types/GasLimit";
import {getSum} from "../baseUT/utils/CommonUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {BorrowRepayDataTypeUtils} from "../baseUT/utils/BorrowRepayDataTypeUtils";
import {MocksHelper} from "../baseUT/app/MocksHelper";
import {TetuConverterApp} from "../baseUT/app/TetuConverterApp";
import {
  BorrowManagerHelper,
  IBorrowInputParams,
  IPoolInstanceInfo,
  IPrepareContractsSetupParams
} from "../baseUT/app/BorrowManagerHelper";
import {CoreContractsHelper} from "../baseUT/app/CoreContractsHelper";

describe("TetuConverterTest", () => {
//region Constants
  const BLOCKS_PER_DAY = 6456;
//endregion Constants

//region Global vars for all tests
  let snapshotRoot: string;
  let snapshot: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

    this.timeout(1200000);
    snapshotRoot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
  });

  after(async function () {
    await TimeUtils.rollback(snapshotRoot);
  });
//endregion before, after

//region Initialization
  interface IPrepareResults {
    core: CoreContracts;
    poolInstances: IPoolInstanceInfo[];
    cToken: string;
    userContract: Borrower;
    sourceToken: MockERC20;
    targetToken: MockERC20;
    poolAdapters: string[];
  }

  interface ISetupResults extends IPrepareResults {
    borrowInputParams: IBorrowInputParams;
    /* initial balance of borrow asset in each pool */
    availableBorrowLiquidityPerPool: BigNumber;
    /* initial balance of collateral asset on userContract's balance */
    initialCollateralAmount: BigNumber;
  }

  interface IPrepareContractsParams {
    usePoolAdapterStub?: boolean;
    /**
     *  true: use PoolAdapterStub to implement pool adapters
     *  false: use PoolAdapterMock to implement pool adapters.
     */
    usePoolAdapterMock2?: boolean;
    skipWhitelistUser?: boolean;
    tetuAppSetupParams?: IPrepareContractsSetupParams,

    initialCollateralAmount?: string; // 100_000_000_000 by default
    targetDecimals?: number; // 6;
    sourceDecimals?: number; // 17;
    collateralFactor?: number; // 0.5,
  }

  /**
   * Deploy BorrowerMock. Create TetuConverter-app and pre-register all pool adapters (implemented by PoolAdapterMock).
   */
  async function prepareContracts(
    core: CoreContracts,
    tt: IBorrowInputParams,
    p?: IPrepareContractsParams
  ): Promise<IPrepareResults> {
    const periodInBlocks = 117;
    const {sourceToken, targetToken, poolsInfo} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(
      core,
      deployer,
      tt,
      async () => p?.usePoolAdapterStub
        ? (await MocksHelper.createPoolAdapterStub(deployer, parseUnits("0.5"))).address
        : p?.usePoolAdapterMock2
          ? (await MocksHelper.createPoolAdapterMock2(deployer)).address
          : (await MocksHelper.createPoolAdapterMock(deployer)).address,
      p?.tetuAppSetupParams
    );
    const userContract = await MocksHelper.deployBorrower(deployer.address, core.controller, periodInBlocks);
    if (!p?.skipWhitelistUser) {
      await core.controller.setWhitelistValues([userContract.address], true);
    }
    const bmAsTc = BorrowManager__factory.connect(core.bm.address,
      await DeployerUtils.startImpersonate(core.tc.address)
    );

    let cToken: string | undefined;
    const poolAdapters: string[] = [];
    for (const pi of poolsInfo) {
      if (!cToken) {
        cToken = pi.asset2cTokens.get(sourceToken.address) || "";
      }

      if (!p?.tetuAppSetupParams?.skipPreregistrationOfPoolAdapters) {
        // we need to set up a pool adapter
        await bmAsTc.registerPoolAdapter(
          pi.converter,
          userContract.address,
          sourceToken.address,
          targetToken.address
        );
        const poolAdapter: string = await core.bm.getPoolAdapter(
          pi.converter,
          userContract.address,
          sourceToken.address,
          targetToken.address
        );
        // TetuConverter gives infinity approve to the pool adapter (see TetuConverter.convert implementation)
        await IERC20__factory.connect(
          sourceToken.address,
          await DeployerUtils.startImpersonate(core.tc.address)
        ).approve(
          poolAdapter,
          Misc.MAX_UINT
        );
        await IERC20__factory.connect(
          targetToken.address,
          await DeployerUtils.startImpersonate(core.tc.address)
        ).approve(
          poolAdapter,
          Misc.MAX_UINT
        );

        poolAdapters.push(poolAdapter);
        console.log("poolAdapter is configured:", poolAdapter, targetToken.address);
      }
    }

    return {
      core,
      poolInstances: poolsInfo,
      cToken: cToken || "",
      userContract,
      sourceToken,
      targetToken,
      poolAdapters,
    };
  }

  /** prepareContracts with sample assets settings and huge amounts of collateral and borrow assets */
  async function prepareTetuAppWithMultipleLendingPlatforms(
    core: CoreContracts,
    countPlatforms: number,
    p?: IPrepareContractsParams
  ): Promise<ISetupResults> {
    const targetDecimals = p?.targetDecimals ?? 6;
    const sourceDecimals = p?.sourceDecimals ?? 17;
    const availableBorrowLiquidityNumber = 100_000_000_000;
    const tt: IBorrowInputParams = {
      collateralFactor: p?.collateralFactor ?? 0.5,
      priceSourceUSD: 1,
      priceTargetUSD: 1, // let's make prices equal for simplicity of health factor calculations in the tests...
      sourceDecimals,
      targetDecimals,
      availablePools: [...Array(countPlatforms).keys()].map(
        () => ({   // source, target
          borrowRateInTokens: [BigNumber.from(0), BigNumber.from(0)],
          availableLiquidityInTokens: [0, availableBorrowLiquidityNumber]
        })
      )
    };

    const initialCollateralAmount = parseUnits(p?.initialCollateralAmount || "100000000000", sourceDecimals);
    const availableBorrowLiquidityPerPool = parseUnits(availableBorrowLiquidityNumber.toString(), targetDecimals);

    const r = await prepareContracts(core, tt, p);

    // put a lot of collateral asset on user's balance
    await MockERC20__factory.connect(r.sourceToken.address, deployer).mint(
      r.userContract.address,
      initialCollateralAmount
    );

    // put a lot of borrow assets to pool-stubs
    for (const pi of r.poolInstances) {
      await MockERC20__factory.connect(r.targetToken.address, deployer).mint(pi.pool, availableBorrowLiquidityPerPool);
    }

    return {
      core,
      sourceToken: r.sourceToken,
      targetToken: r.targetToken,
      poolInstances: r.poolInstances,
      initialCollateralAmount,
      availableBorrowLiquidityPerPool,
      poolAdapters: r.poolAdapters,
      userContract: r.userContract,
      borrowInputParams: tt,
      cToken: r.cToken
    }
  }

  async function buildCoreContracts(): Promise<CoreContracts> {
    return CoreContracts.build(await TetuConverterApp.createController(deployer, {networkId: HARDHAT_NETWORK_ID,}));
  }

//endregion Initialization

//region Prepare borrows
  interface IBorrowStatus {
    poolAdapter?: IPoolAdapter;
    status?: IPoolAdapterStatus;
    conversionResult: IConversionResults;
  }

  interface IConversionResults {
    borrowedAmountOut: BigNumber;
    gas: BigNumber;
  }

  interface IMakeBorrowInputParams {
    exactBorrowAmounts?: number[];
    receiver?: string;
    badPathParamManualConverter?: string;
    transferAmountMultiplier18?: BigNumber;
    entryData?: string;
    debtGapRequired?: boolean;
  }

  interface ICallBorrowerBorrowInputParams {
    entryData?: string;
    badPathParamManualConverter?: string,
    badPathTransferAmountMultiplier18?: BigNumber
  }

  async function callBorrowerBorrow(
    pp: ISetupResults,
    receiver: string,
    exactBorrowAmount: number | undefined,
    collateralAmount: BigNumber,
    params?: ICallBorrowerBorrowInputParams
  ): Promise<IConversionResults> {
    const amountToBorrow = exactBorrowAmount
      ? parseUnits(exactBorrowAmount.toString(), await pp.targetToken.decimals())
      : 0;
    const borrowAmountReceiver = receiver || pp.userContract.address;
    const uc = pp.userContract;
    const sourceToken = pp.sourceToken.address;
    const targetToken = pp.targetToken.address;

    const borrowedAmountOut: BigNumber = exactBorrowAmount === undefined
      ? (await uc.callStatic.borrowMaxAmount(
        params?.entryData || "0x",
        sourceToken,
        collateralAmount,
        targetToken,
        borrowAmountReceiver
      )).borrowedAmountOut
      : params?.badPathParamManualConverter === undefined
        ? (await uc.callStatic.borrowExactAmount(sourceToken, collateralAmount, targetToken, borrowAmountReceiver, amountToBorrow)).borrowedAmountOut
        : await uc.callStatic.borrowExactAmountBadPaths(sourceToken, collateralAmount, targetToken, borrowAmountReceiver, amountToBorrow,
          params?.badPathParamManualConverter,
          params?.badPathTransferAmountMultiplier18 || Misc.WEI
        );

    // ask TetuConverter to make a borrow, the pool adapter with best borrow rate will be selected
    const tx: ContractTransaction = (exactBorrowAmount === undefined)
      ? await uc.borrowMaxAmount(params?.entryData || "0x", sourceToken, collateralAmount, targetToken, borrowAmountReceiver)
      : (params?.badPathParamManualConverter === undefined)
        ? await uc.borrowExactAmount(sourceToken, collateralAmount, targetToken, borrowAmountReceiver, amountToBorrow)
        : await uc.borrowExactAmountBadPaths(sourceToken, collateralAmount, targetToken, borrowAmountReceiver, amountToBorrow,
          params?.badPathParamManualConverter,
          params?.badPathTransferAmountMultiplier18 || Misc.WEI
        );
    const gas = (await tx.wait()).gasUsed;

    return {borrowedAmountOut, gas};
  }

  /**
   *    Make a borrow in each pool adapter using provided collateral amount.
   */
  async function makeBorrow(
    pp: ISetupResults,
    collateralAmounts: number[],
    bestBorrowRateInBorrowAsset: BigNumber,
    ordinalBorrowRateInBorrowAsset: BigNumber,
    p?: IMakeBorrowInputParams
  ): Promise<IBorrowStatus[]> {
    const dest: IBorrowStatus[] = [];
    const sourceTokenDecimals = await pp.sourceToken.decimals();

    // let's remember all exactBorrowAmounts for each adapter
    const borrowResults: IConversionResults[] = [];
    const poolAdaptersPreregistered = pp.poolInstances.length === pp.poolAdapters.length;

    // enumerate converters and make a borrow using each one
    for (let i = 0; i < pp.poolInstances.length; ++i) {
      const collateralAmount = getBigNumberFrom(collateralAmounts[i], sourceTokenDecimals);
      if (pp.poolInstances.length > 1 && poolAdaptersPreregistered) {
        // The pool adapters are pre-initialized
        // set best borrow rate to the selected pool adapter
        // set ordinal borrow rate to others
        const selectedPoolAdapterAddress = pp.poolAdapters[i];
        for (const poolAdapterAddress of pp.poolAdapters) {
          const poolAdapter = PoolAdapterMock__factory.connect(poolAdapterAddress, deployer);
          const borrowRate = poolAdapterAddress === selectedPoolAdapterAddress
            ? bestBorrowRateInBorrowAsset
            : ordinalBorrowRateInBorrowAsset
          const poolAdapterConfig = await poolAdapter.getConfig();
          const platformAdapterAddress = await pp.core.bm.getPlatformAdapter(poolAdapterConfig.origin);
          const platformAdapter = await LendingPlatformMock__factory.connect(platformAdapterAddress, deployer);

          await platformAdapter.changeBorrowRate(pp.targetToken.address, borrowRate);
          await poolAdapter.changeBorrowRate(borrowRate);

          if (p?.debtGapRequired) {
            await poolAdapter.setDebtGapRequired(p?.debtGapRequired);
          }
        }
      }

      // emulate on-chain call to get borrowedAmountOut
      const borrowResult = await callBorrowerBorrow(
        pp,
        p?.receiver || pp.userContract.address,
        p?.exactBorrowAmounts ? p?.exactBorrowAmounts[i] : undefined,
        collateralAmount,
        {
          badPathParamManualConverter: p?.transferAmountMultiplier18
            ? pp.poolInstances[i].converter
            : p?.badPathParamManualConverter,
          badPathTransferAmountMultiplier18: p?.transferAmountMultiplier18,
          entryData: p?.entryData
        }
      );
      borrowResults.push(borrowResult)
    }

    // get final pool adapter statuses
    for (let i = 0; i < pp.poolInstances.length; ++i) {
      // check the borrow status
      const poolAdapter = poolAdaptersPreregistered
        ? IPoolAdapter__factory.connect(pp.poolAdapters[i], deployer)
        : undefined;
      const status = poolAdaptersPreregistered
        ? await poolAdapter?.getStatus()
        : undefined;

      dest.push({
        status,
        poolAdapter,
        conversionResult: borrowResults[i]
      });
    }

    return dest;
  }

//endregion Prepare borrows

//region Predict conversion results
  interface IFindConversionStrategySingle {
    converter: string;
    collateralAmountOut: BigNumber;
    amountToBorrowOut: BigNumber;
    apr18: BigNumber;
  }

  interface IMakeFindConversionStrategyResults {
    init: ISetupResults;
    results: IFindConversionStrategySingle;
    /* Converter of the lending pool adapter */
    poolAdapterConverter: string;
    gas: BigNumber;
  }


  /**
   * The code from SwapManager.getConverter to calculate expectedApr36 and maxTargetAmount
   */
  async function getExpectedSwapResults(
    r: IMakeFindConversionStrategyResults,
    sourceAmountNum: number,
  ): Promise<IFindConversionStrategySingle> {
    const tetuLiquidator = TetuLiquidatorMock__factory.connect(
      await r.init.core.controller.tetuLiquidator(),
      deployer
    );

    const priceImpact = (await tetuLiquidator.priceImpact()).toNumber();

    const PRICE_IMPACT_NUMERATOR = (await r.init.core.swapManager.PRICE_IMPACT_NUMERATOR()).toNumber();
    const APR_NUMERATOR = (await r.init.core.swapManager.APR_NUMERATOR());

    const maxTargetAmount = getBigNumberFrom(
      sourceAmountNum
      * r.init.borrowInputParams.priceSourceUSD
      / (r.init.borrowInputParams.priceTargetUSD)
      * (PRICE_IMPACT_NUMERATOR - priceImpact) / PRICE_IMPACT_NUMERATOR,
      await r.init.targetToken.decimals()
    );

    const returnAmount = await tetuLiquidator.getPrice(
      r.init.targetToken.address,
      r.init.sourceToken.address,
      r.results.amountToBorrowOut
    );
    const sourceAmount = getBigNumberFrom(sourceAmountNum, await r.init.sourceToken.decimals());
    const loss = sourceAmount.sub(returnAmount);
    const apr18 = loss.mul(APR_NUMERATOR).div(sourceAmount);

    return {
      amountToBorrowOut: maxTargetAmount,
      collateralAmountOut: sourceAmount,
      apr18,
      converter: r.init.core.swapManager.address
    }
  }

  async function getExpectedBorrowingResults(
    r: IMakeFindConversionStrategyResults,
    sourceAmountNum: number,
    period: number
  ): Promise<IFindConversionStrategySingle> {
    const targetHealthFactor = await r.init.core.controller.targetHealthFactor2();

    const maxTargetAmount = getBigNumberFrom(
      r.init.borrowInputParams.collateralFactor
      * sourceAmountNum * r.init.borrowInputParams.priceSourceUSD
      / (r.init.borrowInputParams.priceTargetUSD)
      / targetHealthFactor * 100,
      await r.init.targetToken.decimals()
    );

    const borrowRate = await LendingPlatformMock__factory.connect(
      r.init.poolInstances[0].platformAdapter,
      deployer
    ).borrowRates(r.init.targetToken.address);

    const apr18 = getExpectedApr18(
      borrowRate
        .mul(period)
        .mul(Misc.WEI_DOUBLE)
        .div(getBigNumberFrom(1, await r.init.targetToken.decimals())),
      BigNumber.from(0),
      BigNumber.from(0),
      getBigNumberFrom(
        sourceAmountNum * r.init.borrowInputParams.priceSourceUSD / r.init.borrowInputParams.priceTargetUSD,
        36
      ),
      Misc.WEI // rewards factor value doesn't matter because total amount of rewards is 0
    );


    return {
      converter: r.poolAdapterConverter,
      amountToBorrowOut: maxTargetAmount,
      collateralAmountOut: parseUnits(sourceAmountNum.toString(), await r.init.sourceToken.decimals()),
      apr18
    }
  }

//endregion Predict conversion results

//region Unit tests
  describe("init", () => {
    interface IMakeConstructorTestParams {
      useZeroController?: boolean;
      useSecondInitialization?: boolean;
    }
    async function init(p?: IMakeConstructorTestParams): Promise<ConverterController> {
      const controller = await TetuConverterApp.createController(
        deployer,
        {
          networkId: HARDHAT_NETWORK_ID,
          tetuConverterFabric: {
            deploy: async () => CoreContractsHelper.deployTetuConverter(deployer),
            init: async (c, instance) => {await CoreContractsHelper.initializeTetuConverter(
              deployer,
              p?.useZeroController ? Misc.ZERO_ADDRESS : c,
              instance
            );}
          },
          borrowManagerFabric: TetuConverterApp.getRandomSet(),
          debtMonitorFabric: TetuConverterApp.getRandomSet(),
          keeperFabric: TetuConverterApp.getRandomSet(),
          swapManagerFabric: TetuConverterApp.getRandomSet(),
          tetuLiquidatorAddress: ethers.Wallet.createRandom().address
        }
      );

      if (p?.useSecondInitialization) {
        await TetuConverter__factory.connect(await controller.tetuConverter(), deployer).init(controller.address);
      }
      return controller;
    }

    describe("Good paths", () => {
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function initTest(): Promise<ConverterController> {
        return init();
      }
      it("should return expected values", async () => {
        // we can call any function of TetuConverter to ensure that it was created correctly
        // let's check it using ADDITIONAL_BORROW_DELTA_DENOMINATOR()
        const controller = await loadFixture(initTest);
        const tetuConverter = await TetuConverter__factory.connect(await controller.tetuConverter(), deployer);
        const ret = await tetuConverter.ADDITIONAL_BORROW_DELTA_DENOMINATOR();

        expect(ret.eq(0)).eq(false);
      });
      it("should initialize controller by expected value", async () => {
        const controller = await loadFixture(initTest);
        const controllerInTetuConverter = await ITetuConverter__factory.connect(await controller.tetuConverter(), deployer).controller();
        expect(controllerInTetuConverter).eq(controller.address);
      });
    });
    describe("Bad paths", () => {
      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      it("should revert if controller is zero", async () => {
        await expect(
          init({useZeroController: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on second initialization", async () => {
        await expect(
          init({useSecondInitialization: true})
        ).revertedWith("Initializable: contract is already initialized");
      });
    });
  });

  describe("Use default controller", () => {
    let core: CoreContracts;
    let snapshotLocal: string;

    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      core = await CoreContracts.build(
        await TetuConverterApp.createController(deployer, {networkId: HARDHAT_NETWORK_ID,})
      );
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    describe("findConversionStrategy", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      interface IFindConversionStrategyParams {
        /** Borrow rate (as num, no decimals); undefined if there is no lending pool */
        borrowRateNum?: number;
        /** Swap manager config; undefined if there is no DEX */
        swapConfig?: IPrepareContractsSetupParams;
        entryData?: string;
        setConverterToPauseState?: boolean;
        notWhitelisted?: boolean;
      }

      interface IFindConversionStrategyBadParams {
        zeroSourceAmount?: boolean;
        zeroPeriod?: boolean;
        notWhitelisted?: boolean;
      }

      interface IMakeFindConversionStrategySwapAndBorrowResults {
        results: IFindConversionStrategySingle;
        expectedSwap: IFindConversionStrategySingle;
        expectedBorrowing: IFindConversionStrategySingle;
      }

      async function makeFindConversionStrategy(
        sourceAmountNum: number,
        periodInBlocks: number,
        p?: IFindConversionStrategyParams
      ): Promise<IMakeFindConversionStrategyResults> {
        const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
          p?.borrowRateNum ? 1 : 0,
          {tetuAppSetupParams: p?.swapConfig}
        );
        if (p?.setConverterToPauseState) {
          await core.controller.connect(
            await DeployerUtils.startImpersonate(await core.controller.governance())
          ).setPaused(true)
        }

        await PriceOracleMock__factory.connect(await core.controller.priceOracle(), deployer).changePrices(
          [init.sourceToken.address, init.targetToken.address],
          [parseUnits("1"), parseUnits("1")] // prices are set to 1 for simplicity
        );

        if (p?.borrowRateNum) {
          await PoolAdapterMock__factory.connect(
            init.poolAdapters[0],
            deployer
          ).changeBorrowRate(p?.borrowRateNum);
          await LendingPlatformMock__factory.connect(
            init.poolInstances[0].platformAdapter,
            deployer
          ).changeBorrowRate(init.targetToken.address, p?.borrowRateNum);
        }

        // source amount must be approved to TetuConverter before calling findConversionStrategy
        const sourceAmount = parseUnits(sourceAmountNum.toString(), await init.sourceToken.decimals());
        const user = await Misc.impersonate(init.userContract.address);
        await MockERC20__factory.connect(init.sourceToken.address, user).mint(user.address, sourceAmount);
        await MockERC20__factory.connect(init.sourceToken.address, user).approve(core.tc.address, sourceAmount);

        const tcAsCaller = p?.notWhitelisted
          ? init.core.tc.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
          : init.core.tc.connect(user);

        const results = await tcAsCaller.callStatic.findConversionStrategy(
          p?.entryData || "0x",
          init.sourceToken.address,
          sourceAmount,
          init.targetToken.address,
          periodInBlocks
        );
        const tx = await tcAsCaller.findConversionStrategy(
          p?.entryData || "0x",
          init.sourceToken.address,
          sourceAmount,
          init.targetToken.address,
          periodInBlocks
        );
        const gas = (await tx.wait()).gasUsed;

        const poolAdapterConverter = init.poolAdapters.length
          ? (await PoolAdapterMock__factory.connect(init.poolAdapters[0], deployer).getConfig()).origin
          : Misc.ZERO_ADDRESS;

        return {
          init,
          results: {
            converter: results.converter,
            apr18: results.apr18,
            amountToBorrowOut: results.amountToBorrowOut,
            collateralAmountOut: results.collateralAmountOut
          },
          poolAdapterConverter,
          gas
        }
      }

      async function makeFindConversionStrategyTest(
        useLendingPool: boolean,
        useDexPool: boolean,
        p?: IFindConversionStrategyBadParams
      ): Promise<IMakeFindConversionStrategyResults> {
        return makeFindConversionStrategy(
          p?.zeroSourceAmount ? 0 : 1000,
          p?.zeroPeriod ? 0 : 100,
          {
            borrowRateNum: useLendingPool ? 1000 : undefined,
            swapConfig: useDexPool
              ? {
                priceImpact: 1_000,
                setupTetuLiquidatorToSwapBorrowToCollateral: true,
              }
              : undefined,
            notWhitelisted: p?.notWhitelisted
          }
        );
      }

      describe("Good paths", () => {
        describe("Check output converter value", () => {
          describe("Neither borrowing no swap are available", () => {
            it("should return zero converter", async () => {
              const r = await makeFindConversionStrategyTest(false, false);
              expect(r.results.converter).eq(Misc.ZERO_ADDRESS);
            });
          });
          describe("Only borrowing is available", () => {
            it("should return a converter for borrowing", async () => {
              const r = await makeFindConversionStrategyTest(true, false);
              const ret = [
                r.results.converter === Misc.ZERO_ADDRESS,
                r.results.converter
              ].join();
              const expected = [
                false,
                r.poolAdapterConverter
              ].join();
              expect(ret).eq(expected);
            });
            it("Gas estimation @skip-on-coverage", async () => {
              const r = await makeFindConversionStrategyTest(true, false);
              controlGasLimitsEx2(r.gas, GAS_FIND_CONVERSION_STRATEGY_ONLY_BORROW_AVAILABLE, (u, t) => {
                expect(u).to.be.below(t);
              });
            });
          });
          describe("Only swap is available", () => {
            it("should return a converter to swap", async () => {
              const r = await makeFindConversionStrategyTest(false, true);
              const ret = [
                r.results.converter
              ].join();
              const expected = [
                r.init.core.swapManager.address
              ].join();
              expect(ret).eq(expected);
            });
          });
        });
        describe("Both borrowing and swap are available", () => {
          async function makeFindConversionStrategySwapAndBorrow(
            period: number,
            priceImpact: number,
          ): Promise<IMakeFindConversionStrategySwapAndBorrowResults> {
            const sourceAmountNum = 100_000;
            const borrowRateNum = 1000;
            const r = await makeFindConversionStrategy(
              sourceAmountNum,
              period,
              {
                borrowRateNum,
                swapConfig: {
                  priceImpact,
                  setupTetuLiquidatorToSwapBorrowToCollateral: true
                }
              },
            )
            const expectedSwap = await getExpectedSwapResults(r, sourceAmountNum);
            const expectedBorrowing = await getExpectedBorrowingResults(r, sourceAmountNum, period);
            return {
              results: r.results,
              expectedSwap,
              expectedBorrowing
            }
          }

          describe("APR of borrowing is better", () => {
            it("should return borrowing-converter", async () => {
              const r = await makeFindConversionStrategySwapAndBorrow(
                1,
                10_000,
              );
              console.log(r);
              const ret = [
                r.results.converter,
                r.results.amountToBorrowOut,
                r.results.apr18
              ].map(x => BalanceUtils.toString(x)).join("\r");
              const expected = [
                r.expectedBorrowing.converter,
                r.expectedBorrowing.amountToBorrowOut,
                r.expectedBorrowing.apr18
              ].map(x => BalanceUtils.toString(x)).join("\r");

              expect(ret).eq(expected);
            });
          });
          describe("APR of swap is better", () => {
            it("should return swap-converter", async () => {
              const r = await makeFindConversionStrategySwapAndBorrow(
                10_000,
                0,
              );
              const ret = [
                r.results.converter,
                r.results.amountToBorrowOut,
                r.results.apr18
              ].map(x => BalanceUtils.toString(x)).join("\r");
              const expected = [
                r.expectedSwap.converter,
                r.expectedSwap.amountToBorrowOut,
                r.expectedSwap.apr18
              ].map(x => BalanceUtils.toString(x)).join("\r");

              expect(ret).eq(expected);
            });
          });
        });
        describe("Single borrow-converter", () => {
          it("should return expected values", async () => {
            const period = BLOCKS_PER_DAY * 31;
            const sourceAmount = 100_000;
            const borrowRateNum = 1000;
            const r = await makeFindConversionStrategy(
              sourceAmount,
              period,
              {borrowRateNum},
            )
            const expected = await getExpectedBorrowingResults(r, sourceAmount, period);

            const sret = [
              r.results.converter,
              r.results.amountToBorrowOut,
              r.results.apr18
            ].join("\n");

            const sexpected = [
              expected.converter,
              expected.amountToBorrowOut,
              expected.apr18
            ].join("\n");

            expect(sret).equal(sexpected);
          });
        });
        describe("Use ENTRY_KIND_EXACT_PROPORTION_1", () => {
          it("should split source amount on the parts same by cost", async () => {
            const r = await makeFindConversionStrategy(
              1000,
              1,
              {
                borrowRateNum: 1000,
                entryData: defaultAbiCoder.encode(
                  ["uint256", "uint256", "uint256"],
                  [1, 1, 1] // ENTRY_KIND_EXACT_PROPORTION_1
                )
              }
            );
            const collateralDecimals = await r.init.sourceToken.decimals();
            const sourceAmount = parseUnits("1000", collateralDecimals);
            console.log("sourceAmount", sourceAmount);
            console.log("collateralAmountOut", r.results.collateralAmountOut);

            const sourceAssetUSD = +formatUnits(
              sourceAmount.sub(r.results.collateralAmountOut).mul(r.init.borrowInputParams.priceSourceUSD),
              r.init.borrowInputParams.sourceDecimals
            );
            const targetAssetUSD = +formatUnits(
              r.results.amountToBorrowOut.mul(r.init.borrowInputParams.priceTargetUSD),
              r.init.borrowInputParams.targetDecimals
            );
            console.log("sourceAssetUSD", sourceAssetUSD);
            console.log("targetAssetUSD", targetAssetUSD);

            const ret = [
              r.results.collateralAmountOut.lt(sourceAmount),
              targetAssetUSD === sourceAssetUSD
            ].join();
            const expected = [true, true].join();

            expect(ret).eq(expected);
          });
        });
        describe("Paused", () => {
          it("should return empty results", async () => {
            const r = await makeFindConversionStrategy(
              1000,
              1,
              {setConverterToPauseState: true}
            );
            expect(r.results.converter === Misc.ZERO_ADDRESS).eq(true);
          });
        });
      });
      describe("Bad paths", () => {
        describe("Source amount is 0", () => {
          it("should revert", async () => {
            await expect(
              makeFindConversionStrategyTest(
                false,
                false,
                {
                  zeroSourceAmount: true
                }
              )
            ).revertedWith("TC-43 zero amount"); // ZERO_AMOUNT
          });
        });
        describe("Period is 0", () => {
          it("should revert", async () => {
            await expect(
              makeFindConversionStrategyTest(
                false,
                false,
                {
                  zeroPeriod: true
                }
              )
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
        describe("Not whitelisted", () => {
          it("should revert", async () => {
            await expect(
              makeFindConversionStrategyTest(
                false,
                false,
                {
                  notWhitelisted: true
                }
              )
            ).revertedWith("TC-57 whitelist"); // OUT_OF_WHITE_LIST
          });
        });
      });
      describe("Gas estimation @skip-on-coverage", () => {
        it("should return expected values", async () => {
          const {gas} = await makeFindConversionStrategy(
            100_000,
            BLOCKS_PER_DAY * 31,
            {borrowRateNum: 1000},
          );
          controlGasLimitsEx2(gas, GAS_FIND_CONVERSION_STRATEGY_ONLY_BORROW_AVAILABLE, (u, t) => {
            expect(u).to.be.below(t);
          });
        });
      });
    });

    describe("findBorrowStrategies", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      interface IMakeFindBorrowStrategyParams {
        borrowRateNum?: number;
        entryData?: string;
        setConverterToPauseState?: boolean;
      }

      interface IFindConversionStrategyBadParams {
        zeroSourceAmount?: boolean;
        zeroPeriod?: boolean;
        notWhitelisted?: boolean;
      }

      /**
       * Set up test for findBorrowStrategies
       */
      async function makeFindBorrowStrategy(
        sourceAmountNum: number,
        periodInBlocks: number,
        params?: IMakeFindBorrowStrategyParams
      ): Promise<IMakeFindConversionStrategyResults | undefined> {
        const init = await prepareTetuAppWithMultipleLendingPlatforms(core, params?.borrowRateNum ? 1 : 0);

        if (params?.setConverterToPauseState) {
          await core.controller.connect(
            await DeployerUtils.startImpersonate(await core.controller.governance())
          ).setPaused(true)
        }

        if (params?.borrowRateNum) {
          await PoolAdapterMock__factory.connect(
            init.poolAdapters[0],
            deployer
          ).changeBorrowRate(params?.borrowRateNum);
          await LendingPlatformMock__factory.connect(
            init.poolInstances[0].platformAdapter,
            deployer
          ).changeBorrowRate(init.targetToken.address, params?.borrowRateNum);
        }

        const sourceAmount = parseUnits(sourceAmountNum.toString(), await init.sourceToken.decimals());

        const results = await init.core.tc.findBorrowStrategies(
          params?.entryData || "0x",
          init.sourceToken.address,
          sourceAmount,
          init.targetToken.address,
          periodInBlocks,
        );
        const gas = await init.core.tc.estimateGas.findBorrowStrategies(
          params?.entryData || "0x",
          init.sourceToken.address,
          sourceAmount,
          init.targetToken.address,
          periodInBlocks,
        );

        const poolAdapterConverter = init.poolAdapters.length
          ? (await PoolAdapterMock__factory.connect(init.poolAdapters[0], deployer).getConfig()).origin
          : Misc.ZERO_ADDRESS;

        return results.converters.length
          ? {
            init,
            results: {
              converter: results.converters[0],
              amountToBorrowOut: results.amountToBorrowsOut[0],
              apr18: results.aprs18[0],
              collateralAmountOut: results.collateralAmountsOut[0]
            },
            poolAdapterConverter,
            gas
          }
          : undefined;
      }

      async function makeFindBorrowStrategyTest(
        badPathsParams?: IFindConversionStrategyBadParams
      ): Promise<IMakeFindConversionStrategyResults | undefined> {
        return makeFindBorrowStrategy(
          badPathsParams?.zeroSourceAmount ? 0 : 1000,
          badPathsParams?.zeroPeriod ? 0 : 100,
          {borrowRateNum: 1000}
        );
      }

      describe("Good paths", () => {
        it("should return expected values", async () => {
          const period = BLOCKS_PER_DAY * 31;
          const sourceAmount = 100_000;
          const borrowRateNum = 1000;
          const r = await makeFindBorrowStrategy(
            sourceAmount,
            period,
            {borrowRateNum},
          );
          if (r) {
            const expected = await getExpectedBorrowingResults(r, sourceAmount, period);
            console.log("results", r?.results);

            const sret = [
              r?.results.converter,
              r?.results.amountToBorrowOut,
              r?.results.apr18
            ].join("\n");

            const sexpected = [
              expected.converter,
              expected.amountToBorrowOut,
              expected.apr18
            ].join("\n");

            expect(sret).equal(sexpected);
          } else {
            expect.fail("no results");
          }
        });
        describe("Use ENTRY_KIND_EXACT_PROPORTION_1", () => {
          it("should split source amount on the parts same by cost", async () => {
            const r = await makeFindBorrowStrategy(
              1000,
              1,
              {
                borrowRateNum: 1000,
                entryData: defaultAbiCoder.encode(
                  ["uint256", "uint256", "uint256"],
                  [1, 1, 1] // ENTRY_KIND_EXACT_PROPORTION_1
                )
              }
            );
            if (r) {
              const collateralDecimals = await r.init.sourceToken.decimals();
              const sourceAmount = parseUnits("1000", collateralDecimals);
              console.log("sourceAmount", sourceAmount);
              console.log("collateralAmountOut", r.results.collateralAmountOut);

              const sourceAssetUSD = +formatUnits(
                sourceAmount.sub(r.results.collateralAmountOut).mul(r.init.borrowInputParams.priceSourceUSD),
                r.init.borrowInputParams.sourceDecimals
              );
              const targetAssetUSD = +formatUnits(
                r.results.amountToBorrowOut.mul(r.init.borrowInputParams.priceTargetUSD),
                r.init.borrowInputParams.targetDecimals
              );
              console.log("sourceAssetUSD", sourceAssetUSD);
              console.log("targetAssetUSD", targetAssetUSD);

              const ret = [
                r.results.collateralAmountOut.lt(sourceAmount),
                targetAssetUSD === sourceAssetUSD
              ].join();
              const expected = [true, true].join();

              expect(ret).eq(expected);
            } else {
              expect.fail("no results")
            }
          });
        });
        it("should return empty results if paused", async () => {
          const period = BLOCKS_PER_DAY * 31;
          const sourceAmount = 100_000;
          const r = await makeFindBorrowStrategy(
            sourceAmount,
            period,
            {setConverterToPauseState: true},
          );
          expect(!r).eq(true);
        });
      });
      describe("Bad paths", () => {
        describe("Source amount is 0", () => {
          it("should revert", async () => {
            await expect(
              makeFindBorrowStrategyTest({zeroSourceAmount: true})
            ).revertedWith("TC-43 zero amount"); // ZERO_AMOUNT
          });
        });
        describe("Period is 0", () => {
          it("should revert", async () => {
            await expect(
              makeFindBorrowStrategyTest({zeroPeriod: true})
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
      });
    });

    describe("findSwapStrategy", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      interface IMakeFindSwapStrategyParams {
        setConverterToPauseState?: boolean;
        notWhitelisted?: boolean;
      }

      /**
       * Set up test for findConversionStrategy
       * @param sourceAmountNum
       * @param swapConfig Swap manager config; undefined if there is no DEX
       * @param p
       */
      async function makeFindSwapStrategy(
        sourceAmountNum: number,
        swapConfig: IPrepareContractsSetupParams,
        p?: IMakeFindSwapStrategyParams
      ): Promise<IMakeFindConversionStrategyResults> {
        const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 0, {tetuAppSetupParams: swapConfig});
        await PriceOracleMock__factory.connect(await core.controller.priceOracle(), deployer).changePrices(
          [init.sourceToken.address, init.targetToken.address],
          [parseUnits("1"), parseUnits("1")] // prices are set to 1 for simplicity
        );

        if (p?.setConverterToPauseState) {
          await core.controller.connect(
            await DeployerUtils.startImpersonate(await core.controller.governance())
          ).setPaused(true)
        }

        // source amount must be approved to TetuConverter before calling findConversionStrategy
        const sourceAmount = parseUnits(sourceAmountNum.toString(), await init.sourceToken.decimals());
        const user = await Misc.impersonate(init.userContract.address);
        await MockERC20__factory.connect(init.sourceToken.address, user).mint(user.address, sourceAmount);
        await MockERC20__factory.connect(init.sourceToken.address, user).approve(core.tc.address, sourceAmount);

        const tcAsCaller = p?.notWhitelisted
          ? init.core.tc.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
          : init.core.tc.connect(user);
        const results = await tcAsCaller.callStatic.findSwapStrategy(
          swapConfig.entryData || "0x",
          init.sourceToken.address,
          sourceAmount,
          init.targetToken.address,
        );
        const tx = await tcAsCaller.findSwapStrategy(
          swapConfig.entryData || "0x",
          init.sourceToken.address,
          sourceAmount,
          init.targetToken.address,
        );
        const gas = (await tx.wait()).gasUsed;

        const poolAdapterConverter = init.poolAdapters.length
          ? (await PoolAdapterMock__factory.connect(init.poolAdapters[0], deployer).getConfig()).origin
          : Misc.ZERO_ADDRESS;

        return {
          init,
          results: {
            converter: results.converter,
            apr18: results.apr18,
            amountToBorrowOut: results.targetAmountOut,
            collateralAmountOut: results.sourceAmountOut
          },
          poolAdapterConverter,
          gas
        }
      }

      async function makeFindSwapStrategyTest(
        sourceAmount = 1_000,
        priceImpact = 1_000,
        entryData?: string
      ): Promise<IMakeFindConversionStrategyResults> {
        return makeFindSwapStrategy(
          sourceAmount,
          {
            priceImpact,
            setupTetuLiquidatorToSwapBorrowToCollateral: true,
            entryData
          }
        );
      }

      describe("Good paths", () => {
        it("should return expected values if conversion exists", async () => {
          const sourceAmount = 10_000;
          const priceImpact = 500;
          const r = await makeFindSwapStrategyTest(sourceAmount, priceImpact);
          const ret = [
            r.results.converter,
            r.results.amountToBorrowOut.toString(),
            r.results.apr18.toString()
          ].join();

          // assume here that both prices are equal to 1
          const PRICE_IMPACT_NUMERATOR = 100_000;
          const loss = (sourceAmount * priceImpact / PRICE_IMPACT_NUMERATOR);
          const expectedTargetAmount = parseUnits((sourceAmount - loss).toString(), await r.init.targetToken.decimals());
          const expectedApr18 = parseUnits((2 * loss / sourceAmount).toString(), 18);

          const expected = [
            r.init.core.swapManager.address,
            expectedTargetAmount.toString(),
            expectedApr18.toString()
          ].join();
          expect(ret).eq(expected);
        });
        it("should return expected values if conversion doesn't exist", async () => {
          const sourceAmount = 10_000;
          const priceImpact = 9_000; // (!) too high
          const r = await makeFindSwapStrategyTest(sourceAmount, priceImpact);
          const ret = [
            r.results.converter,
            r.results.amountToBorrowOut.toString(),
            r.results.apr18.toString()
          ].join();

          const expected = [
            Misc.ZERO_ADDRESS,
            "0",
            "0"
          ].join();
          expect(ret).eq(expected);
        });
        describe("Use ENTRY_KIND_EXACT_PROPORTION_1", () => {
          it("should split source amount on the parts same by cost", async () => {
            const r = await makeFindSwapStrategyTest(
              1000,
              0,
              defaultAbiCoder.encode(
                ["uint256", "uint256", "uint256"],
                [1, 1, 1] // ENTRY_KIND_EXACT_PROPORTION_1
              )
            );
            const collateralDecimals = await r.init.sourceToken.decimals();
            const sourceAmount = parseUnits("1000", collateralDecimals);
            console.log("sourceAmount", sourceAmount.toString());
            console.log("collateralAmountOut", r.results.collateralAmountOut.toString());

            const sourceAssetUSD = +formatUnits(
              sourceAmount.sub(r.results.collateralAmountOut).mul(r.init.borrowInputParams.priceSourceUSD),
              r.init.borrowInputParams.sourceDecimals
            );
            const targetAssetUSD = +formatUnits(
              r.results.amountToBorrowOut.mul(r.init.borrowInputParams.priceTargetUSD),
              r.init.borrowInputParams.targetDecimals
            );
            console.log("sourceAssetUSD", sourceAssetUSD);
            console.log("targetAssetUSD", targetAssetUSD);
            console.log("r.init.borrowInputParams.priceSourceUSD", r.init.borrowInputParams.priceSourceUSD);
            console.log("r.init.borrowInputParams.priceTargetUSD", r.init.borrowInputParams.priceTargetUSD);

            const ret = [
              r.results.collateralAmountOut.lt(sourceAmount),
              targetAssetUSD === sourceAssetUSD
            ].join();
            const expected = [true, true].join();

            expect(ret).eq(expected);
          });
        });
        describe("Paused", () => {
          it("should return empty results", async () => {
            const r = await makeFindSwapStrategy(
              1000,
              {
                priceImpact: 1_000,
                setupTetuLiquidatorToSwapBorrowToCollateral: true,
                entryData: "0x",
              },
              {setConverterToPauseState: true}
            );
            expect(r.results.converter === Misc.ZERO_ADDRESS).eq(true);
          });
        });
      });
      describe("Bad paths", () => {
        describe("Source amount is 0", () => {
          it("should revert", async () => {
            await expect(
              makeFindSwapStrategyTest(0)
            ).revertedWith("TC-43 zero amount"); // ZERO_AMOUNT
          });
        });
        describe("Not whitelisted", () => {
          it("should revert", async () => {
            await expect(
              makeFindSwapStrategy(
                1000,
                {
                  priceImpact: 1_000,
                  setupTetuLiquidatorToSwapBorrowToCollateral: true,
                  entryData: "0x",
                },
                {notWhitelisted: true}
              )
            ).revertedWith("TC-57 whitelist"); // OUT_OF_WHITE_LIST
          });
        });

      });
      describe("Gas estimation @skip-on-coverage", () => {
        it("should return expected values", async () => {
          const r = await makeFindSwapStrategyTest();
          controlGasLimitsEx2(r.gas, GAS_FIND_SWAP_STRATEGY, (u, t) => {
            expect(u).to.be.below(t);
          });
        });
      });
    });

    describe("borrow", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

//region Test impl
      interface IMakeConversionUsingBorrowingResults {
        init: ISetupResults;
        receiver: string;
        borrowStatus: IBorrowStatus[];
      }

      interface IMakeConversionUsingBorrowingParams {
        zeroReceiver?: boolean;
        incorrectConverterAddress?: string;
        /* Allow to modify collateral amount that is sent to TetuConverter by the borrower. Default is 1e18 */
        transferAmountMultiplier18?: BigNumber;
        /* Don't register pool adapters during initialization. The pool adapters will be registered inside TetuConverter*/
        skipPreregistrationOfPoolAdapters?: boolean;
        usePoolAdapterStub?: boolean;
        setPoolAdaptersStatus?: IPoolAdapterStatus;
        minHealthFactor2?: number;
        skipWhitelistUser?: boolean;
        initialConverterBalanceBorrowAsset?: string;
        initialConverterBalanceCollateral?: string;
      }

      interface IMakeConversionUsingSwap {
        init: ISetupResults;
        receiver: string;
        swapManagerMock: SwapManagerMock;
        conversionResult: IConversionResults;
      }

      interface ISwapManagerMockParams {
        /* By default, converter is equal to the address of the swap-manager */
        converter?: string;
        maxTargetAmount: number;
        apr18: BigNumber;
        targetAmountAfterSwap: number;
        initialConverterBalanceBorrowAsset?: string;
        initialConverterBalanceCollateral?: string;
      }

      /**
       * Test for TetuConverter.borrow() using borrowing.
       * Both borrow converters are mocks with enabled log.
       */
      async function makeConversionUsingBorrowing(
        collateralAmounts: number[],
        exactBorrowAmounts: number[] | undefined,
        p?: IMakeConversionUsingBorrowingParams
      ): Promise<IMakeConversionUsingBorrowingResults> {
        const receiver = p?.zeroReceiver
          ? Misc.ZERO_ADDRESS
          : ethers.Wallet.createRandom().address;

        if (p?.minHealthFactor2) {
          await core.controller.setMinHealthFactor2(p?.minHealthFactor2);
        }

        const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
          collateralAmounts.length,
          {
            tetuAppSetupParams: {skipPreregistrationOfPoolAdapters: p?.skipPreregistrationOfPoolAdapters},
            usePoolAdapterStub: p?.usePoolAdapterStub,
            skipWhitelistUser: p?.skipWhitelistUser
          },
        );

        if (p?.initialConverterBalanceCollateral) {
          await init.sourceToken.mint(init.core.tc.address, parseUnits(p.initialConverterBalanceCollateral, await init.sourceToken.decimals()));
        }
        if (p?.initialConverterBalanceBorrowAsset) {
          await init.targetToken.mint(init.core.tc.address, parseUnits(p.initialConverterBalanceBorrowAsset, await init.targetToken.decimals()));
        }

        if (p?.setPoolAdaptersStatus && p?.usePoolAdapterStub) {
          for (const poolAdapter of init.poolAdapters) {
            await PoolAdapterStub__factory.connect(poolAdapter, deployer).setManualStatus(
              p?.setPoolAdaptersStatus.collateralAmount,
              p?.setPoolAdaptersStatus.amountToPay,
              p?.setPoolAdaptersStatus.healthFactor18,
              p?.setPoolAdaptersStatus.opened,
              p?.setPoolAdaptersStatus.collateralAmountLiquidated,
              true
            )
          }
        }

        const borrowStatus = await makeBorrow(
          init,
          collateralAmounts,
          BigNumber.from(100),
          BigNumber.from(100_000),
          {
            exactBorrowAmounts,
            receiver,
            badPathParamManualConverter: p?.incorrectConverterAddress,
            transferAmountMultiplier18: p?.transferAmountMultiplier18
          }
        );

        return {
          init,
          receiver,
          borrowStatus,
        }
      }
//endregion Test impl

      describe("Good paths", () => {
        describe("Convert using borrowing", () => {
          it("should return expected borrowedAmountOut", async () => {
            const amountToBorrowNum = 100;
            const r = await makeConversionUsingBorrowing([100_000], [amountToBorrowNum]);
            const retBorrowedAmountOut = r.borrowStatus.reduce(
              (prev, cur) => prev.add(cur.conversionResult.borrowedAmountOut),
              BigNumber.from(0)
            );
            const expectedBorrowedAmount = getBigNumberFrom(amountToBorrowNum, await r.init.targetToken.decimals());

            expect(retBorrowedAmountOut).eq(expectedBorrowedAmount);
          });
          describe("Pool adapter is not registered for the converter", () => {
            it("should register and use new pool adapter", async () => {
              const r = await makeConversionUsingBorrowing(
                [100_000],
                [100],
                {skipPreregistrationOfPoolAdapters: true}
              );

              // r.init.poolAdapters is empty because pre-registration was skipped
              const poolAdapterRegisteredInsideBorrowCall = await r.init.core.bm.getPoolAdapter(
                r.init.poolInstances[0].converter,
                r.init.userContract.address,
                r.init.sourceToken.address,
                r.init.targetToken.address
              );

              const ret = poolAdapterRegisteredInsideBorrowCall !== Misc.ZERO_ADDRESS;
              expect(ret).eq(true);
            });
          });
          describe("Pool adapter is already registered for the converter", () => {
            describe("Pool adapter is health and not dirty", () => {
              it("should use exist pool adapter", async () => {
                const r = await makeConversionUsingBorrowing(
                  [100_000],
                  [100],
                  {
                    usePoolAdapterStub: true,
                    setPoolAdaptersStatus: { // healthy status
                      collateralAmountLiquidated: parseUnits("0"),
                      healthFactor18: parseUnits("10"),
                      collateralAmount: parseUnits("1"),
                      amountToPay: parseUnits("1"),
                      opened: true,
                      debtGapRequired: false
                    }
                  }
                );

                const unhealthyPoolAdapter = r.init.poolAdapters[0];
                const currentPoolAdapter = await r.init.core.bm.getPoolAdapter(
                  r.init.poolInstances[0].converter,
                  r.init.userContract.address,
                  r.init.sourceToken.address,
                  r.init.targetToken.address
                );

                const ret = [
                  currentPoolAdapter === Misc.ZERO_ADDRESS,
                  currentPoolAdapter === unhealthyPoolAdapter,
                  await r.init.core.bm.poolAdaptersRegistered(currentPoolAdapter),
                ].join();
                const expected = [false, true, 1].join();
                expect(ret).eq(expected);
              });
            });
            describe("Pool adapter is unhealthy (rebalancing is missed)", () => {
              it("should register and use new pool adapter", async () => {
                const r = await makeConversionUsingBorrowing(
                  [100_000],
                  [100],
                  {
                    usePoolAdapterStub: true,
                    minHealthFactor2: 120,
                    setPoolAdaptersStatus: { // unhealthy status
                      collateralAmountLiquidated: parseUnits("0"),
                      healthFactor18: parseUnits("119", 16), // (!) unhealthy, less then minHealthFactor
                      collateralAmount: parseUnits("1"),
                      amountToPay: parseUnits("1"),
                      opened: true,
                      debtGapRequired: false
                    }
                  }
                );

                const unhealthyPoolAdapter = r.init.poolAdapters[0];
                const currentPoolAdapter = await r.init.core.bm.getPoolAdapter(
                  r.init.poolInstances[0].converter,
                  r.init.userContract.address,
                  r.init.sourceToken.address,
                  r.init.targetToken.address
                );

                const ret = [
                  currentPoolAdapter === Misc.ZERO_ADDRESS,
                  currentPoolAdapter === unhealthyPoolAdapter,
                  await r.init.core.bm.poolAdaptersRegistered(currentPoolAdapter),
                ].join();
                const expected = [false, true, 1].join();
                expect(ret).eq(expected);
              });
            });
            describe("Pool adapter is dirty (full liquidation has happened)", () => {
              it("should register and use new pool adapter", async () => {
                const r = await makeConversionUsingBorrowing(
                  [100_000],
                  [100],
                  {
                    usePoolAdapterStub: true,
                    minHealthFactor2: 120,
                    setPoolAdaptersStatus: { // dirty status
                      collateralAmountLiquidated: parseUnits("0"), // this value doesn't matter
                      healthFactor18: parseUnits("0.5"), // (!) liquidation has happened
                      collateralAmount: parseUnits("1"),
                      amountToPay: parseUnits("1"),
                      opened: true,
                      debtGapRequired: false
                    }
                  }
                );

                const unhealthyPoolAdapter = r.init.poolAdapters[0];
                const newlyCreatedPoolAdapter = await r.init.core.bm.getPoolAdapter(
                  r.init.poolInstances[0].converter,
                  r.init.userContract.address,
                  r.init.sourceToken.address,
                  r.init.targetToken.address
                );

                const ret = [
                  newlyCreatedPoolAdapter === Misc.ZERO_ADDRESS,
                  newlyCreatedPoolAdapter === unhealthyPoolAdapter,
                  await r.init.core.bm.poolAdaptersRegistered(newlyCreatedPoolAdapter),
                  await r.init.core.bm.poolAdaptersRegistered(unhealthyPoolAdapter),
                ].join();
                const expected = [false, false, 2, 1].join();
                expect(ret).eq(expected);
              });
            });
          });
        });
      });
      describe("Bad paths", () => {
        describe("Broken converter", () => {
          describe("Converter is zero", () => {
            it("should revert", async () => {
              await expect(
                makeConversionUsingBorrowing(
                  [100_000],
                  [1_00],
                  {
                    incorrectConverterAddress: Misc.ZERO_ADDRESS
                  }
                )
              ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
            });
          });
          describe("Incorrect converter to borrow (pool adapter is not found)", () => {
            it("should revert", async () => {
              const manuallyCreatedConverter = await MocksHelper.createPoolAdapterMock(deployer);
              await expect(
                makeConversionUsingBorrowing(
                  [100_000],
                  [1_00],
                  {
                    incorrectConverterAddress: manuallyCreatedConverter.address
                  }
                )
              ).revertedWith("TC-6 platform adapter not found"); // PLATFORM_ADAPTER_NOT_FOUND
            });
          });
          describe("Converter returns incorrect conversion kind", () => {
            it("should revert with UNSUPPORTED_CONVERSION_KIND", async () => {
              const converter: ConverterUnknownKind = await MocksHelper.createConverterUnknownKind(deployer);
              await expect(
                makeConversionUsingBorrowing(
                  [100_000],
                  [1_00],
                  {
                    incorrectConverterAddress: converter.address
                  }
                )
              ).revertedWith("TC-35: Unsupported value"); // UNSUPPORTED_CONVERSION_KIND
            });
          });
        });
        describe("Receiver is null", () => {
          it("should revert", async () => {
            await expect(
              makeConversionUsingBorrowing(
                [100_000],
                [100],
                {
                  zeroReceiver: true
                }
              )
            ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
          });
        });
        describe("amount to borrow is 0", () => {
          it("should revert", async () => {
            await expect(
              makeConversionUsingBorrowing(
                [100_000],
                [0], // (!)
              )
            ).revertedWith("TC-43 zero amount"); // ZERO_AMOUNT
          });
        });
        describe("Collateral amount is 0", () => {
          it("should revert", async () => {
            await expect(
              makeConversionUsingBorrowing(
                [0], // (!)
                [100],
              )
            ).revertedWith("TC-43 zero amount"); // ZERO_AMOUNT
          });
        });

        describe("Too little collateral amount on balance of TetuConverter", () => {
          it("should revert", async () => {
            await expect(
              makeConversionUsingBorrowing(
                [100_000],
                [1_00],
                {
                  transferAmountMultiplier18: Misc.WEI.div(2)
                }
              )
            ).revertedWithPanic(0x11); // Arithmetic operation underflowed or overflowed outside of an unchecked block
          });
        });
        describe("Not white listed", () => {
          it("should revert if user is not whitelisted", async () => {
            const amountToBorrowNum = 100;
            await expect(
              makeConversionUsingBorrowing(
                [100_000],
                [amountToBorrowNum],
                {skipWhitelistUser: true}
              )
            ).revertedWith("TC-57 whitelist"); // AppErrors.OUT_OF_WHITE_LIST
          });
        });
        describe("Not zero amount was put on balance of TetuConverter", () => {
          it("should make borrow and keep the amount untouched", async () => {
            const r = await makeConversionUsingBorrowing(
              [100_000],
              [100],
              {
                skipPreregistrationOfPoolAdapters: true,
                initialConverterBalanceBorrowAsset: "200000",
                initialConverterBalanceCollateral: "500000",
              }
            );

            // r.init.poolAdapters is empty because pre-registration was skipped
            const pa = await r.init.core.bm.getPoolAdapter(
              r.init.poolInstances[0].converter,
              r.init.userContract.address,
              r.init.sourceToken.address,
              r.init.targetToken.address
            );

            const status = await IPoolAdapter__factory.connect(pa, deployer).getStatus();
            expect(+formatUnits(status.collateralAmount, await r.init.sourceToken.decimals())).eq(100_000);
            expect(+formatUnits(await r.init.targetToken.balanceOf(r.init.core.tc.address), await r.init.targetToken.decimals())).eq(200_000);
            expect(+formatUnits(await r.init.sourceToken.balanceOf(r.init.core.tc.address), await r.init.sourceToken.decimals())).eq(500_000);
          });
        })
      });
      describe("Gas estimation @skip-on-coverage", () => {
        it("should not exceed gas threshold", async () => {
          const receiver = ethers.Wallet.createRandom().address;

          const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1, {
            tetuAppSetupParams: {skipPreregistrationOfPoolAdapters: true}
          });

          const sourceAmount = parseUnits("1000", await init.sourceToken.decimals());

          const tcAsUser = ITetuConverter__factory.connect(
            core.tc.address,
            await DeployerUtils.startImpersonate(init.userContract.address)
          );
          await IERC20__factory.connect(
            init.sourceToken.address,
            await DeployerUtils.startImpersonate(init.userContract.address)
          ).approve(core.tc.address, sourceAmount);

          const plan = await tcAsUser.callStatic.findConversionStrategy(
            "0x", // entry data
            init.sourceToken.address,
            sourceAmount,
            init.targetToken.address,
            1000
          );

          const gasUsed = await tcAsUser.estimateGas.borrow(
            plan.converter,
            init.sourceToken.address,
            plan.collateralAmountOut,
            init.targetToken.address,
            plan.amountToBorrowOut,
            receiver,
            {gasLimit: GAS_LIMIT}
          );

          controlGasLimitsEx2(gasUsed, GAS_TC_BORROW, (u, t) => {
            expect(u).to.be.below(t);
          });
        });
      });
    });

    /**
     * Check balances of all participants before and after borrow/repay
     * All borrow/repay operations are made using Borrower-functions
     */
    describe("Check balances", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      describe("Good paths", () => {
        interface IMakeConversionUsingBorrowingResults {
          init: ISetupResults;
          contractsToInvestigate: IContractToInvestigate[];
          tokensToInvestigate: string[];
          receiver: string;
          balancesBeforeBorrow: (BigNumber | string)[];
          balancesAfterBorrow: (BigNumber | string)[];
        }

        async function makeConversionUsingBorrowing(
          collateralAmounts: number[],
          exactBorrowAmounts: number[] | undefined,
          setupTetuLiquidatorToSwapBorrowToCollateral = false,
        ): Promise<IMakeConversionUsingBorrowingResults> {
          const receiver = ethers.Wallet.createRandom().address;

          const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
            collateralAmounts.length,
            {tetuAppSetupParams: {setupTetuLiquidatorToSwapBorrowToCollateral}}
          );

          const contractsToInvestigate: IContractToInvestigate[] = [
            {name: "userContract", contract: init.userContract.address},
            {name: "receiver", contract: receiver},
            {name: "pool", contract: init.poolInstances[0].pool},
            {name: "tc", contract: init.core.tc.address},
            {name: "poolAdapter", contract: init.poolAdapters[0]},
          ];
          const tokensToInvestigate: string[] = [init.sourceToken.address, init.targetToken.address, init.cToken];

          // get balances before start
          const balancesBeforeBorrow = await BalanceUtils.getBalances(deployer, contractsToInvestigate, tokensToInvestigate);
          console.log("before", before);

          await makeBorrow(
            init,
            collateralAmounts,
            BigNumber.from(100),
            BigNumber.from(100_000),
            {
              exactBorrowAmounts,
              receiver
            },
          );

          // get result balances
          const balancesAfterBorrow = await BalanceUtils.getBalances(deployer, contractsToInvestigate, tokensToInvestigate);
          console.log("after", after);

          return {
            init,
            receiver,
            contractsToInvestigate,
            tokensToInvestigate,
            balancesAfterBorrow,
            balancesBeforeBorrow
          }
        }

        describe("Borrow", () => {
          describe("Check balances", () => {
            describe("Borrow max amount", () => {
              it("should update balances in proper way", async () => {
                const amountToUseAsCollateralNum = 100_000;
                const r = await makeConversionUsingBorrowing(
                  [amountToUseAsCollateralNum],
                  undefined, // let's borrow max available amount
                  false
                );

                const ret = [
                  ...r.balancesBeforeBorrow,
                  "after",
                  ...r.balancesAfterBorrow
                ].map(x => BalanceUtils.toString(x)).join("\r");

                const healthFactorTarget = await r.init.core.controller.targetHealthFactor2();
                const amountCollateral = getBigNumberFrom(
                  amountToUseAsCollateralNum,
                  r.init.borrowInputParams.sourceDecimals
                );

                const expectedTargetAmount = getBigNumberFrom(
                  r.init.borrowInputParams.collateralFactor
                  * amountToUseAsCollateralNum * r.init.borrowInputParams.priceSourceUSD
                  / r.init.borrowInputParams.priceTargetUSD
                  / healthFactorTarget * 100 // health factor has 2 decimals, i.e. we have 100, 200 instead of 1, 2...
                  , await r.init.targetToken.decimals()
                );

                const expected = [
                  // before
                  // userContract, source, target, cToken
                  "userContract", r.init.initialCollateralAmount, 0, 0,
                  // user: source, target, cToken
                  "receiver", 0, 0, 0,
                  // pool: source, target, cToken
                  "pool", 0, r.init.availableBorrowLiquidityPerPool, 0,
                  // tc: source, target, cToken
                  "tc", 0, 0, 0,
                  // pa: source, target, cToken
                  "poolAdapter", 0, 0, 0,


                  "after",
                  // after borrowing
                  // userContract: source, target, cToken
                  "userContract", r.init.initialCollateralAmount.sub(amountCollateral), 0, 0,
                  // user: source, target, cToken
                  "receiver", 0, expectedTargetAmount, 0,
                  // pool: source, target, cToken
                  "pool", amountCollateral, r.init.availableBorrowLiquidityPerPool.sub(expectedTargetAmount), 0,
                  // tc: source, target, cToken
                  "tc", 0, 0, 0,
                  // pa: source, target, cToken
                  "poolAdapter", 0, 0, amountCollateral // !TODO: we assume exchange rate 1:1

                ].map(x => BalanceUtils.toString(x)).join("\r");

                expect(ret).equal(expected);
              });
            });
            describe("Borrow max amount, make full repay", () => {
              it("should update balances in proper way", async () => {
                const user = ethers.Wallet.createRandom().address;
                const targetDecimals = 12;
                const sourceDecimals = 24;
                const sourceAmountNumber = 100_000;
                const availableBorrowLiquidityNumber = 200_000_000;
                const tt: IBorrowInputParams = {
                  collateralFactor: 0.8,
                  priceSourceUSD: 0.1,
                  priceTargetUSD: 4,
                  sourceDecimals,
                  targetDecimals,
                  availablePools: [
                    {   // source, target
                      borrowRateInTokens: [
                        getBigNumberFrom(0, targetDecimals),
                        getBigNumberFrom(1, targetDecimals - 6), // 1e-6
                      ],
                      availableLiquidityInTokens: [0, availableBorrowLiquidityNumber]
                    }
                  ]
                };
                const sourceAmount = getBigNumberFrom(sourceAmountNumber, sourceDecimals);
                const availableBorrowLiquidity = getBigNumberFrom(availableBorrowLiquidityNumber, targetDecimals);

                const {poolInstances, cToken, userContract, sourceToken, targetToken, poolAdapters} =
                  await prepareContracts(core, tt);
                const poolInstance = poolInstances[0];
                const poolAdapter = poolAdapters[0];

                const contractsToInvestigate: IContractToInvestigate[] = [
                  {name: "userContract", contract: userContract.address},
                  {name: "user", contract: user},
                  {name: "pool", contract: poolInstance.pool},
                  {name: "tc", contract: core.tc.address},
                  {name: "poolAdapter", contract: poolAdapter},
                ];
                const tokensToInvestigate = [sourceToken.address, targetToken.address, cToken];

                // initialize balances
                await MockERC20__factory.connect(sourceToken.address, deployer)
                  .mint(userContract.address, sourceAmount);
                await MockERC20__factory.connect(targetToken.address, deployer)
                  .mint(poolInstance.pool, availableBorrowLiquidity);

                // get balances before start
                const before = await BalanceUtils.getBalances(deployer, contractsToInvestigate, tokensToInvestigate);
                console.log("before", before);

                // borrow
                await userContract.borrowMaxAmount(
                  "0x", // entry data
                  sourceToken.address,
                  sourceAmount,
                  targetToken.address,
                  user
                );

                // repay back immediately
                const targetTokenAsUser = IERC20__factory.connect(targetToken.address
                  , await DeployerUtils.startImpersonate(user)
                );
                await targetTokenAsUser.transfer(userContract.address
                  , targetTokenAsUser.balanceOf(user)
                );

                // user receives collateral and transfers it back to UserContract to restore same state as before
                await userContract.makeRepayComplete(
                  sourceToken.address,
                  targetToken.address,
                  user
                );
                const sourceTokenAsUser = IERC20__factory.connect(sourceToken.address
                  , await DeployerUtils.startImpersonate(user)
                );
                await sourceTokenAsUser.transfer(userContract.address
                  , sourceAmount
                );

                // get result balances
                const after = await BalanceUtils.getBalances(deployer, contractsToInvestigate, tokensToInvestigate);
                console.log("after", after);

                const ret = [...before, "after", ...after].map(x => BalanceUtils.toString(x)).join("\r");

                const beforeExpected = [
                  // before
                  // userContract, source, target, cToken
                  "userContract", sourceAmount, 0, 0,
                  // user: source, target, cToken
                  "user", 0, 0, 0,
                  // pool: source, target, cToken
                  "pool", 0, availableBorrowLiquidity, 0,
                  // tc: source, target, cToken
                  "tc", 0, 0, 0,
                  // pa: source, target, cToken
                  "poolAdapter", 0, 0, 0,
                ];

                // balances should be restarted in exactly same state as they were before the borrow
                const expected = [...beforeExpected, "after", ...beforeExpected]
                  .map(x => BalanceUtils.toString(x)).join("\r");

                expect(ret).equal(expected);
              });
            });
          });
        });
      });
    });

    describe("repay", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      interface IParams {
        collateralAmounts: number[];
        exactBorrowAmounts: number[];
        amountToRepay: string;
        setupTetuLiquidatorToSwapBorrowToCollateral?: boolean; // false by default
        /** Price impact in TetuLiquidator. Only not zero is used to set up liquidator */
        priceImpact?: number;

        receiverIsNull?: boolean;
        userSendsNotEnoughAmountToTetuConverter?: boolean;
        hackSendBorrowAssetAmountToBalance?: string;
        initialConverterBalanceBorrowAsset?: string;
        initialConverterBalanceCollateral?: string;
        notWhitelisted?: boolean;
      }

      interface IResults {
        countOpenedPositions: number;
        totalDebtAmountOut: number;
        totalCollateralAmountOut: number;
        receiverCollateralBalanceBeforeRepay: number;
        receiverCollateralBalanceAfterRepay: number;
        receiverBorrowAssetBalanceBeforeRepay: number;
        receiverBorrowAssetBalanceAfterRepay: number;

        collateralAmountOut: number;
        returnedBorrowAmountOut: number;
        swappedLeftoverCollateralOut: number;
        swappedLeftoverBorrowOut: number;
      }

      async function makeRepayTest(init: ISetupResults, p: IParams): Promise<IResults> {
        await PriceOracleMock__factory.connect(await core.controller.priceOracle(), deployer).changePrices(
          [init.sourceToken.address, init.targetToken.address],
          [parseUnits("1"), parseUnits("1")] // prices are set to 1 for simplicity
        );

        const borrowDecimals = await init.targetToken.decimals();
        const collateralDecimals = await init.sourceToken.decimals();

        if (p?.initialConverterBalanceCollateral) {
          await init.sourceToken.mint(init.core.tc.address, parseUnits(p.initialConverterBalanceCollateral, collateralDecimals));
        }
        if (p?.initialConverterBalanceBorrowAsset) {
          await init.targetToken.mint(init.core.tc.address, parseUnits(p.initialConverterBalanceBorrowAsset, borrowDecimals));
        }

        if (p.collateralAmounts.length) {
          await makeBorrow(
            init,
            p.collateralAmounts,
            BigNumber.from(100),
            BigNumber.from(100_000),
            {
              exactBorrowAmounts: p.exactBorrowAmounts
            }
          );
        }

        const tcAsUc = TetuConverter__factory.connect(
          init.core.tc.address,
          await DeployerUtils.startImpersonate(init.userContract.address)
        );

        const amountToRepay = parseUnits(p.amountToRepay, borrowDecimals);
        const amountToSendToTetuConverter = p?.userSendsNotEnoughAmountToTetuConverter
          ? amountToRepay.div(2)
          : amountToRepay;
        await init.targetToken.mint(tcAsUc.address, amountToSendToTetuConverter);

        const receiver = p?.receiverIsNull
          ? Misc.ZERO_ADDRESS
          : init.userContract.address;

        const receiverCollateralBalanceBeforeRepay = receiver === Misc.ZERO_ADDRESS
          ? BigNumber.from(0)
          : await init.sourceToken.balanceOf(receiver);
        const receiverBorrowAssetBalanceBeforeRepay = receiver === Misc.ZERO_ADDRESS
          ? BigNumber.from(0)
          : await init.targetToken.balanceOf(receiver);

        if (p?.hackSendBorrowAssetAmountToBalance) {
          await init.targetToken.mint(
            tcAsUc.address,
            parseUnits(p?.hackSendBorrowAssetAmountToBalance, await init.targetToken.decimals())
          );
        }

        const tcAsCaller = p?.notWhitelisted
          ? tcAsUc.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
          : tcAsUc;

        const repayOutput = await tcAsCaller.callStatic.repay(
          init.sourceToken.address,
          init.targetToken.address,
          amountToRepay,
          receiver,
          {gasLimit: GAS_LIMIT}
        );
        await tcAsCaller.repay(
          init.sourceToken.address,
          init.targetToken.address,
          amountToRepay,
          receiver,
          {gasLimit: GAS_LIMIT}
        );
        console.log("Repay results", repayOutput);

        const receiverCollateralBalanceAfterRepay = receiver === Misc.ZERO_ADDRESS
          ? BigNumber.from(0)
          : await init.sourceToken.balanceOf(receiver);
        const receiverBorrowAssetBalanceAfterRepay = receiver === Misc.ZERO_ADDRESS
          ? BigNumber.from(0)
          : await init.targetToken.balanceOf(receiver);

        const borrowsAfterRepay = await core.dm.getPositions(init.userContract.address, init.sourceToken.address, init.targetToken.address);
        const {totalDebtAmountOut, totalCollateralAmountOut} = await tcAsUc.getDebtAmountStored(
          await tcAsUc.signer.getAddress(),
          init.sourceToken.address,
          init.targetToken.address,
          false
        );

        return {
          countOpenedPositions: borrowsAfterRepay.length,

          totalDebtAmountOut: +formatUnits(totalDebtAmountOut, borrowDecimals),
          totalCollateralAmountOut: +formatUnits(totalCollateralAmountOut, collateralDecimals),
          receiverCollateralBalanceAfterRepay: +formatUnits(receiverCollateralBalanceAfterRepay, collateralDecimals),
          receiverCollateralBalanceBeforeRepay: +formatUnits(receiverCollateralBalanceBeforeRepay, collateralDecimals),
          receiverBorrowAssetBalanceBeforeRepay: +formatUnits(receiverBorrowAssetBalanceBeforeRepay, borrowDecimals),
          receiverBorrowAssetBalanceAfterRepay: +formatUnits(receiverBorrowAssetBalanceAfterRepay, borrowDecimals),

          collateralAmountOut: +formatUnits(repayOutput.collateralAmountOut, collateralDecimals),
          returnedBorrowAmountOut: +formatUnits(repayOutput.returnedBorrowAmountOut, borrowDecimals),
          swappedLeftoverBorrowOut: +formatUnits(repayOutput.swappedLeftoverBorrowOut, borrowDecimals),
          swappedLeftoverCollateralOut: +formatUnits(repayOutput.swappedLeftoverCollateralOut, collateralDecimals)
        }
      }

      describe("Swap manager is not enabled", () => {
        describe("Single lending platform", () => {
          let init: ISetupResults;
          let snapshotLocal0: string;
          before(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
            init = await prepareTetuAppWithMultipleLendingPlatforms(core,
              1,
              {tetuAppSetupParams: {setupTetuLiquidatorToSwapBorrowToCollateral: false,}}
            );
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });
          it("should return expected values after partial repay", async () => {
            const exactBorrowAmount = 120;
            const r = await makeRepayTest(init,{
              collateralAmounts: [1_000_000],
              exactBorrowAmounts: [exactBorrowAmount],
              amountToRepay: "70"
            });

            expect(r.countOpenedPositions).eq(1);
            expect(r.totalDebtAmountOut).eq(120 - 70);
          });
          it("should return expected values after full repay", async () => {
            const r = await makeRepayTest(init,{
              collateralAmounts: [1_000_000],
              exactBorrowAmounts: [120],
              amountToRepay: "120"
            });

            expect(r.countOpenedPositions).eq(0);
            expect(r.totalDebtAmountOut).eq(0);
          });
          it("should return unswapped borrow asset back to receiver if SwapManager doesn't have a conversion way", async () => {
            const r = await makeRepayTest(init,{
              collateralAmounts: [1_000_000],
              exactBorrowAmounts: [120],
              amountToRepay: "220",
              setupTetuLiquidatorToSwapBorrowToCollateral: false // swapManager doesn't have a conversion way
            });

            expect(r.countOpenedPositions).eq(0);
            expect(r.totalDebtAmountOut).eq(0);
            expect(r.receiverBorrowAssetBalanceAfterRepay - r.receiverBorrowAssetBalanceBeforeRepay).eq(220 - 120);
          });
          describe("Try to hack", () => {
            describe("Try to broke repay by sending small amount of borrow asset on balance of the TetuConverter", () => {
              it("should return expected values", async () => {
                const r = await makeRepayTest(init,{
                  collateralAmounts: [1_000_000],
                  exactBorrowAmounts: [120],
                  amountToRepay: "70",
                  hackSendBorrowAssetAmountToBalance: "1"
                });

                expect(r.countOpenedPositions).eq(1);
                expect(r.totalDebtAmountOut).eq(120 - 70);
              });
            });
          });
          describe("Bad paths", () => {
            describe("Receiver is null", () => {
              it("should revert", async () => {
                await expect(
                  makeRepayTest(init,{
                    collateralAmounts: [1_000_000],
                    exactBorrowAmounts: [120],
                    amountToRepay: "120",
                    receiverIsNull: true
                  })
                ).revertedWith("TC-1 zero address");
              });
            });
            describe("Send incorrect amount-to-repay to TetuConverter", () => {
              it("should revert", async () => {
                await expect(
                  makeRepayTest(init,{
                    collateralAmounts: [1_000_000],
                    exactBorrowAmounts: [120],
                    amountToRepay: "121", // (1)
                    userSendsNotEnoughAmountToTetuConverter: true
                  })
                ).revertedWith("TC-41 wrong amount received"); // WRONG_AMOUNT_RECEIVED
              });
            });
            describe("Not zero amount was put on balance of TetuConverter", () => {
              it("should return expected values", async () => {
                const r = await makeRepayTest(init,{
                  collateralAmounts: [1_000_000],
                  exactBorrowAmounts: [120],
                  amountToRepay: "120",
                  initialConverterBalanceBorrowAsset: "200000",
                  initialConverterBalanceCollateral: "500000",
                });

                expect(r.countOpenedPositions).eq(0);
                expect(r.totalDebtAmountOut).eq(+formatUnits((120 - 120).toString(), await init.targetToken.decimals()));
                expect(+formatUnits(await init.targetToken.balanceOf(init.core.tc.address), await init.targetToken.decimals())).eq(200_000);
                expect(+formatUnits(await init.sourceToken.balanceOf(init.core.tc.address), await init.sourceToken.decimals())).eq(500_000);
              });
            });
            describe("Not whitelisted", () => {
              it("should revert", async () => {
                await expect(
                  makeRepayTest(init,{
                    collateralAmounts: [1_000_000],
                    exactBorrowAmounts: [120],
                    amountToRepay: "120",
                    notWhitelisted: true
                  })
                ).revertedWith("TC-57 whitelist"); // OUT_OF_WHITE_LIST
              });
            });
          });
        });
        describe("Three lending platform", () => {
          let init: ISetupResults;
          let snapshotLocal0: string;
          before(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
            init = await prepareTetuAppWithMultipleLendingPlatforms(core,
              3,
              {tetuAppSetupParams: {setupTetuLiquidatorToSwapBorrowToCollateral: false,}}
            );
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });
          describe("Partial repay of single pool adapter", () => {
            it("should return expected values", async () => {
              const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
              const exactBorrowAmounts = [200, 400, 1000]; // sum == 1600
              const r = await makeRepayTest(init,{
                collateralAmounts,
                exactBorrowAmounts,
                amountToRepay: "100"
              });

              expect(r.countOpenedPositions).eq(3);
              expect(r.totalDebtAmountOut).eq(1600 - 100);
            });
          });
          describe("Partial repay, full repay of first pool adapter", () => {
            it("should return expected values", async () => {
              const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
              const exactBorrowAmounts = [200, 400, 1000]; // sum == 1600
              const r = await makeRepayTest(init,{
                collateralAmounts,
                exactBorrowAmounts,
                amountToRepay: "200"
              });

              expect(r.countOpenedPositions).eq(2);
              expect(r.totalDebtAmountOut).eq(1600 - 200);
            });
          });
          describe("Partial repay, two pool adapters", () => {
            it("should return expected values", async () => {
              const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
              const exactBorrowAmounts = [200, 400, 1000]; // sum == 1600
              const r = await makeRepayTest(init,{
                collateralAmounts,
                exactBorrowAmounts,
                amountToRepay: "600"
              });

              expect(r.countOpenedPositions).eq(1);
              expect(r.totalDebtAmountOut).eq(1600 - 600);
            });
          });
          describe("Partial repay, all pool adapters", () => {
            it("should return expected values", async () => {
              const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
              const exactBorrowAmounts = [200, 400, 1000]; // sum == 1600
              const r = await makeRepayTest(init,{
                collateralAmounts,
                exactBorrowAmounts,
                amountToRepay: "1500"
              });

              expect(r.countOpenedPositions).eq(1);
              expect(r.totalDebtAmountOut).eq(1600 - 1500);
            });
          });
          describe("Full repay, no swap", () => {
            it("should return expected values", async () => {
              const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
              const exactBorrowAmounts = [200, 400, 1000]; // sum == 1600

              const r = await makeRepayTest(init,{
                collateralAmounts,
                exactBorrowAmounts,
                amountToRepay: "1600"
              });

              expect(r.countOpenedPositions).eq(0);
              expect(r.totalDebtAmountOut).eq(0);
              expect(r.collateralAmountOut).eq(1_000_000 + 2_000_000 + 3_000_000);
              expect(r.returnedBorrowAmountOut).eq(0);
              expect(r.swappedLeftoverCollateralOut).eq(0);
              expect(r.swappedLeftoverBorrowOut).eq(0);
            });
          });

          /**
           * There are two lending platforms wth debt gaps = true
           * Make small borrow - $15, collateral = 30
           * Make large borrow using different lending platform - $1000, collateral = 2000
           * Now, the total amount of debt is $1015, total collateral 2030
           * Because of debt gap Converter returns amount to repay = 1025.15
           * Make repay 98% of the debt.
           * So, amount to repay is 1025.15*98/100 = 1004.647
           * The first debt $1000 is repaid with 1% debt gap
           * So, $1004.647 will be used to cover the first debt $1000
           * $1000 will be used to cover the debt,
           * $4.647 1) either will be returned to the user 2) OR used to cover second debt
           * This test ensures that option 2) is used
           * We expect to receive collateral = 2030*1004.647/1025.15 = 1989.4
           */
          describe("SCB-821", function () {
// todo
          });
        });
      });
      describe("Swap manager is enabled", () => {
        describe("No lending platforms", () => {
          let init: ISetupResults;
          let snapshotLocal0: string;
          before(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
            init = await prepareTetuAppWithMultipleLendingPlatforms(core,
              0,
              {tetuAppSetupParams: {setupTetuLiquidatorToSwapBorrowToCollateral: true,}}
            );
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });

          describe("Pure swap", () => {
            describe("Collateral and borrow prices are equal", () => {
              it("should return expected values", async () => {
                const r = await makeRepayTest(init,{
                  collateralAmounts: [],
                  exactBorrowAmounts: [],
                  amountToRepay: "70",
                  setupTetuLiquidatorToSwapBorrowToCollateral: true
                });

                expect(r.countOpenedPositions).eq(0);
                expect(r.totalDebtAmountOut).eq(0);
                expect(r.receiverCollateralBalanceAfterRepay - r.receiverCollateralBalanceBeforeRepay).eq(70);
              });
            });
          });
        });
        describe("Single lending platform", () => {
          let snapshotLocal0: string;
          before(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });

          describe("Full repay with swap", () => {
            it("should return expected values", async () => {
              const initialCollateralAmount = 1_000_000;
              const exactBorrowAmount = 120;
              const amountBorrowAssetToSwap = 400;

              // We need to set big price impact
              // TetuConverter should prefer to use borrowing instead swapping
              const PRICE_IMPACT_NUMERATOR = 100_000; // SwapManager.PRICE_IMPACT_NUMERATOR
              const priceImpact = PRICE_IMPACT_NUMERATOR / 100; // 1%

              const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
                1,
                {tetuAppSetupParams: {
                  setupTetuLiquidatorToSwapBorrowToCollateral: true,
                  priceImpact
                }}
              );

              const r = await makeRepayTest(init,{
                collateralAmounts: [initialCollateralAmount],
                exactBorrowAmounts: [exactBorrowAmount],
                amountToRepay: "520",
                setupTetuLiquidatorToSwapBorrowToCollateral: true,
                priceImpact
              });

              // the prices of borrow and collateral assets are equal
              const expectedCollateralAmountFromSwapping = amountBorrowAssetToSwap * (PRICE_IMPACT_NUMERATOR - priceImpact) / PRICE_IMPACT_NUMERATOR;

              expect(r.countOpenedPositions).eq(0);
              expect(r.totalDebtAmountOut).eq(0);
              expect(r.receiverCollateralBalanceAfterRepay - r.receiverCollateralBalanceBeforeRepay).eq(initialCollateralAmount + expectedCollateralAmountFromSwapping);
            });
          });
        });
        describe("Three lending platform", () => {
          // We need to set big price impact
          // TetuConverter should prefer to use borrowing instead swapping
          const PRICE_IMPACT_NUMERATOR = 100_000; // SwapManager.PRICE_IMPACT_NUMERATOR
          const priceImpact = PRICE_IMPACT_NUMERATOR / 100; // 1%

          let init: ISetupResults;
          let snapshotLocal0: string;
          before(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
            init = await prepareTetuAppWithMultipleLendingPlatforms(core,
              3,
              {tetuAppSetupParams: {setupTetuLiquidatorToSwapBorrowToCollateral: true, priceImpact}}
            );
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });

          describe("Full repay with swap", () => {
            it("should return expected values", async () => {
              const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
              const exactBorrowAmounts = [200, 400, 1000];
              const totalCollateralAmount = collateralAmounts.reduce((prev, cur) => prev + cur, 0);
              const amountToSwap = 300;

              const r = await makeRepayTest(init,{
                collateralAmounts,
                exactBorrowAmounts,
                amountToRepay: "1900", // 200 + 400 + 1000 + 300
                setupTetuLiquidatorToSwapBorrowToCollateral: true,
                priceImpact
              });

              // the prices of borrow and collateral assets are equal
              const expectedCollateralAmountFromSwapping = amountToSwap * (PRICE_IMPACT_NUMERATOR - priceImpact) / PRICE_IMPACT_NUMERATOR;
              const expectedCollateralAmountToReceive = totalCollateralAmount + expectedCollateralAmountFromSwapping;

              expect(r.countOpenedPositions).eq(0);
              expect(r.totalDebtAmountOut).eq(0);
              expect(r.receiverCollateralBalanceAfterRepay - r.receiverCollateralBalanceBeforeRepay).eq(expectedCollateralAmountToReceive);
              expect(r.receiverBorrowAssetBalanceAfterRepay - r.receiverBorrowAssetBalanceBeforeRepay).eq(0);
            });
            it("should return expected output values", async () => {
              const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
              const exactBorrowAmounts = [200, 400, 1000];
              const totalCollateralAmount = collateralAmounts.reduce((prev, cur) => prev + cur, 0);
              const amountToSwap = 300;

              const r = await makeRepayTest(init,{
                collateralAmounts,
                exactBorrowAmounts,
                amountToRepay: "1900", // 200 + 400 + 1000 + 300
                setupTetuLiquidatorToSwapBorrowToCollateral: true,
                priceImpact
              });
              console.log(r);

              // the prices of borrow and collateral assets are equal
              const expectedCollateralAmountFromSwapping = amountToSwap * (PRICE_IMPACT_NUMERATOR - priceImpact) / PRICE_IMPACT_NUMERATOR;
              const expectedCollateralAmountToReceive = totalCollateralAmount + expectedCollateralAmountFromSwapping;

              expect(r.collateralAmountOut).eq(expectedCollateralAmountToReceive);
              expect(r.returnedBorrowAmountOut).eq(0);
              expect(r.swappedLeftoverCollateralOut).eq(expectedCollateralAmountFromSwapping);
              expect(r.swappedLeftoverBorrowOut).eq(amountToSwap);
            });
          });
        });
      });

      describe("Gas estimation @skip-on-coverage", () => {
        it("should not exceed gas threshold", async () => {
          const receiver = ethers.Wallet.createRandom().address;

          const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1, {
            tetuAppSetupParams: {skipPreregistrationOfPoolAdapters: true}
          });

          const sourceAmount = parseUnits("1000", await init.sourceToken.decimals());

          const tcAsUser = ITetuConverter__factory.connect(
            core.tc.address,
            await DeployerUtils.startImpersonate(init.userContract.address)
          );
          await IERC20__factory.connect(
            init.sourceToken.address,
            await DeployerUtils.startImpersonate(init.userContract.address)
          ).approve(core.tc.address, sourceAmount);

          const plan = await tcAsUser.callStatic.findConversionStrategy(
            "0x", // entry data
            init.sourceToken.address,
            sourceAmount,
            init.targetToken.address,
            1000
          );

          await tcAsUser.borrow(
            plan.converter,
            init.sourceToken.address,
            plan.collateralAmountOut,
            init.targetToken.address,
            plan.amountToBorrowOut,
            receiver,
            {gasLimit: GAS_LIMIT}
          );
          console.log("Collateral used", plan.collateralAmountOut.toString());
          console.log("Borrowed amount", plan.amountToBorrowOut.toString());
          await MockERC20__factory.connect(
            init.targetToken.address,
            await DeployerUtils.startImpersonate(init.userContract.address)
          ).mint(core.tc.address, plan.amountToBorrowOut);
          const gasUsed = await tcAsUser.estimateGas.repay(
            init.sourceToken.address,
            init.targetToken.address,
            plan.amountToBorrowOut,
            receiver,
            {gasLimit: GAS_LIMIT}
          );

          controlGasLimitsEx2(gasUsed, GAS_TC_REPAY, (u, t) => {
            expect(u).to.be.below(t);
          });
        });
      });
    });

    describe("estimateRepay", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      interface IMakeEstimateRepayResults {
        borrowAssetAmount: BigNumber;
        unobtainableCollateralAssetAmount: BigNumber;
      }
      interface IMakeEstimateRepayParams {
        init: ISetupResults;
        collateralAmounts: number[];
        exactBorrowAmounts: number[];
        collateralAmountToRedeem: number;
        debtGapRequired?: boolean;
      }
      /* Make N borrows, ask to return given amount of collateral.
      * Return borrowed amount that should be return
      * and amount of unobtainable collateral (not zero if we ask too much)
      * */
      async function makeEstimateRepay(p: IMakeEstimateRepayParams): Promise<IMakeEstimateRepayResults> {
        const collateralTokenDecimals = await p.init.sourceToken.decimals();

        await makeBorrow(
          p.init,
          p.collateralAmounts,
          BigNumber.from(100),
          BigNumber.from(100_000),
          {
            exactBorrowAmounts: p.exactBorrowAmounts,
            debtGapRequired: p.debtGapRequired
          }
        );

        const tcAsUser = ITetuConverter__factory.connect(
          p.init.core.tc.address,
          await DeployerUtils.startImpersonate(p.init.userContract.address)
        );

        const {borrowAssetAmount, unobtainableCollateralAssetAmount} = await tcAsUser.estimateRepay(
          await tcAsUser.signer.getAddress(),
          p.init.sourceToken.address,
          getBigNumberFrom(p.collateralAmountToRedeem, collateralTokenDecimals),
          p.init.targetToken.address
        );

        return {
          borrowAssetAmount,
          unobtainableCollateralAssetAmount
        }
      }

      async function makeEstimateRepayTest(
        init: ISetupResults,
        collateralAmounts: number[],
        borrowedAmounts: number[],
        collateralAmountToRedeem: number,
        borrowedAmountToRepay: number,
        unobtainableCollateralAssetAmount?: number,
        debtGapRequired?: boolean
      ): Promise<{ ret: string, expected: string }> {
        const r = await makeEstimateRepay({
          init,
          collateralAmounts,
          exactBorrowAmounts: borrowedAmounts,
          collateralAmountToRedeem,
          debtGapRequired
        });
        const ret = [
          r.borrowAssetAmount,
          r.unobtainableCollateralAssetAmount
        ].map(x => BalanceUtils.toString(x)).join("\n");
        const expected = [
          getBigNumberFrom(borrowedAmountToRepay, await init.targetToken.decimals()),
          getBigNumberFrom(unobtainableCollateralAssetAmount || 0, await init.sourceToken.decimals())
        ].map(x => BalanceUtils.toString(x)).join("\n");
        return {ret, expected};
      }

      describe("Good paths", () => {
        describe("Single pool adapter", () => {
          let init: ISetupResults;
          let snapshot1: string;
          before(async function () {
            snapshot1 = await TimeUtils.snapshot();
            init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1);
          });
          after(async function () {
            await TimeUtils.rollback(snapshot1);
          });

          describe("Partial repay is required", () => {
            it("should return expected values", async () => {
              const collateralAmounts = [100_000];
              const borrowedAmounts = [25_000];
              const collateralAmountToRedeem = 10_000;
              const borrowedAmountToRepay = 2_500;
              const r = await makeEstimateRepayTest(
                init,
                collateralAmounts,
                borrowedAmounts,
                collateralAmountToRedeem,
                borrowedAmountToRepay
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("Full repay is required", () => {
            it("should return expected values", async () => {
              const collateralAmounts = [100_000];
              const borrowedAmounts = [25_000];
              const collateralAmountToRedeem = 100_000;
              const borrowedAmountToRepay = 25_000;
              const r = await makeEstimateRepayTest(
                init,
                collateralAmounts,
                borrowedAmounts,
                collateralAmountToRedeem,
                borrowedAmountToRepay
              );
              expect(r.ret).eq(r.expected);
            });
          });
        });
        describe("Three pool adapters", () => {
          let init: ISetupResults;
          let snapshot1: string;
          before(async function () {
            snapshot1 = await TimeUtils.snapshot();
            init = await prepareTetuAppWithMultipleLendingPlatforms(core, 3);
          });
          after(async function () {
            await TimeUtils.rollback(snapshot1);
          });

          describe("Partial repay is required", () => {
            it("should return expected values, two loans", async () => {
              const collateralAmounts = [100_000, 200_000, 300_000];
              const borrowedAmounts = [25_000, 40_000, 20_000];
              const collateralAmountToRedeem = 300_000;
              const borrowedAmountToRepay = 65_000;
              const r = await makeEstimateRepayTest(
                init,
                collateralAmounts,
                borrowedAmounts,
                collateralAmountToRedeem,
                borrowedAmountToRepay
              );
              expect(r.ret).eq(r.expected);
            });
            it("should return expected values, three loans", async () => {
              const collateralAmounts = [100_000, 200_000, 300_000];
              const borrowedAmounts = [25_000, 40_000, 20_000];
              const collateralAmountToRedeem = 450_000;
              const borrowedAmountToRepay = 75_000;
              const r = await makeEstimateRepayTest(
                init,
                collateralAmounts,
                borrowedAmounts,
                collateralAmountToRedeem,
                borrowedAmountToRepay
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("Full repay is required", () => {
            it("should return expected values", async () => {
              const collateralAmounts = [100_000, 200_000, 300_000];
              const borrowedAmounts = [25_000, 40_000, 20_000];
              const collateralAmountToRedeem = 600_000;
              const borrowedAmountToRepay = 85_000;
              const r = await makeEstimateRepayTest(
                init,
                collateralAmounts,
                borrowedAmounts,
                collateralAmountToRedeem,
                borrowedAmountToRepay
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("Require incorrect amount of collateral", () => {
            describe("Ask too much collateral", () => {
              it("should revert", async () => {
                const collateralAmounts = [100_000, 200_000, 300_000];
                const borrowedAmounts = [25_000, 40_000, 20_000];
                const unobtainableCollateralAssetAmount = 1_000_000;
                const collateralAmountToRedeem = 600_000 + unobtainableCollateralAssetAmount;
                const borrowedAmountToRepay = 85_000;
                const r = await makeEstimateRepayTest(
                  init,
                  collateralAmounts,
                  borrowedAmounts,
                  collateralAmountToRedeem,
                  borrowedAmountToRepay,
                  unobtainableCollateralAssetAmount
                );
                expect(r.ret).eq(r.expected);
              });
            });
            describe("Ask zero collateral", () => {
              it("should revert", async () => {
                const collateralAmounts = [100_000, 200_000, 300_000];
                const borrowedAmounts = [25_000, 40_000, 20_000];
                const collateralAmountToRedeem = 0;
                const borrowedAmountToRepay = 0;
                const r = await makeEstimateRepayTest(
                  init,
                  collateralAmounts,
                  borrowedAmounts,
                  collateralAmountToRedeem,
                  borrowedAmountToRepay,
                );
                expect(r.ret).eq(r.expected);
              });
            });
          });
          describe("Debt gap is required", () => {
            it("should return expected values", async () => {
              const collateralAmounts = [100_000, 200_000, 300_000];
              const borrowedAmounts = [25_000, 40_000, 20_000];
              const collateralAmountToRedeem = 600_000;
              const borrowedAmountToRepay = 85_000;
              const r = await makeEstimateRepayTest(
                init,
                collateralAmounts,
                borrowedAmounts,
                collateralAmountToRedeem,
                borrowedAmountToRepay * 101 / 100, // +1% of debt gap
                undefined,
                true // debt gap is required
              );
              expect(r.ret).eq(r.expected);
            });
          });
        });
      });
    });

    describe("events", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      describe("init", () => {
        let init: ISetupResults;
        let snapshot1: string;
        before(async function () {
          snapshot1 = await TimeUtils.snapshot();
          init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1);
        });
        describe("Borrow, partial repay", () => {
          it("should emit expected events", async () => {
            await expect(
              init.userContract.borrowExactAmount(
                init.sourceToken.address,
                parseUnits("19000", await init.sourceToken.decimals()),
                init.targetToken.address,
                init.userContract.address,
                parseUnits("117", await init.targetToken.decimals())
              )
            ).to.emit(core.tc, "OnBorrow").withArgs(
              init.poolAdapters[0],
              parseUnits("19000", await init.sourceToken.decimals()),
              parseUnits("117", await init.targetToken.decimals()),
              init.userContract.address,
              parseUnits("117", await init.targetToken.decimals())
            );

            const tcAsUc = TetuConverter__factory.connect(
              init.core.tc.address,
              await DeployerUtils.startImpersonate(init.userContract.address)
            );

            const amountToRepay = parseUnits("100", await init.targetToken.decimals());
            await init.targetToken.mint(tcAsUc.address, amountToRepay);

            await expect(
              tcAsUc.repay(
                init.sourceToken.address,
                init.targetToken.address,
                amountToRepay,
                init.userContract.address,
                {gasLimit: GAS_LIMIT}
              )
            ).to.emit(core.tc, "OnRepayBorrow").withArgs(
              init.poolAdapters[0],
              amountToRepay,
              init.userContract.address,
              false
            );
          });
        });

        describe("Borrow, repay too much", () => {
          describe("swap is not available, return un-paid amount", () => {
            it("should emit expected events", async () => {
              await expect(
                init.userContract.borrowExactAmount(
                  init.sourceToken.address,
                  parseUnits("19000", await init.sourceToken.decimals()),
                  init.targetToken.address,
                  init.userContract.address,
                  parseUnits("117", await init.targetToken.decimals())
                )
              ).to.emit(core.tc, "OnBorrow").withArgs(
                init.poolAdapters[0],
                parseUnits("19000", await init.sourceToken.decimals()),
                parseUnits("117", await init.targetToken.decimals()),
                init.userContract.address,
                parseUnits("117", await init.targetToken.decimals())
              );

              const tcAsUc = TetuConverter__factory.connect(
                init.core.tc.address,
                await DeployerUtils.startImpersonate(init.userContract.address)
              );

              // ask to repay TOO much
              const amountToRepay = parseUnits("517", await init.targetToken.decimals());
              await init.targetToken.mint(tcAsUc.address, amountToRepay);

              await expect(
                tcAsUc.repay(
                  init.sourceToken.address,
                  init.targetToken.address,
                  amountToRepay,
                  init.userContract.address,
                  {gasLimit: GAS_LIMIT}
                )
              ).to.emit(core.tc, "OnRepayBorrow").withArgs(
                init.poolAdapters[0],
                parseUnits("117", await init.targetToken.decimals()),
                init.userContract.address,
                true
              ).to.emit(core.tc, "OnRepayReturn").withArgs(
                init.targetToken.address,
                init.userContract.address,
                parseUnits("400", await init.targetToken.decimals()),
              );
            });
          });
          describe("swap is available, swap un-paid amount", () => {
            it("should emit expected events", async () => {
              const priceOracle = PriceOracleMock__factory.connect(
                await core.controller.priceOracle(),
                deployer
              );
              await priceOracle.changePrices(
                [init.sourceToken.address, init.targetToken.address],
                [Misc.WEI, Misc.WEI.mul(2)]
              );
              const tetuLiquidator = await TetuLiquidatorMock__factory.connect(
                await core.controller.tetuLiquidator(),
                deployer
              );
              await tetuLiquidator.changePrices(
                [init.sourceToken.address, init.targetToken.address],
                [Misc.WEI, Misc.WEI.mul(2)]
              );
              await tetuLiquidator.setPriceImpact(5000); // the app should prefer borrowing, not swapping

              await expect(
                init.userContract.borrowExactAmount(
                  init.sourceToken.address,
                  parseUnits("19000", await init.sourceToken.decimals()),
                  init.targetToken.address,
                  init.userContract.address,
                  parseUnits("117", await init.targetToken.decimals())
                )
              ).to.emit(core.tc, "OnBorrow").withArgs(
                init.poolAdapters[0],
                parseUnits("19000", await init.sourceToken.decimals()),
                parseUnits("117", await init.targetToken.decimals()),
                init.userContract.address,
                parseUnits("117", await init.targetToken.decimals())
              );

              const tcAsUc = TetuConverter__factory.connect(
                init.core.tc.address,
                await DeployerUtils.startImpersonate(init.userContract.address)
              );

              // ask to repay TOO much
              const amountToRepay = parseUnits("517", await init.targetToken.decimals());
              await init.targetToken.mint(tcAsUc.address, amountToRepay);

              await tetuLiquidator.setPriceImpact(0); // allow to make swapping

              await expect(
                tcAsUc.repay(
                  init.sourceToken.address,
                  init.targetToken.address,
                  amountToRepay,
                  init.userContract.address,
                  {gasLimit: GAS_LIMIT}
                )
              ).to.emit(core.tc, "OnRepayBorrow").withArgs(
                init.poolAdapters[0],
                parseUnits("117", await init.targetToken.decimals()),
                init.userContract.address,
                true
              ).to.emit(core.swapManager, "OnSwap").withArgs(
                init.targetToken.address,
                parseUnits("400", await init.targetToken.decimals()),
                init.sourceToken.address,
                init.userContract.address,
                parseUnits("800", await init.sourceToken.decimals()),
              );
            });
          });
        });

        describe("Require repay", () => {
          describe("Rebalancing", () => {
            it("should emit expected events", async () => {
              await init.userContract.borrowExactAmount(
                init.sourceToken.address,
                parseUnits("1000", await init.sourceToken.decimals()),
                init.targetToken.address,
                init.userContract.address,
                parseUnits("250", await init.targetToken.decimals())
              );

              await init.userContract.setUpRequireAmountBack(
                parseUnits("1", await init.targetToken.decimals()),
                parseUnits("1", await init.targetToken.decimals()),
                0,
                0,
                Misc.ZERO_ADDRESS,
                0,
                Misc.ZERO_ADDRESS,
                false
              );

              await init.targetToken.mint(init.userContract.address, parseUnits("1", await init.targetToken.decimals()));
              await init.targetToken.mint(init.userContract.address, parseUnits("2", await init.sourceToken.decimals()));

              // we don't test events...
              // await expect(
              //   tcAsKeeper.requireRepay(
              //     parseUnits("1", await init.targetToken.decimals()),
              //     parseUnits("2", await init.sourceToken.decimals()),
              //     init.poolAdapters[0],
              //   )
              // ).to.emit(core.tc, "OnRequireRepayRebalancing").withArgs(
              //   init.poolAdapters[0],
              //   parseUnits("1", await init.targetToken.decimals()),
              //   false,
              //   parseUnits("250", await init.targetToken.decimals()),
              //   BigNumber.from("2000000000000020000"),
              // );
            });
          });
        });

        describe("Claim rewards", () => {
          it("should emit expected events", async () => {
            await init.userContract.borrowExactAmount(
              init.sourceToken.address,
              parseUnits("1000", await init.sourceToken.decimals()),
              init.targetToken.address,
              init.userContract.address,
              parseUnits("250", await init.targetToken.decimals())
            );

            const tcAsUser = TetuConverter__factory.connect(
              init.core.tc.address,
              await DeployerUtils.startImpersonate(init.userContract.address)
            );

            const rewardToken = await MocksHelper.createMockedCToken(deployer);
            await rewardToken.mint(init.poolAdapters[0], parseUnits("71"));
            await PoolAdapterMock__factory.connect(init.poolAdapters[0], deployer).setRewards(
              rewardToken.address,
              parseUnits("71")
            );

            await expect(
              tcAsUser.claimRewards(init.userContract.address)
            ).to.emit(core.tc, "OnClaimRewards").withArgs(
              init.poolAdapters[0],
              rewardToken.address,
              parseUnits("71"),
              init.userContract.address
            );
          });
        });
      });
      describe("init usePoolAdapterStub", () => {
        let init: ISetupResults;
        let snapshot1: string;
        before(async function () {
          snapshot1 = await TimeUtils.snapshot();
          init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1, {usePoolAdapterStub: true});
        });
        describe("Require repay", () => {
          describe("Close liquidated position", () => {
            it("should emit expected events", async () => {
              const tcAsKeeper = TetuConverter__factory.connect(
                init.core.tc.address,
                await DeployerUtils.startImpersonate(await core.controller.keeper())
              );

              await PoolAdapterStub__factory.connect(init.poolAdapters[0], deployer).setManualStatus(
                parseUnits("0"), // no collateral, the position was liquidated
                parseUnits("207", await init.targetToken.decimals()),
                parseUnits("0.1"), // < 1
                true,
                parseUnits("1000", await init.sourceToken.decimals()),
                false,
              );

              const libAbi = await ethers.getContractAt("TetuConverterLogicLib", core.tc.address, deployer);

              await expect(
                tcAsKeeper.requireRepay(
                  parseUnits("1", await init.targetToken.decimals()),
                  parseUnits("0", await init.sourceToken.decimals()),
                  init.poolAdapters[0],
                )
              ).to.emit(libAbi, "OnRequireRepayCloseLiquidatedPosition").withArgs(
                init.poolAdapters[0],
                parseUnits("207", await init.targetToken.decimals()),
              );
            });
          });
        });
      });
    });

    describe("quoteRepay", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      interface IQuoteRepayParams {
        collateralPrice?: string;
        borrowPrice?: string;
        notWhitelisted?: boolean;
      }

      interface IQuoteRepayResults {
        init: ISetupResults;
        collateralAmountOutNum: number;
        swappedAmountOutNum: number;
        gasUsed: BigNumber;
      }

      async function makeQuoteRepayTest(
        init: ISetupResults,
        collateralAmounts: number[],
        exactBorrowAmounts: number[],
        amountToRepayNum: number,
        p?: IQuoteRepayParams
      ): Promise<IQuoteRepayResults> {
        await PriceOracleMock__factory.connect(await core.controller.priceOracle(), deployer).changePrices(
          [init.sourceToken.address, init.targetToken.address],
          [
            parseUnits(p?.collateralPrice || "1"),
            parseUnits(p?.borrowPrice || "1")
          ]
        );
        const targetTokenDecimals = await init.targetToken.decimals();
        const sourceTokenDecimals = await init.sourceToken.decimals();

        if (collateralAmounts.length) {
          await makeBorrow(
            init,
            collateralAmounts,
            BigNumber.from(100),
            BigNumber.from(100_000),
            {
              exactBorrowAmounts
            }
          );
        }

        const tcAsUc = TetuConverter__factory.connect(
          init.core.tc.address,
          await DeployerUtils.startImpersonate(init.userContract.address)
        );
        const tcAsCaller = p?.notWhitelisted
          ? tcAsUc.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
          : tcAsUc;

        const qouteRepayResults = await tcAsCaller.callStatic.quoteRepay(
          await tcAsCaller.signer.getAddress(),
          init.sourceToken.address,
          init.targetToken.address,
          parseUnits(amountToRepayNum.toString(), targetTokenDecimals)
        );
        const gasUsed = await tcAsCaller.estimateGas.quoteRepay(
          await tcAsCaller.signer.getAddress(),
          init.sourceToken.address,
          init.targetToken.address,
          parseUnits(amountToRepayNum.toString(), targetTokenDecimals)
        );

        return {
          init,
          collateralAmountOutNum: Number(formatUnits(qouteRepayResults.collateralAmountOut, sourceTokenDecimals)),
          swappedAmountOutNum: Number(formatUnits(qouteRepayResults.swappedAmountOut, sourceTokenDecimals)),
          gasUsed
        }
      }

      describe("One and two platforms, good paths", () => {
        describe("AmountToRepay is 0", () => {
          let init: ISetupResults;
          let snapshot1: string;
          before(async function () {
            snapshot1 = await TimeUtils.snapshot();
            init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1);
          });
          after(async function () {
            await TimeUtils.rollback(snapshot1);
          });

          it("should return 0", async () => {
            const ret = await makeQuoteRepayTest(init,[100], [10], 0);
            expect(ret.collateralAmountOutNum).eq(0);
          });
          it("should not exceed gas threshold @skip-on-coverage", async () => {
            const ret = await makeQuoteRepayTest(init,[100], [10], 0);
            controlGasLimitsEx2(ret.gasUsed, GAS_TC_QUOTE_REPAY, (u, t) => {
              expect(u).to.be.below(t);
            });
          });
        });
        describe("AmountToRepay is less or equal than the debt", () => {
          let init: ISetupResults;
          let snapshot1: string;
          before(async function () {
            snapshot1 = await TimeUtils.snapshot();
            init = await prepareTetuAppWithMultipleLendingPlatforms(core, 2);
          });
          after(async function () {
            await TimeUtils.rollback(snapshot1);
          });

          it("should return expected part of collateral, two loans", async () => {
            const ret = await makeQuoteRepayTest(init,[105, 200], [10, 20], 10);
            expect(ret.collateralAmountOutNum).eq(105);
          });
        });
      });
      describe("Three platforms", () => {
        let init: ISetupResults;
        let snapshot1: string;
        before(async function () {
          snapshot1 = await TimeUtils.snapshot();
          init = await prepareTetuAppWithMultipleLendingPlatforms(core, 3);
        });
        after(async function () {
          await TimeUtils.rollback(snapshot1);
        });

        describe("Good paths", () => {
          describe("AmountToRepay is less or equal than the debt", () => {
            it("should return expected part of collateral, three loans", async () => {
              const ret = await makeQuoteRepayTest(init,[105, 200, 300], [10, 20, 30], 30);
              expect(ret.collateralAmountOutNum).eq(305);
            });
            it("should return all collaterals", async () => {
              const ret = await makeQuoteRepayTest(init,[105, 200, 300], [10, 20, 30], 60);
              expect(ret.collateralAmountOutNum).eq(605);
            });
          });
          describe("AmountToRepay is greater than the debt", () => {
            it("should return all collateral and swapped amount", async () => {
              const ret = await makeQuoteRepayTest(init,
                [105, 200, 300],
                [10, 20, 30],
                100,
                {
                  collateralPrice: "2",
                  borrowPrice: "1"
                }
              );
              expect(ret.collateralAmountOutNum).eq(605 + 20);
              expect(ret.swappedAmountOutNum).eq(20);
            });
          });
        });
        describe("Bad paths", () => {
          it("should revert if collateral asset price is zero", async () => {
            await expect(
              makeQuoteRepayTest(init,
                [105, 200, 300],
                [10, 20, 30],
                100,
                {
                  collateralPrice: "0",  // (!)
                  borrowPrice: "1"
                }
              )
            ).revertedWith("TC-4 zero price"); // ZERO_PRICE
          });
          it("should revert if borrow asset price is zero", async () => {
            await expect(
              makeQuoteRepayTest(init,
                [105, 200, 300],
                [10, 20, 30],
                100,
                {
                  collateralPrice: "1",
                  borrowPrice: "0" // (!)
                }
              )
            ).revertedWith("TC-4 zero price"); // ZERO_PRICE
          });
          it("should revert if not whitelisted", async () => {
            await expect(
              makeQuoteRepayTest(init,
                [105, 200, 300],
                [10, 20, 30],
                100,
                {notWhitelisted: true}
              )
            ).revertedWith("TC-57 whitelist"); // OUT_OF_WHITE_LIST
          });
        });
      });
    });

    describe("safeLiquidate", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      interface ISafeLiquidateTestInputParams {
        amountInNum: string;
        receiver: string;
        priceImpactToleranceSource: number;
        priceImpactToleranceTarget: number;
        priceImpact: number;
        priceOracleSourcePrice: BigNumber;
        priceOracleTargetPrice: BigNumber;
        liquidatorSourcePrice: BigNumber;
        liquidatorTargetPrice: BigNumber;
        sourceDecimals: number;
        targetDecimals: number;
        initialConverterBalanceBorrowAsset?: string;
        initialConverterBalanceCollateral?: string;
        notWhitelisted?: boolean;
      }

      interface ISafeLiquidateTestResults {
        core: CoreContracts;
        gasUsed: BigNumber;
        amountOut: BigNumber;
        targetBalanceReceiver: BigNumber;
        sourceToken: CTokenMock;
        targetToken: CTokenMock;
      }

      async function makeSafeLiquidateTest(
        p: ISafeLiquidateTestInputParams
      ): Promise<ISafeLiquidateTestResults> {
        // initialize mocked tokens
        const sourceToken = await MocksHelper.createMockedCToken(deployer, p.sourceDecimals);
        const targetToken = await MocksHelper.createMockedCToken(deployer, p.targetDecimals);

        if (p?.initialConverterBalanceCollateral) {
          await sourceToken.mint(core.tc.address, parseUnits(p.initialConverterBalanceCollateral, await sourceToken.decimals()));
        }
        if (p?.initialConverterBalanceBorrowAsset) {
          await targetToken.mint(core.tc.address, parseUnits(p.initialConverterBalanceBorrowAsset, await targetToken.decimals()));
        }

        // setup PriceOracle-prices
        await PriceOracleMock__factory.connect(await core.controller.priceOracle(), deployer).changePrices(
          [sourceToken.address, targetToken.address],
          [p.priceOracleSourcePrice, p.priceOracleTargetPrice]
        );

        // setup TetuLiquidator
        const tetuLiquidator = TetuLiquidatorMock__factory.connect(await core.controller.tetuLiquidator(), deployer);
        await tetuLiquidator.changePrices(
          [sourceToken.address, targetToken.address],
          [p.liquidatorSourcePrice, p.liquidatorTargetPrice]
        );
        await tetuLiquidator.setPriceImpact(p.priceImpact);

        const amountIn = parseUnits(p.amountInNum, await sourceToken.decimals());
        await sourceToken.mint(core.tc.address, amountIn);
        const tcAsCaller = p?.notWhitelisted
          ? core.tc.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
          : core.tc;
        if (!p?.notWhitelisted) {
          await core.controller.setWhitelistValues([await tcAsCaller.signer.getAddress()], true);
        }
        const amountOut = await tcAsCaller.callStatic.safeLiquidate(
          sourceToken.address,
          amountIn,
          targetToken.address,
          p.receiver,
          p.priceImpactToleranceSource,
          p.priceImpactToleranceTarget
        );
        const tx = await tcAsCaller.safeLiquidate(
          sourceToken.address,
          parseUnits(p.amountInNum, await sourceToken.decimals()),
          targetToken.address,
          p.receiver,
          p.priceImpactToleranceSource,
          p.priceImpactToleranceTarget
        );

        const gasUsed = (await tx.wait()).gasUsed;
        return {
          core,
          gasUsed,
          amountOut,
          targetBalanceReceiver: await targetToken.balanceOf(p.receiver),
          sourceToken,
          targetToken
        }
      }

      describe("Good paths", () => {
        it("should transfer expected amount to the receiver, zero price impact", async () => {
          const params: ISafeLiquidateTestInputParams = {
            receiver: ethers.Wallet.createRandom().address,
            sourceDecimals: 6,
            targetDecimals: 17,
            priceImpact: 0,
            priceImpactToleranceSource: 0,
            priceImpactToleranceTarget: 0,
            priceOracleSourcePrice: parseUnits("1", 18),
            priceOracleTargetPrice: parseUnits("2", 18),
            liquidatorSourcePrice: parseUnits("1", 18),
            liquidatorTargetPrice: parseUnits("2", 18),
            amountInNum: "1000"
          }
          // amountOut = (priceIn * amount * 10**decimalsOut) / (priceOut * 10**decimalsIn);
          // amountOut = amountOut * uint(int(PRICE_IMPACT_NUMERATOR) - int(priceImpact)) / PRICE_IMPACT_NUMERATOR;

          const r = await makeSafeLiquidateTest(params);

          const ret = [
            r.amountOut,
            r.targetBalanceReceiver
          ].map(x => BalanceUtils.toString(x)).join("\n");

          const expected = [
            parseUnits("500", 17),
            parseUnits("500", 17)
          ].map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
        it("should transfer expected amount to the receiver, source price impact is low enough", async () => {
          const params: ISafeLiquidateTestInputParams = {
            receiver: ethers.Wallet.createRandom().address,
            sourceDecimals: 6,
            targetDecimals: 17,

            // we have 1000 usdc
            amountInNum: "1000",

            // liquidator: 1000 usdc => 900 dai
            priceImpact: 10_000,
            priceImpactToleranceSource: 10_000,
            liquidatorSourcePrice: parseUnits("1", 18),
            liquidatorTargetPrice: parseUnits("1", 18),

            // expected output amount according price oracle: 1000 usdc => 1100 dai
            priceOracleSourcePrice: parseUnits("11", 18),
            priceOracleTargetPrice: parseUnits("10", 18),

            // we have lost 20%, but it's ok
            priceImpactToleranceTarget: 20_000,
          }
          const r = await makeSafeLiquidateTest(params);

          const ret = [
            r.amountOut,
            r.targetBalanceReceiver
          ].map(x => BalanceUtils.toString(x)).join("\n");

          const expected = [
            parseUnits("900", 17),
            parseUnits("900", 17)
          ].map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
        it("should transfer expected amount to the receiver, output amount is much higher then expected", async () => {
          const params: ISafeLiquidateTestInputParams = {
            receiver: ethers.Wallet.createRandom().address,
            sourceDecimals: 6,
            targetDecimals: 17,

            // we have 1000 usdc
            amountInNum: "1000",

            // liquidator: 1000 usdc => 900 dai
            priceImpact: 10_000,
            priceImpactToleranceSource: 10_000,
            liquidatorSourcePrice: parseUnits("1", 18),
            liquidatorTargetPrice: parseUnits("1", 18),

            // expected output amount according price oracle: 1000 usdc => 500 dai
            priceOracleSourcePrice: parseUnits("10", 18),
            priceOracleTargetPrice: parseUnits("20", 18),

            // we have unexpected "profit" 400 dai, but it's ok
            priceImpactToleranceTarget: 0,
          }
          const r = await makeSafeLiquidateTest(params);

          const ret = [
            r.amountOut,
            r.targetBalanceReceiver
          ].map(x => BalanceUtils.toString(x)).join("\n");

          const expected = [
            parseUnits("900", 17),
            parseUnits("900", 17)
          ].map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
      });
      describe("Bad paths", () => {
        it("should revert if not whitelisted", async () => {
          const params: ISafeLiquidateTestInputParams = {
            receiver: ethers.Wallet.createRandom().address,
            sourceDecimals: 6,
            targetDecimals: 17,

            // we have 1000 usdc
            amountInNum: "1000",

            // liquidator: 1000 usdc => 900 dai
            priceImpact: 10_000,
            priceImpactToleranceSource: 10_000,
            liquidatorSourcePrice: parseUnits("1", 18),
            liquidatorTargetPrice: parseUnits("1", 18),

            // expected output amount according price oracle: 1000 usdc => 1100 dai
            priceOracleSourcePrice: parseUnits("11", 18),
            priceOracleTargetPrice: parseUnits("10", 18),

            // we have lost 20%, but only 19% are allowed
            priceImpactToleranceTarget: 18_100, // 1100/100000*18100 = 199.1 < 200

            notWhitelisted: true // (!)
          }
          await expect(
            makeSafeLiquidateTest(params)
          ).revertedWith("TC-57 whitelist"); // OUT_OF_WHITE_LIST
        });
        it("should revert on price-impact-target too high", async () => {
          const params: ISafeLiquidateTestInputParams = {
            receiver: ethers.Wallet.createRandom().address,
            sourceDecimals: 6,
            targetDecimals: 17,

            // we have 1000 usdc
            amountInNum: "1000",

            // liquidator: 1000 usdc => 900 dai
            priceImpact: 10_000,
            priceImpactToleranceSource: 10_000,
            liquidatorSourcePrice: parseUnits("1", 18),
            liquidatorTargetPrice: parseUnits("1", 18),

            // expected output amount according price oracle: 1000 usdc => 1100 dai
            priceOracleSourcePrice: parseUnits("11", 18),
            priceOracleTargetPrice: parseUnits("10", 18),

            // we have lost 20%, but only 19% are allowed
            priceImpactToleranceTarget: 18_100, // 1100/100000*18100 = 199.1 < 200
          }
          await expect(
            makeSafeLiquidateTest(params)
          ).revertedWith("TC-54 price impact"); // TOO_HIGH_PRICE_IMPACT
        });
        it("should revert on price-impact-source too high", async () => {
          const params: ISafeLiquidateTestInputParams = {
            receiver: ethers.Wallet.createRandom().address,
            sourceDecimals: 6,
            targetDecimals: 17,

            // we have 1000 usdc
            amountInNum: "1000",

            // liquidator: 1000 usdc => 900 dai, the lost is 10%
            priceImpact: 10_000,
            // but only 9% are acceptable
            priceImpactToleranceSource: 9_000,
            liquidatorSourcePrice: parseUnits("1", 18),
            liquidatorTargetPrice: parseUnits("1", 18),

            priceOracleSourcePrice: parseUnits("1", 18),
            priceOracleTargetPrice: parseUnits("1", 18),
            priceImpactToleranceTarget: 100_000,
          }
          await expect(
            makeSafeLiquidateTest(params)
          ).revertedWith("!PRICE");
        });
        describe("Not zero amount was put on balance of TetuConverter", () => {
          it("should transfer expected amount to the receiver, zero price impact", async () => {
            const params: ISafeLiquidateTestInputParams = {
              receiver: ethers.Wallet.createRandom().address,
              sourceDecimals: 6,
              targetDecimals: 17,
              priceImpact: 0,
              priceImpactToleranceSource: 0,
              priceImpactToleranceTarget: 0,
              priceOracleSourcePrice: parseUnits("1", 18),
              priceOracleTargetPrice: parseUnits("2", 18),
              liquidatorSourcePrice: parseUnits("1", 18),
              liquidatorTargetPrice: parseUnits("2", 18),
              amountInNum: "1000",
              initialConverterBalanceBorrowAsset: "200000",
              initialConverterBalanceCollateral: "500000",
            }
            const r = await makeSafeLiquidateTest(params);

            const ret = [
              r.amountOut,
              r.targetBalanceReceiver
            ].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [
              parseUnits("500", 17),
              parseUnits("500", 17)
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
            expect(+formatUnits(await r.targetToken.balanceOf(r.core.tc.address), await r.targetToken.decimals())).eq(200_000);
            expect(+formatUnits(await r.sourceToken.balanceOf(r.core.tc.address), await r.sourceToken.decimals())).eq(500_000);
          });
        });
      });
      describe("Gas estimation @skip-on-coverage", () => {
        it("should transfer expected amount to the receiver, zero price impact", async () => {
          const params: ISafeLiquidateTestInputParams = {
            receiver: ethers.Wallet.createRandom().address,
            sourceDecimals: 6,
            targetDecimals: 17,
            priceImpact: 0,
            priceImpactToleranceSource: 0,
            priceImpactToleranceTarget: 0,
            priceOracleSourcePrice: parseUnits("1", 18),
            priceOracleTargetPrice: parseUnits("2", 18),
            liquidatorSourcePrice: parseUnits("1", 18),
            liquidatorTargetPrice: parseUnits("2", 18),
            amountInNum: "1000"
          }
          const ret = await makeSafeLiquidateTest(params);
          controlGasLimitsEx2(ret.gasUsed, GAS_TC_SAFE_LIQUIDATE, (u, t) => {
            expect(u).to.be.below(t);
          });
        });
      });
    });

    describe("isConversionValid", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      // isConversionValid is tested in SwapLibTest, so there is only simple test here
      describe("Good paths", () => {
        it("should return expected values", async () => {
          // initialize mocked tokens
          const sourceToken = await MocksHelper.createMockedCToken(deployer, 6);
          const targetToken = await MocksHelper.createMockedCToken(deployer, 7);

          // setup PriceOracle-prices
          await PriceOracleMock__factory.connect(await core.controller.priceOracle(), deployer).changePrices(
            [sourceToken.address, targetToken.address],
            [Misc.WEI, Misc.WEI]
          );

          const ret = await core.tc.isConversionValid(
            sourceToken.address,
            parseUnits("1", 6),
            targetToken.address,
            parseUnits("1", 7),
            0
          );

          expect(ret).eq(true);
        });
      });
    });

    describe("repayTheBorrow, use Borrower", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      interface IHealthFactorParams {
        minHealthFactor2: number;
        targetHealthFactor2: number;
        maxHealthFactor2?: number;
      }

      interface IRepayTheBorrowParams {
        collateralAmounts: string[];
        borrowAmounts: string[];
        indexPoolAdapter: number;

        amountToRepay: string;
        closePosition: boolean;

        wrongResultHealthFactor?: boolean;
        initialConverterBalanceBorrowAsset?: string;
        initialConverterBalanceCollateral?: string;

        healthFactorsBeforeBorrow?: IHealthFactorParams;
        healthFactorsBeforeRepay?: IHealthFactorParams;

        // following amounts are set it collateral asset
        // because TetuConverter.requireRepay currently uses only amounts in collateral asset
        amountToReturn1: string;
        amountToTransfer1: string;
        amountToReturn2: string;
        amountToTransfer2: string;

        amountToSendToPoolAdapterAtFirstCall?: string;
        closeDebtAtFirstCall?: boolean;

        tetuConverterExecutor?: string;
        skipBorrow?: boolean;
      }

      interface IRepayTheBorrowResults {
        gasUsed: BigNumber;
        collateralAmountOut: number;
        repaidAmountOut: number;
        balanceUserAfterBorrow: {
          borrow: number,
          collateral: number
        }
        balanceUserAfterRepay: {
          borrow: number,
          collateral: number
        }
        onTransferAmounts: {
          assets: string[];
          amounts: number[];
        }

        countCallsOfRequirePayAmountBack: number;
        amountPassedToRequireRepayAtFirstCall: number;
        amountPassedToRequireRepayAtSecondCall: number;

        finalConverterBalanceBorrowAsset: number;
        finalConverterBalanceCollateral: number;

        poolAdapterStatusBefore: IPoolAdapterStatusNum;
        poolAdapterStatusAfter: IPoolAdapterStatusNum;

        borrowAsset: string;
        collateralAsset: string;
      }

      async function makeRepayTheBorrowTest(init: ISetupResults, p: IRepayTheBorrowParams): Promise<IRepayTheBorrowResults> {
        const decimalsBorrow = await init.targetToken.decimals();
        const decimalsCollateral = await init.sourceToken.decimals();
        console.log("decimalsCollateral", decimalsCollateral);
        console.log("decimalsBorrow", decimalsBorrow);

        // set up initial balances
        if (p?.initialConverterBalanceCollateral) {
          await init.sourceToken.mint(init.core.tc.address, parseUnits(p.initialConverterBalanceCollateral, decimalsCollateral));
        }
        if (p?.initialConverterBalanceBorrowAsset) {
          await init.targetToken.mint(init.core.tc.address, parseUnits(p.initialConverterBalanceBorrowAsset, decimalsBorrow));
        }

        // set up health factors before borrowing
        if (p.healthFactorsBeforeBorrow) {
          await init.core.controller.setMaxHealthFactor2(p.healthFactorsBeforeBorrow.maxHealthFactor2 || p.healthFactorsBeforeBorrow.targetHealthFactor2 * 10);
          await init.core.controller.setTargetHealthFactor2(p.healthFactorsBeforeBorrow.targetHealthFactor2);
          await init.core.controller.setMinHealthFactor2(p.healthFactorsBeforeBorrow.minHealthFactor2);
        }

        // make borrows
        if (! p.skipBorrow) {
          await makeBorrow(
            init,
            p.collateralAmounts.map(x => Number(x)),
            BigNumber.from(100),
            BigNumber.from(100_000),
            {
              exactBorrowAmounts: p.borrowAmounts.map(x => Number(x))
            }
          );
        }

        const initialUserCollateralBalance = await init.sourceToken.balanceOf(init.userContract.address);
        const initialUserBorrowAssetBalance = await init.targetToken.balanceOf(init.userContract.address);
        console.log("initialUserCollateralBalance", initialUserCollateralBalance.toString());
        console.log("initialUserBorrowAssetBalance", initialUserBorrowAssetBalance.toString());

        if (p.healthFactorsBeforeRepay) {
          await init.core.controller.setMaxHealthFactor2(p.healthFactorsBeforeRepay.maxHealthFactor2 || p.healthFactorsBeforeRepay.targetHealthFactor2 * 10);
          await init.core.controller.setTargetHealthFactor2(p.healthFactorsBeforeRepay.targetHealthFactor2);
          await init.core.controller.setMinHealthFactor2(p.healthFactorsBeforeRepay.minHealthFactor2);
        }

        const user = await DeployerUtils.startImpersonate(init.userContract.address);
        const poolAdapter = init.poolAdapters[p.indexPoolAdapter];
        const pa = IPoolAdapter__factory.connect(poolAdapter, user);

        const amountProvider = ethers.Wallet.createRandom().address;
        if (p.amountToSendToPoolAdapterAtFirstCall) {
          const amountOnProviderBalance = parseUnits(p.amountToSendToPoolAdapterAtFirstCall, decimalsBorrow);
          await init.targetToken.mint(amountProvider, amountOnProviderBalance);
          await init.targetToken.connect(await DeployerUtils.startImpersonate(amountProvider)).approve(init.userContract.address, amountOnProviderBalance);
        }

        await init.userContract.setUpRequireAmountBack(
          p.amountToReturn1 === "" ? Misc.MAX_UINT : parseUnits(p.amountToReturn1, decimalsCollateral),
          p.amountToTransfer1 === "" ? Misc.MAX_UINT : parseUnits(p.amountToTransfer1, decimalsCollateral),
          p.amountToReturn2 === "" ? Misc.MAX_UINT : parseUnits(p.amountToReturn2, decimalsCollateral),
          p.amountToTransfer2 === "" ? Misc.MAX_UINT : parseUnits(p.amountToTransfer2, decimalsCollateral),
          p.amountToSendToPoolAdapterAtFirstCall || p.closeDebtAtFirstCall
            ? init.poolAdapters[p.indexPoolAdapter]
            : Misc.ZERO_ADDRESS,
          p.amountToSendToPoolAdapterAtFirstCall
            ? parseUnits(p.amountToSendToPoolAdapterAtFirstCall, decimalsCollateral)
            : 0,
          amountProvider,
          p.closeDebtAtFirstCall ?? false
        );

        // put amount-to-repay on user's balance and approve it for tetuConverter
        await init.targetToken.mint(user.address, parseUnits(p.amountToRepay, decimalsBorrow));
        await init.targetToken.connect(
          await DeployerUtils.startImpersonate(core.tc.address)
        ).approve(pa.address, Misc.MAX_UINT);

        const tetuConverter = core.tc.connect(
          await DeployerUtils.startImpersonate(
            p.tetuConverterExecutor || await core.controller.governance()
          )
        );

        const poolAdapterStatusBefore = await pa.getStatus();

        const ret = await tetuConverter.callStatic.repayTheBorrow(pa.address, p.closePosition);
        const tx = await tetuConverter.repayTheBorrow(pa.address, p.closePosition);
        const gasUsed = (await tx.wait()).gasUsed;

        const retUserCallback = await init.userContract.getOnTransferAmountsResults();
        const requireAmountBackParams = await init.userContract.requireAmountBackParams();

        return {
          collateralAmountOut: +formatUnits(ret.collateralAmountOut, decimalsCollateral),
          repaidAmountOut: +formatUnits(ret.repaidAmountOut, decimalsBorrow),
          gasUsed,
          balanceUserAfterBorrow: {
            borrow: +formatUnits(initialUserBorrowAssetBalance, decimalsBorrow),
            collateral:  +formatUnits(initialUserCollateralBalance, decimalsCollateral)
          },
          balanceUserAfterRepay: {
            borrow: +formatUnits(await init.targetToken.balanceOf(user.address), decimalsBorrow),
            collateral: +formatUnits(await init.sourceToken.balanceOf(user.address), decimalsCollateral)
          },
          onTransferAmounts: {
            assets: retUserCallback.assets,
            amounts: await Promise.all(
              retUserCallback.amounts.map(
                async (x, index) => +formatUnits(
                  x,
                  await IERC20Metadata__factory.connect(retUserCallback.assets[index], deployer).decimals()
                )
              )
            )
          },

          countCallsOfRequirePayAmountBack: requireAmountBackParams.countCalls.toNumber(),
          amountPassedToRequireRepayAtFirstCall: +formatUnits(requireAmountBackParams.amountPassedToRequireRepayAtFirstCall, decimalsCollateral),
          amountPassedToRequireRepayAtSecondCall: +formatUnits(requireAmountBackParams.amountPassedToRequireRepayAtSecondCall, decimalsCollateral),

          finalConverterBalanceCollateral: +formatUnits(await init.sourceToken.balanceOf(core.tc.address), decimalsCollateral),
          finalConverterBalanceBorrowAsset: +formatUnits(await init.targetToken.balanceOf(core.tc.address), decimalsCollateral),

          poolAdapterStatusBefore: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(poolAdapterStatusBefore, decimalsCollateral, decimalsBorrow),
          poolAdapterStatusAfter: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(await pa.getStatus(), decimalsCollateral, decimalsBorrow),

          borrowAsset: init.targetToken.address,
          collateralAsset: init.sourceToken.address
        }
      }

      describe("Two platforms", () => {
        let init: ISetupResults;
        let snapshot1: string;
        before(async function () {
          snapshot1 = await TimeUtils.snapshot();
          init = await prepareTetuAppWithMultipleLendingPlatforms(
            core,
            2, // two platforms
            {
              sourceDecimals: 6,
              targetDecimals: 6,
              collateralFactor: 1, // for simplicity of calculations
              initialCollateralAmount: "1000"
            }
          );
        });
        after(async function () {
          await TimeUtils.rollback(snapshot1);
        });

        describe("Normal case, single call of requirePayAmountBack", () => {
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeTest(): Promise<IRepayTheBorrowResults> {
            return makeRepayTheBorrowTest(init, {
              collateralAmounts: ["150", "160"],
              borrowAmounts: ["1.5", "80"],
              indexPoolAdapter: 1,

              amountToRepay: "80",
              closePosition: true,

              amountToReturn1: "80",
              amountToTransfer1: "80",
              amountToReturn2: "0",
              amountToTransfer2: "0",
            });
          }

          it("should return expected collateralAmountOut", async () => {
            const r = await loadFixture(makeTest);
            expect(r.collateralAmountOut).eq(160);
          });
          it("should return expected repaidAmountOut", async () => {
            const r = await loadFixture(makeTest);
            expect(r.repaidAmountOut).eq(80);
          });
          it("should set expected collateral balance for the user", async () => {
            const r = await loadFixture(makeTest);
            expect(r.balanceUserAfterRepay.collateral - r.balanceUserAfterBorrow.collateral).eq(160);
          });
          it("should set expected borrow balance for the user", async () => {
            const r = await loadFixture(makeTest);
            expect(r.balanceUserAfterRepay.borrow - r.balanceUserAfterBorrow.borrow).eq(0);
          });
          it("should return expected initial status of the pool adapter", async () => {
            const r = await loadFixture(makeTest);
            expect(r.poolAdapterStatusBefore.opened).eq(true);
            expect(r.poolAdapterStatusBefore.collateralAmount).eq(160);
            expect(r.poolAdapterStatusBefore.amountToPay).eq(80);
          });
          it("the debt should be closed on completion", async () => {
            const r = await loadFixture(makeTest);
            expect(r.poolAdapterStatusAfter.opened).eq(false);
            expect(r.poolAdapterStatusAfter.collateralAmount).eq(0);
            expect(r.poolAdapterStatusAfter.amountToPay).eq(0);
          });
          it("should pass expected amounts to onTransferAmounts", async () => {
            const r = await loadFixture(makeTest);
            expect(r.onTransferAmounts.amounts.join()).eq([0, 160].join());
          });
          it("should pass expected assets to onTransferAmounts", async () => {
            const r = await loadFixture(makeTest);
            expect(r.onTransferAmounts.assets.join()).eq([r.borrowAsset, r.collateralAsset].join());
          });
        });
      });
      describe("Single platform", () => {
        let init: ISetupResults;
        let snapshot1: string;
        before(async function () {
          snapshot1 = await TimeUtils.snapshot();
          init = await prepareTetuAppWithMultipleLendingPlatforms(
            core,
            1, // single platform
            {
              sourceDecimals: 6,
              targetDecimals: 6,
              collateralFactor: 1, // for simplicity of calculations
              initialCollateralAmount: "1000"
            }
          );
        });
        after(async function () {
          await TimeUtils.rollback(snapshot1);
        });

        describe("Good paths", () => {
          describe("Normal case, two calls of requirePayAmountBack", () => {
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeTest(): Promise<IRepayTheBorrowResults> {
              return makeRepayTheBorrowTest(init,{
                collateralAmounts: ["160"],
                borrowAmounts: ["80"],
                indexPoolAdapter: 0,

                // healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
                // healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},

                amountToRepay: "80",
                closePosition: true,

                amountToReturn1: "80",
                amountToTransfer1: "0",
                amountToReturn2: "80",
                amountToTransfer2: "80",
              });
            }

            it("should return expected collateralAmountOut", async () => {
              const r = await loadFixture(makeTest);
              expect(r.collateralAmountOut).eq(160);
            });
            it("should return expected repaidAmountOut", async () => {
              const r = await loadFixture(makeTest);
              expect(r.repaidAmountOut).eq(80);
            });
            it("should set expected collateral balance for the user", async () => {
              const r = await loadFixture(makeTest);
              expect(r.balanceUserAfterRepay.collateral - r.balanceUserAfterBorrow.collateral).eq(160);
            });
            it("should set expected borrow balance for the user", async () => {
              const r = await loadFixture(makeTest);
              expect(r.balanceUserAfterRepay.borrow - r.balanceUserAfterBorrow.borrow).eq(0);
            });
            it("should return expected initial status of the pool adapter", async () => {
              const r = await loadFixture(makeTest);
              expect(r.poolAdapterStatusBefore.opened).eq(true);
              expect(r.poolAdapterStatusBefore.collateralAmount).eq(160);
              expect(r.poolAdapterStatusBefore.amountToPay).eq(80);
            });
            it("the debt should be closed on completion", async () => {
              const r = await loadFixture(makeTest);
              expect(r.poolAdapterStatusAfter.opened).eq(false);
              expect(r.poolAdapterStatusAfter.collateralAmount).eq(0);
              expect(r.poolAdapterStatusAfter.amountToPay).eq(0);
            });
            it("should pass expected amounts to onTransferAmounts", async () => {
              const r = await loadFixture(makeTest);
              expect(r.onTransferAmounts.amounts.join()).eq([0, 160].join());
            });
            it("should pass expected assets to onTransferAmounts", async () => {
              const r = await loadFixture(makeTest);
              expect(r.onTransferAmounts.assets.join()).eq([r.borrowAsset, r.collateralAsset].join());
            });

          });
          describe("Single call, user returns less amount than required", () => {
            describe("Don't attempt to close position", () => {
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeTest(): Promise<IRepayTheBorrowResults> {
                return makeRepayTheBorrowTest(init, {
                  collateralAmounts: ["160"],
                  borrowAmounts: ["80"],
                  indexPoolAdapter: 0,

                  // healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
                  // healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},

                  amountToRepay: "80",
                  closePosition: false,

                  amountToReturn1: "20",
                  amountToTransfer1: "20",
                  amountToReturn2: "0",
                  amountToTransfer2: "0",
                });
              }

              it("should return expected collateralAmountOut", async () => {
                const r = await loadFixture(makeTest);
                expect(r.collateralAmountOut).eq(40);
              });
              it("should return expected repaidAmountOut", async () => {
                const r = await loadFixture(makeTest);
                expect(r.repaidAmountOut).eq(20);
              });
              it("should set expected collateral balance for the user", async () => {
                const r = await loadFixture(makeTest);
                expect(r.balanceUserAfterRepay.collateral - r.balanceUserAfterBorrow.collateral).eq(40);
              });
              it("should set expected borrow balance for the user", async () => {
                const r = await loadFixture(makeTest);
                expect(r.balanceUserAfterRepay.borrow - r.balanceUserAfterBorrow.borrow).eq(80 - 20);
              });
              it("should return expected initial status of the pool adapter", async () => {
                const r = await loadFixture(makeTest);
                expect(r.poolAdapterStatusBefore.opened).eq(true);
                expect(r.poolAdapterStatusBefore.collateralAmount).eq(160);
                expect(r.poolAdapterStatusBefore.amountToPay).eq(80);
              });
              it("the debt should be closed on completion", async () => {
                const r = await loadFixture(makeTest);
                expect(r.poolAdapterStatusAfter.opened).eq(true);
                expect(r.poolAdapterStatusAfter.collateralAmount).eq(120);
                expect(r.poolAdapterStatusAfter.amountToPay).eq(60);
              });
              it("should pass expected amounts to onTransferAmounts", async () => {
                const r = await loadFixture(makeTest);
                expect(r.onTransferAmounts.amounts.join()).eq([0, 40].join());
              });
              it("should pass expected assets to onTransferAmounts", async () => {
                const r = await loadFixture(makeTest);
                expect(r.onTransferAmounts.assets.join()).eq([r.borrowAsset, r.collateralAsset].join());
              });
            });
          });
          describe("Two calls, user returns less amount than required", () => {
            describe("Don't attempt to close position", () => {
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeTest(): Promise<IRepayTheBorrowResults> {
                return makeRepayTheBorrowTest(init, {
                  collateralAmounts: ["160"],
                  borrowAmounts: ["80"],
                  indexPoolAdapter: 0,

                  // healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
                  // healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},

                  amountToRepay: "80",
                  closePosition: false,

                  amountToReturn1: "20",
                  amountToTransfer1: "0",
                  amountToReturn2: "20",
                  amountToTransfer2: "20",
                });
              }

              it("should return expected collateralAmountOut", async () => {
                const r = await loadFixture(makeTest);
                expect(r.collateralAmountOut).eq(40);
              });
              it("should return expected repaidAmountOut", async () => {
                const r = await loadFixture(makeTest);
                expect(r.repaidAmountOut).eq(20);
              });
              it("should set expected collateral balance for the user", async () => {
                const r = await loadFixture(makeTest);
                expect(r.balanceUserAfterRepay.collateral - r.balanceUserAfterBorrow.collateral).eq(40);
              });
              it("should set expected borrow balance for the user", async () => {
                const r = await loadFixture(makeTest);
                expect(r.balanceUserAfterRepay.borrow - r.balanceUserAfterBorrow.borrow).eq(80 - 20);
              });
              it("should return expected initial status of the pool adapter", async () => {
                const r = await loadFixture(makeTest);
                expect(r.poolAdapterStatusBefore.opened).eq(true);
                expect(r.poolAdapterStatusBefore.collateralAmount).eq(160);
                expect(r.poolAdapterStatusBefore.amountToPay).eq(80);
              });
              it("the debt should be closed on completion", async () => {
                const r = await loadFixture(makeTest);
                expect(r.poolAdapterStatusAfter.opened).eq(true);
                expect(r.poolAdapterStatusAfter.collateralAmount).eq(120);
                expect(r.poolAdapterStatusAfter.amountToPay).eq(60);
              });
              it("should pass expected amounts to onTransferAmounts", async () => {
                const r = await loadFixture(makeTest);
                expect(r.onTransferAmounts.amounts.join()).eq([0, 40].join());
              });
              it("should pass expected assets to onTransferAmounts", async () => {
                const r = await loadFixture(makeTest);
                expect(r.onTransferAmounts.assets.join()).eq([r.borrowAsset, r.collateralAsset].join());
              });
            });
          });
          describe("Debt is completely closed during receiving of the required amount", () => {
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeTest(): Promise<IRepayTheBorrowResults> {
              return makeRepayTheBorrowTest(init, {
                collateralAmounts: ["160"],
                borrowAmounts: ["80"],
                indexPoolAdapter: 0,

                // healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
                // healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},

                amountToRepay: "80",
                closePosition: true,

                amountToReturn1: "80",
                amountToTransfer1: "0",
                amountToReturn2: "80",
                amountToTransfer2: "80",

                closeDebtAtFirstCall: true,
              });
            }

            it("should return zero collateralAmountOut", async () => {
              const r = await loadFixture(makeTest);
              expect(r.collateralAmountOut).eq(0);
            });
            it("should return zero repaidAmountOut", async () => {
              const r = await loadFixture(makeTest);
              expect(r.repaidAmountOut).eq(0);
            });
            it("user hasn't received any collateral", async () => {
              const r = await loadFixture(makeTest);
              expect(r.balanceUserAfterRepay.collateral - r.balanceUserAfterBorrow.collateral).eq(0);
            });
            it("user hasn't paid anything", async () => {
              const r = await loadFixture(makeTest);
              expect(r.balanceUserAfterRepay.borrow - r.balanceUserAfterBorrow.borrow).eq(80);
            });
            it("should return expected initial status of the pool adapter", async () => {
              const r = await loadFixture(makeTest);
              expect(r.poolAdapterStatusBefore.opened).eq(true);
              expect(r.poolAdapterStatusBefore.collateralAmount).eq(160);
              expect(r.poolAdapterStatusBefore.amountToPay).eq(80);
            });
            it("the debt should be closed on completion", async () => {
              const r = await loadFixture(makeTest);
              expect(r.poolAdapterStatusAfter.opened).eq(false);
              expect(r.poolAdapterStatusAfter.collateralAmount).eq(0);
              expect(r.poolAdapterStatusAfter.amountToPay).eq(0);
            });
            it("should not call onTransferAmounts", async () => {
              const r = await loadFixture(makeTest);
              expect(r.onTransferAmounts.amounts.join()).eq([].join());
              expect(r.onTransferAmounts.assets.join()).eq([].join());
            });
          });
          describe("Debt is partially closed during receiving of the required amount", () => {
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeTest(): Promise<IRepayTheBorrowResults> {
              return makeRepayTheBorrowTest(init, {
                collateralAmounts: ["160"],
                borrowAmounts: ["80"],
                indexPoolAdapter: 0,

                // healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
                // healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},

                amountToRepay: "80",
                closePosition: true,

                amountToReturn1: "80",
                amountToTransfer1: "0",
                amountToReturn2: "60",
                amountToTransfer2: "60",

                amountToSendToPoolAdapterAtFirstCall: "20"
              });
            }

            it("should return expected collateralAmountOut", async () => {
              const r = await loadFixture(makeTest);
              expect(r.collateralAmountOut).eq(120);
            });
            it("should return expected repaidAmountOut", async () => {
              const r = await loadFixture(makeTest);
              expect(r.repaidAmountOut).eq(60);
            });
            it("user should receive expected collateral amount", async () => {
              const r = await loadFixture(makeTest);
              expect(r.balanceUserAfterRepay.collateral - r.balanceUserAfterBorrow.collateral).eq(120); // 60 were sent to amountProvider inside Borrower.requirePayAmountBack
            });
            it("user should pay expected borrow asset amount", async () => {
              const r = await loadFixture(makeTest);
              console.log(r);
              expect(r.balanceUserAfterRepay.borrow - r.balanceUserAfterBorrow.borrow).eq(80 - 60); // 20 were taken from amountProvider
            });
            it("should return expected initial status of the pool adapter", async () => {
              const r = await loadFixture(makeTest);
              expect(r.poolAdapterStatusBefore.opened).eq(true);
              expect(r.poolAdapterStatusBefore.collateralAmount).eq(160);
              expect(r.poolAdapterStatusBefore.amountToPay).eq(80);
            });
            it("the debt should be closed on completion", async () => {
              const r = await loadFixture(makeTest);
              expect(r.poolAdapterStatusAfter.opened).eq(false);
              expect(r.poolAdapterStatusAfter.collateralAmount).eq(0);
              expect(r.poolAdapterStatusAfter.amountToPay).eq(0);
            });
            it("should pass expected amounts to onTransferAmounts", async () => {
              const r = await loadFixture(makeTest);
              expect(r.onTransferAmounts.amounts.join()).eq([0, 120].join());
            });
            it("should pass expected assets to onTransferAmounts", async () => {
              const r = await loadFixture(makeTest);
              expect(r.onTransferAmounts.assets.join()).eq([r.borrowAsset, r.collateralAsset].join());
            });
          });
        });

        describe("Bad paths", () => {
          beforeEach(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          afterEach(async function () {
            await TimeUtils.rollback(snapshot);
          });

          it("should revert if try to close position with not enough amount - two calls", async () => {
            await expect(makeRepayTheBorrowTest(init,{
              collateralAmounts: ["160"],
              borrowAmounts: ["80"],
              indexPoolAdapter: 0,

              // healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
              // healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},

              amountToRepay: "80",
              closePosition: true,

              amountToReturn1: "20",
              amountToTransfer1: "0",
              amountToReturn2: "20",
              amountToTransfer2: "20",
            })).revertedWith("TC-10 position not empty"); // ATTEMPT_TO_CLOSE_NOT_EMPTY_BORROW_POSITION
          });
          it("should revert if try to close position with not enough amount - single call", async () => {
            await expect(makeRepayTheBorrowTest(init,{
              collateralAmounts: ["160"],
              borrowAmounts: ["80"],
              indexPoolAdapter: 0,

              // healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
              // healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},

              amountToRepay: "80",
              closePosition: true,

              amountToReturn1: "20",
              amountToTransfer1: "20",
              amountToReturn2: "0",
              amountToTransfer2: "0",
            })).revertedWith("TC-10 position not empty"); // ATTEMPT_TO_CLOSE_NOT_EMPTY_BORROW_POSITION
          });
          it("should revert if callback returns zero amount", async () => {
            await expect(makeRepayTheBorrowTest(init,{
              collateralAmounts: ["160"],
              borrowAmounts: ["80"],
              indexPoolAdapter: 0,

              amountToRepay: "80",
              closePosition: true,

              amountToReturn1: "0",
              amountToTransfer1: "0",
              amountToReturn2: "0",
              amountToTransfer2: "0",
            })).revertedWith("TC-43 zero amount"); // ZERO_AMOUNT
          });
          it("should revert if not governance", async () => {
            await expect(makeRepayTheBorrowTest(init,{
              collateralAmounts: ["160"],
              borrowAmounts: ["80"],
              indexPoolAdapter: 0,

              amountToRepay: "80",
              closePosition: true,

              amountToReturn1: "20",
              amountToTransfer1: "0",
              amountToReturn2: "20",
              amountToTransfer2: "20",

              tetuConverterExecutor: ethers.Wallet.createRandom().address // (!) not governance
            })).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
          });
          it("should revert if no debts", async () => {
            await expect(makeRepayTheBorrowTest(init,{
              collateralAmounts: ["160"],
              borrowAmounts: ["80"],
              indexPoolAdapter: 0,

              amountToRepay: "80",
              closePosition: true,

              amountToReturn1: "20",
              amountToTransfer1: "0",
              amountToReturn2: "20",
              amountToTransfer2: "20",

              skipBorrow: true
            })).revertedWith("TC-27 repay failed"); // REPAY_FAILED
          });
        });
      });
    });

    describe("repayTheBorrow, use TetuConverterCallbackMock", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      interface IRepayTheBorrowParams {
        collateralAsset: MockERC20;
        borrowAsset: MockERC20;
        tetuConverterCallback: {
          amount: string,
          amountToSend: string,
          amountOut: string
        }
        repayParams: {
          amountToRepay: string;
          closePosition: boolean;

          collateralAmountSendToReceiver: string;
          borrowAmountSendToReceiver: string;
        }
        statusParams: {
          collateralAmount: string;
          amountToPay: string;
          healthFactor18: string;
          opened: boolean;
          collateralAmountLiquidated: string;
        }
        updateStatusParams?: {
          collateralAmount: string;
          amountToPay: string;
          healthFactor18: string;
          opened: boolean;
          collateralAmountLiquidated: string;
        }
        tetuConverterExecutor?: string; // governance by default
        debtGap?: boolean;
      }

      interface IRepayTheBorrowResults {
        gasUsed: BigNumber;
        collateralAmountOut: number;
        repaidAmountOut: number;
        balanceUserAfterRepay: {
          borrow: number,
          collateral: number
        }
        onTransferAmounts: {
          assets: string[];
          amounts: number[];
        }
      }

      async function makeRepayTheBorrowTest(
        p: IRepayTheBorrowParams
      ): Promise<IRepayTheBorrowResults> {
        const platformAdapter = await MocksHelper.createLendingPlatformMock2(deployer);
        const poolAdapter = await MocksHelper.createPoolAdapterMock2(deployer);
        const user = await MocksHelper.createTetuConverterCallbackMock(deployer);

        await core.controller.setWhitelistValues([user.address], true);
        await core.bm.addAssetPairs(
          platformAdapter.address,
          [p.collateralAsset.address],
          [p.borrowAsset.address],
        );

        const pa = PoolAdapterMock2__factory.connect(poolAdapter.address, deployer);
        const decimalsCollateral = await p.collateralAsset.decimals();
        const decimalsBorrow = await p.borrowAsset.decimals();

        await pa.setConfig(
          ethers.Wallet.createRandom().address,
          user.address,
          p.collateralAsset.address,
          p.borrowAsset.address
        );
        await pa.setStatus(
          parseUnits(p.statusParams.collateralAmount, decimalsCollateral),
          parseUnits(p.statusParams.amountToPay, decimalsBorrow),
          parseUnits(p.statusParams.healthFactor18, 18),
          p.statusParams.opened,
          parseUnits(p.statusParams.collateralAmountLiquidated, decimalsCollateral),
          !!p?.debtGap
        );
        if (p.updateStatusParams) {
          await pa.setUpdateStatus(
            parseUnits(p.updateStatusParams.collateralAmount, decimalsCollateral),
            parseUnits(p.updateStatusParams.amountToPay, decimalsBorrow),
            parseUnits(p.updateStatusParams.healthFactor18, 18),
            p.updateStatusParams.opened,
            parseUnits(p.updateStatusParams.collateralAmountLiquidated, decimalsCollateral),
            !!p?.debtGap
          );
        }
        await pa.setRepay(
          p.collateralAsset.address,
          p.borrowAsset.address,
          parseUnits(p.repayParams.amountToRepay, decimalsBorrow),
          p.repayParams.closePosition,
          parseUnits(p.repayParams.collateralAmountSendToReceiver, decimalsCollateral),
          parseUnits(p.repayParams.borrowAmountSendToReceiver, decimalsBorrow)
        );
        await p.collateralAsset.mint(
          pa.address,
          parseUnits(p.statusParams.collateralAmount, decimalsCollateral)
        );

        await user.setRequirePayAmountBack(
          p.borrowAsset.address,
          parseUnits(p.tetuConverterCallback.amount, decimalsBorrow),
          parseUnits(p.tetuConverterCallback.amountOut, decimalsBorrow),
          parseUnits(p.tetuConverterCallback.amountToSend, decimalsBorrow),
        );
        await p.borrowAsset.mint(
          user.address,
          parseUnits(p.repayParams.amountToRepay, decimalsBorrow),
        );

        await p.borrowAsset.connect(
          await DeployerUtils.startImpersonate(core.tc.address)
        ).approve(pa.address, Misc.MAX_UINT);
        console.log("approved", core.tc.address, pa.address);

        const tetuConverter = core.tc.connect(
          await DeployerUtils.startImpersonate(
            p.tetuConverterExecutor || await core.controller.governance()
          )
        );

        const ret = await tetuConverter.callStatic.repayTheBorrow(pa.address, p.repayParams.closePosition);
        const tx = await tetuConverter.repayTheBorrow(pa.address, p.repayParams.closePosition);
        const gasUsed = (await tx.wait()).gasUsed;

        const retUserCallback = await user.getOnTransferAmountsResults();
        return {
          collateralAmountOut: +formatUnits(ret.collateralAmountOut, decimalsCollateral),
          repaidAmountOut: +formatUnits(ret.repaidAmountOut, decimalsBorrow),
          gasUsed,
          balanceUserAfterRepay: {
            borrow: +formatUnits(await p.borrowAsset.balanceOf(user.address), decimalsBorrow),
            collateral: +formatUnits(await p.collateralAsset.balanceOf(user.address), decimalsCollateral)
          },
          onTransferAmounts: {
            assets: retUserCallback.assets,
            amounts: await Promise.all(
              retUserCallback.amounts.map(
                async (x, index) => +formatUnits(
                  x,
                  await IERC20Metadata__factory.connect(retUserCallback.assets[index], deployer).decimals()
                )
              )
            )
          }
        }
      }

      describe("Good paths", () => {
        describe("Ensure update status is called", () => {
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeTest(): Promise<IRepayTheBorrowResults> {
            const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
            const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);
            return makeRepayTheBorrowTest({
              collateralAsset,
              borrowAsset,
              tetuConverterCallback: {
                amount: "50",
                amountOut: "50",
                amountToSend: "50"
              },
              repayParams: {
                closePosition: true,
                borrowAmountSendToReceiver: "0",
                collateralAmountSendToReceiver: "100",
                amountToRepay: "50"
              },
              statusParams: {
                collateralAmount: "1001111111",
                amountToPay: "50111111",
                opened: true,
                collateralAmountLiquidated: "0",
                healthFactor18: "2"
              },
              updateStatusParams: {
                collateralAmount: "100",
                amountToPay: "50",
                opened: true,
                collateralAmountLiquidated: "0",
                healthFactor18: "2"
              }
            });
          }
          it("should return expected collateralAmountOut", async () => {
            const r = await loadFixture(makeTest);
            expect(r.collateralAmountOut).eq(100);
          });
          it("should return expected repaidAmountOut", async () => {
            const r = await loadFixture(makeTest);
            expect(r.repaidAmountOut).eq(50);
          });
          it("should set expected collateral balance for the user", async () => {
            const r = await loadFixture(makeTest);
            expect(r.balanceUserAfterRepay.collateral).eq(100);
          });
          it("should set expected borrow balance for the user", async () => {
            const r = await loadFixture(makeTest);
            expect(r.balanceUserAfterRepay.borrow).eq(0);
          });
        });

        describe("Return a part of borrow-amount back to the user", () => {
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeTest(): Promise<IRepayTheBorrowResults> {
            const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
            const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);
            return makeRepayTheBorrowTest({
              collateralAsset,
              borrowAsset,
              tetuConverterCallback: {
                amount: "50",
                amountOut: "40", // (!)
                amountToSend: "40" // (!)
              },
              repayParams: {
                closePosition: false, // (!)
                borrowAmountSendToReceiver: "5",
                collateralAmountSendToReceiver: "100",
                amountToRepay: "40"
              },
              statusParams: {
                collateralAmount: "100",
                amountToPay: "50",
                opened: true,
                collateralAmountLiquidated: "0",
                healthFactor18: "2"
              }
            });
          }
          it("should return expected collateralAmountOut", async () => {
            const r = await loadFixture(makeTest);
            expect(r.collateralAmountOut).eq(100);
          });
          it("should return expected repaidAmountOut", async () => {
            const r = await loadFixture(makeTest);
            expect(r.repaidAmountOut).eq(40 - 5);
          });
          it("should set expected collateral balance for the user", async () => {
            const r = await loadFixture(makeTest);
            expect(r.balanceUserAfterRepay.collateral).eq(100);
          });
          it("should set expected borrow balance for the user", async () => {
            const r = await loadFixture(makeTest);
            expect(r.balanceUserAfterRepay.borrow).eq(5);
          });
        });
        describe('Debt gap is required', () => {
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });
          async function makeTest(): Promise<IRepayTheBorrowResults> {
            const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
            const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);
            return makeRepayTheBorrowTest({
              collateralAsset,
              borrowAsset,
              tetuConverterCallback: {
                amount: "50.5",
                amountOut: "50.5",
                amountToSend: "50.5"
              },
              repayParams: {
                // amount-to-repay is 50
                // default debt gap is 1%
                // so, user should send us 50 + 0.5 = 50.5
                // let's return back 0.3
                closePosition: true,
                borrowAmountSendToReceiver: "0.3",
                collateralAmountSendToReceiver: "100",
                amountToRepay: "50.5"
              },
              statusParams: {
                collateralAmount: "100",
                amountToPay: "50",
                opened: true,
                collateralAmountLiquidated: "0",
                healthFactor18: "2"
              },
              debtGap: true
            });
          }

          it("should return expected collateralAmountOut", async () => {
            const r = await loadFixture(makeTest);
            expect(r.collateralAmountOut).eq(100);
          });
          it("should return expected repaidAmountOut", async () => {
            const r = await loadFixture(makeTest);
            expect(r.repaidAmountOut).eq(50.2); // 50.5 - 0.3 = 50.2
          });
          it("should set expected collateral balance for the user", async () => {
            const r = await loadFixture(makeTest);
            expect(r.balanceUserAfterRepay.collateral).eq(100);
          });
          it("should set expected borrow balance for the user", async () => {
            const r = await loadFixture(makeTest);
            expect(r.balanceUserAfterRepay.borrow).eq(0.3);
          });
        });

        /**
         * This test is going to improve coverage of repayTheBorrow.
         * It covers following branch:
         *
         *  repaidAmountOut = repaidAmountOut > amounts[0]
         *    ? repaidAmountOut - amounts[0]
         *    : 0 // (!) this one
         */
        describe("Full repaid amount is returned back to user as unused debt gap", () => {
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });
          async function makeTest(): Promise<IRepayTheBorrowResults> {
            const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
            const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);
            return makeRepayTheBorrowTest({
              collateralAsset,
              borrowAsset,
              tetuConverterCallback: {
                amount: "50",
                amountOut: "50",
                amountToSend: "50"
              },
              repayParams: {
                closePosition: true,
                borrowAmountSendToReceiver: "50",
                collateralAmountSendToReceiver: "0",
                amountToRepay: "50"
              },
              statusParams: {
                collateralAmount: "100",
                amountToPay: "50",
                opened: true,
                collateralAmountLiquidated: "0",
                healthFactor18: "2"
              }
            });
          }

          it("should return expected collateralAmountOut", async () => {
            const r = await loadFixture(makeTest);
            expect(r.collateralAmountOut).eq(0);
          });
          it("should return expected repaidAmountOut", async () => {
            const r = await loadFixture(makeTest);
            expect(r.repaidAmountOut).eq(0);
          });
          it("should set expected collateral balance for the user", async () => {
            const r = await loadFixture(makeTest);
            expect(r.balanceUserAfterRepay.collateral).eq(0);
          });
          it("should set expected borrow balance for the user", async () => {
            const r = await loadFixture(makeTest);
            expect(r.balanceUserAfterRepay.borrow).eq(50);
          });
        });
      });
    });

    describe("getPositions", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      it("should return single open position after borrowing", async () => {
        const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1);
        await makeBorrow(init, [100], BigNumber.from(100), BigNumber.from(100_000));
        const r = await core.tc.getPositions(init.userContract.address, init.sourceToken.address, init.targetToken.address);
        expect(r.length).eq(1);
      });
    });

    describe("salvage", () => {
      let snapshot0: string;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      describe("Good paths", () => {
        it("should return expected values", async () => {
          const receiver = ethers.Wallet.createRandom().address;
          const sourceToken = await MocksHelper.createMockedCToken(deployer, 6);
          const targetToken = await MocksHelper.createMockedCToken(deployer, 7);

          const governance = await core.controller.governance();

          await sourceToken.mint(core.tc.address, 1000);
          await targetToken.mint(core.tc.address, 2000);
          await core.tc.connect(await Misc.impersonate(governance)).salvage(receiver, sourceToken.address, 800);
          await core.tc.connect(await Misc.impersonate(governance)).salvage(receiver, targetToken.address, 2000);
          expect((await sourceToken.balanceOf(receiver)).toNumber()).eq(800);
          expect((await targetToken.balanceOf(receiver)).toNumber()).eq(2000);
        });
      });
      describe("Bad paths", () => {
        it("should return expected values", async () => {
          const receiver = ethers.Wallet.createRandom().address;
          const sourceToken = await MocksHelper.createMockedCToken(deployer, 6);

          await expect(
            core.tc.connect(await Misc.impersonate(receiver)).salvage(receiver, sourceToken.address, 800)
          ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
        });
      });
    });

    describe("requireRepay", () => {
      let snapshot0: string;
      let init: ISetupResults;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
        init = await prepareTetuAppWithMultipleLendingPlatforms(
          core,
          3, // all tests below use 3 collateral amounts
          {
            sourceDecimals: 6,
            targetDecimals: 6,
            collateralFactor: 1 // for simplicity of calculations
          }
        );
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      interface IHealthFactorParams {
        minHealthFactor2: number;
        targetHealthFactor2: number;
        maxHealthFactor2?: number;
      }

      interface IRepayAmounts {
        amountCollateralNum: string,
        amountBorrowNum: string,
      }

      interface IRequireRepayParams {
        collateralAmounts: string[];
        borrowAmounts: string[];
        repayAmounts: IRepayAmounts;
        indexPoolAdapter: number;

        notKeeper?: boolean;
        wrongResultHealthFactor?: boolean;
        initialConverterBalanceBorrowAsset?: string;
        initialConverterBalanceCollateral?: string;

        initialUserBalance: string;

        healthFactorsBeforeBorrow?: IHealthFactorParams;
        healthFactorsBeforeRepay?: IHealthFactorParams;

        // following amounts are set it collateral asset
        // because TetuConverter.requireRepay currently uses only amounts in collateral asset
        amountToReturn1: string;
        amountToTransfer1: string;
        amountToReturn2: string;
        amountToTransfer2: string;

        amountToSendToPoolAdapterAtFirstCall?: string;
        closeDebtAtFirstCall?: boolean;
      }

      interface IRequireRepayResults {
        openedPositions: string[];
        totalDebtAmountOut: number;
        totalCollateralAmountOut: number;
        poolAdapterStatusBefore: IPoolAdapterStatusNum;
        poolAdapterStatusAfter: IPoolAdapterStatusNum;

        countCallsOfRequirePayAmountBack: number;
        amountPassedToRequireRepayAtFirstCall: number;
        amountPassedToRequireRepayAtSecondCall: number;

        initialUserCollateralBalance: number;
        finalUserCollateralBalance: number;

        finalConverterBalanceBorrowAsset: number;
        finalConverterBalanceCollateral: number;
      }

      async function makeRequireRepay(p: IRequireRepayParams): Promise<IRequireRepayResults> {
        const decimalsBorrow = await init.targetToken.decimals();
        const decimalsCollateral = await init.sourceToken.decimals();
        console.log("decimalsCollateral", decimalsCollateral);
        console.log("decimalsBorrow", decimalsBorrow);

        // set up initial balances
        if (p?.initialConverterBalanceCollateral) {
          await init.sourceToken.mint(init.core.tc.address, parseUnits(p.initialConverterBalanceCollateral, decimalsCollateral));
        }
        if (p?.initialConverterBalanceBorrowAsset) {
          await init.targetToken.mint(init.core.tc.address, parseUnits(p.initialConverterBalanceBorrowAsset, decimalsBorrow));
        }

        // set up health factors before borrowing
        if (p.healthFactorsBeforeBorrow) {
          await init.core.controller.setMaxHealthFactor2(p.healthFactorsBeforeBorrow.maxHealthFactor2 || p.healthFactorsBeforeBorrow.targetHealthFactor2 * 10);
          await init.core.controller.setTargetHealthFactor2(p.healthFactorsBeforeBorrow.targetHealthFactor2);
          await init.core.controller.setMinHealthFactor2(p.healthFactorsBeforeBorrow.minHealthFactor2);
        }

        // make borrows
        await makeBorrow(
          init,
          p.collateralAmounts.map(x => Number(x)),
          BigNumber.from(100),
          BigNumber.from(100_000),
          {
            exactBorrowAmounts: p.borrowAmounts.map(x => Number(x))
          }
        );

        if (p.healthFactorsBeforeRepay) {
          await init.core.controller.setMaxHealthFactor2(p.healthFactorsBeforeRepay.maxHealthFactor2 || p.healthFactorsBeforeRepay.targetHealthFactor2 * 10);
          await init.core.controller.setTargetHealthFactor2(p.healthFactorsBeforeRepay.targetHealthFactor2);
          await init.core.controller.setMinHealthFactor2(p.healthFactorsBeforeRepay.minHealthFactor2);
        }

        // assume, the keeper detects problem health factor in the given pool adapter
        const user = await DeployerUtils.startImpersonate(init.userContract.address);
        const tcAsKeeper = p?.notKeeper
          ? init.core.tc
          : TetuConverter__factory.connect(
            init.core.tc.address,
            await DeployerUtils.startImpersonate(await init.core.controller.keeper())
          );
        const poolAdapter = init.poolAdapters[p.indexPoolAdapter];
        const paAsUc = IPoolAdapter__factory.connect(poolAdapter, user);

        // ... so we need to claim a borrow amount back from user contract
        // put the amount on user contract and require repay
        const amountToRepayCollateralAsset = await parseUnits(p.repayAmounts.amountCollateralNum, decimalsCollateral);
        const amountToRepayBorrowAsset = await parseUnits(p.repayAmounts.amountBorrowNum, decimalsBorrow);

        await init.sourceToken.mint(init.userContract.address, parseUnits(p.initialUserBalance, decimalsCollateral));
        const initialUserCollateralBalance = await init.sourceToken.balanceOf(init.userContract.address);
        console.log("initialUserCollateralBalance", initialUserCollateralBalance);

        const amountProvider = ethers.Wallet.createRandom().address;
        if (p.amountToSendToPoolAdapterAtFirstCall) {
          await init.sourceToken.mint(amountProvider, parseUnits(p.amountToSendToPoolAdapterAtFirstCall, decimalsCollateral));
          await init.sourceToken.connect(
            await DeployerUtils.startImpersonate(amountProvider)
          ).approve(init.userContract.address, parseUnits(p.amountToSendToPoolAdapterAtFirstCall, decimalsCollateral));
        }

        await init.userContract.setUpRequireAmountBack(
          p.amountToReturn1 === "" ? Misc.MAX_UINT : parseUnits(p.amountToReturn1, decimalsCollateral),
          p.amountToTransfer1 === "" ? Misc.MAX_UINT : parseUnits(p.amountToTransfer1, decimalsCollateral),
          p.amountToReturn2 === "" ? Misc.MAX_UINT : parseUnits(p.amountToReturn2, decimalsCollateral),
          p.amountToTransfer2 === "" ? Misc.MAX_UINT : parseUnits(p.amountToTransfer2, decimalsCollateral),
          p.amountToSendToPoolAdapterAtFirstCall || p.closeDebtAtFirstCall
            ? init.poolAdapters[p.indexPoolAdapter]
            : Misc.ZERO_ADDRESS,
          p.amountToSendToPoolAdapterAtFirstCall
            ? parseUnits(p.amountToSendToPoolAdapterAtFirstCall, decimalsCollateral)
            : 0,
          amountProvider,
          p.closeDebtAtFirstCall ?? false
        );

        const poolAdapterStatusBefore: IPoolAdapterStatus = await paAsUc.getStatus();
        console.log("poolAdapterStatusBefore", poolAdapterStatusBefore);
        await tcAsKeeper.requireRepay(
          amountToRepayBorrowAsset,
          amountToRepayCollateralAsset,
          poolAdapter,
        );

        const tcAsUc = ITetuConverter__factory.connect(init.core.tc.address, user);

        const poolAdapterStatusAfter: IPoolAdapterStatus = await paAsUc.getStatus();
        console.log("poolAdapterStatusAfter", poolAdapterStatusAfter);

        const openedPositions = await core.dm.getPositions(init.userContract.address, init.sourceToken.address, init.targetToken.address);
        const {
          totalDebtAmountOut,
          totalCollateralAmountOut
        } = await tcAsUc.getDebtAmountStored(
          await tcAsUc.signer.getAddress(),
          init.sourceToken.address,
          init.targetToken.address,
          false
        );

        const requireAmountBackParams = (await init.userContract.requireAmountBackParams());
        const finalUserCollateralBalance = await init.sourceToken.balanceOf(init.userContract.address);

        return {
          openedPositions,
          totalDebtAmountOut: +formatUnits(totalDebtAmountOut, decimalsBorrow),
          totalCollateralAmountOut: +formatUnits(totalCollateralAmountOut, decimalsCollateral),
          poolAdapterStatusBefore: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(poolAdapterStatusBefore, decimalsCollateral, decimalsBorrow),
          poolAdapterStatusAfter: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(poolAdapterStatusAfter, decimalsCollateral, decimalsBorrow),
          countCallsOfRequirePayAmountBack: requireAmountBackParams.countCalls.toNumber(),
          amountPassedToRequireRepayAtFirstCall: +formatUnits(requireAmountBackParams.amountPassedToRequireRepayAtFirstCall, decimalsCollateral),
          amountPassedToRequireRepayAtSecondCall: +formatUnits(requireAmountBackParams.amountPassedToRequireRepayAtSecondCall, decimalsCollateral),

          initialUserCollateralBalance: +formatUnits(initialUserCollateralBalance, decimalsCollateral),
          finalUserCollateralBalance: +formatUnits(finalUserCollateralBalance, decimalsCollateral),

          finalConverterBalanceCollateral: +formatUnits(await init.sourceToken.balanceOf(init.core.tc.address), decimalsCollateral),
          finalConverterBalanceBorrowAsset: +formatUnits(await init.targetToken.balanceOf(init.core.tc.address), decimalsCollateral),

        }
      }

      describe("Good paths", () => {
        describe("Repay using collateral asset", () => {
          describe("User has enough amount to make full payment", () => {
            describe("Requested amount to repay is already on the balance of the user, single call of requirePayAmountBack", () => {
              let snapshotLocal0: string;
              before(async function () {
                snapshotLocal0 = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshotLocal0);
              });

              async function makeRequireRepayTest(): Promise<IRequireRepayResults> {
                return makeRequireRepay({
                  collateralAmounts: ["110", "150", "320"],
                  borrowAmounts: ["1.1", "1.5", "32"],
                  repayAmounts: {amountCollateralNum: "32", amountBorrowNum: "16"},
                  indexPoolAdapter: 2,
                  healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
                  healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},
                  amountToReturn1: "32",
                  amountToTransfer1: "32",
                  amountToReturn2: "0",
                  amountToTransfer2: "0",
                  initialConverterBalanceBorrowAsset: "0",
                  initialUserBalance: "64" // 32 + 32
                });
              }

              it("should keep all positions opened", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.openedPositions.length).eq(3);
              });
              it("should not change total debt", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.totalDebtAmountOut).eq(1.1 + 1.5 + 32);
              });
              it("should update total collateral", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.totalCollateralAmountOut).eq(110 + 150 + 320 + 32);
              });
              it("should return expected initial status of the pool adapter", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.poolAdapterStatusBefore.opened).eq(true);
                expect(r.poolAdapterStatusBefore.collateralAmount).eq(320);
                expect(r.poolAdapterStatusBefore.amountToPay).eq(32);
              });
              it("should return expected final status of the pool adapter", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.poolAdapterStatusAfter.opened).eq(true);
                expect(r.poolAdapterStatusAfter.collateralAmount).eq(320 + 32);
                expect(r.poolAdapterStatusAfter.amountToPay).eq(32);
              });
              it("should make expected count of calls of requirePayAmountBack", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.countCallsOfRequirePayAmountBack).eq(1);
              });
              it("should send expected amount at first call of requireRepay", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.amountPassedToRequireRepayAtFirstCall).eq(32);
              });
              it("should change balance of collateral asset of the user exectedly", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.initialUserCollateralBalance - r.finalUserCollateralBalance).eq(32);
              });
            });
            describe("User prepares requested amount on first call and sends it to converter on the second call of requirePayAmountBack", () => {
              let snapshotLocal0: string;
              before(async function () {
                snapshotLocal0 = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshotLocal0);
              });

              /**
               * target health factor: 5
               *
               * Collateral amount: 160
               * borrowed amount: 80
               * health factor: 2
               * Required borrowing amount: 80*2/5=32
               * Required collateral amount: 160*5/2-160 = 240
               */
              async function makeRequireRepayTest(): Promise<IRequireRepayResults> {
                return makeRequireRepay({
                  collateralAmounts: ["110", "150", "160"],
                  borrowAmounts: ["1.1", "1.5", "80"],
                  repayAmounts: {amountCollateralNum: "240", amountBorrowNum: "32"},
                  indexPoolAdapter: 2,
                  healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
                  // healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},
                  amountToReturn1: "240", // amount is prepared
                  amountToTransfer1: "0",  // ...but was not sent at the first call
                  amountToReturn2: "0",
                  amountToTransfer2: "240", // the amount is sent on the
                  initialConverterBalanceBorrowAsset: "0",
                  initialUserBalance: "1000",
                });
              }

              it("should keep all positions opened", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.openedPositions.length).eq(3);
              });
              it("should not change total debt", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.totalDebtAmountOut).eq(1.1 + 1.5 + 80);
              });
              it("should update total collateral", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.totalCollateralAmountOut).eq(110 + 150 + 160 + 240);
              });
              it("should return expected initial status of the pool adapter", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.poolAdapterStatusBefore.opened).eq(true);
                expect(r.poolAdapterStatusBefore.collateralAmount).eq(160);
                expect(r.poolAdapterStatusBefore.amountToPay).eq(80);
              });
              it("should return expected final status of the pool adapter", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.poolAdapterStatusAfter.opened).eq(true);
                expect(r.poolAdapterStatusAfter.collateralAmount).eq(160 + 240);
                expect(r.poolAdapterStatusAfter.amountToPay).eq(80);
              });
              it("should make expected count of calls of requirePayAmountBack", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.countCallsOfRequirePayAmountBack).eq(2);
              });
              it("should send expected amount at first call of requireRepay", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.amountPassedToRequireRepayAtFirstCall).eq(240);
              });
              it("should send expected amount at second call of requireRepay", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.amountPassedToRequireRepayAtSecondCall).eq(240);
              });
              it("should change balance of collateral asset of the user expectedly", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.initialUserCollateralBalance - r.finalUserCollateralBalance).eq(240);
              });
            });
          });
          describe("User doesn't have enough amount to make full payment", () => {
            describe("All available amount to repay is already on the balance of the user, single call of requirePayAmountBack", () => {
              let snapshotLocal0: string;
              before(async function () {
                snapshotLocal0 = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshotLocal0);
              });

              async function makeRequireRepayTest(): Promise<IRequireRepayResults> {
                return makeRequireRepay({
                  collateralAmounts: ["110", "150", "320"],
                  borrowAmounts: ["1.1", "1.5", "32"],
                  repayAmounts: {amountCollateralNum: "32", amountBorrowNum: "16"},
                  indexPoolAdapter: 2,
                  healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
                  healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},
                  amountToReturn1: "31",
                  amountToTransfer1: "31",
                  amountToReturn2: "0",
                  amountToTransfer2: "0",
                  initialConverterBalanceBorrowAsset: "0",
                  initialUserBalance: "63" // 32 + 31
                });
              }

              it("should keep all positions opened", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.openedPositions.length).eq(3);
              });
              it("should not change total debt", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.totalDebtAmountOut).eq(1.1 + 1.5 + 32);
              });
              it("should update total collateral", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.totalCollateralAmountOut).eq(110 + 150 + 320 + 31);
              });
              it("should return expected initial status of the pool adapter", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.poolAdapterStatusBefore.opened).eq(true);
                expect(r.poolAdapterStatusBefore.collateralAmount).eq(320);
                expect(r.poolAdapterStatusBefore.amountToPay).eq(32);
              });
              it("should return expected final status of the pool adapter", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.poolAdapterStatusAfter.opened).eq(true);
                expect(r.poolAdapterStatusAfter.collateralAmount).eq(320 + 31);
                expect(r.poolAdapterStatusAfter.amountToPay).eq(32);
              });
              it("should make expected count of calls of requirePayAmountBack", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.countCallsOfRequirePayAmountBack).eq(1);
              });
              it("should change balance of collateral asset of the user exectedly", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.initialUserCollateralBalance - r.finalUserCollateralBalance).eq(31);
              });
            });
            describe("User prepares part of requested amount on first call and sends it to converter on the second call of requirePayAmountBack", () => {
              let snapshotLocal0: string;
              before(async function () {
                snapshotLocal0 = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshotLocal0);
              });

              /**
               * target health factor: 5
               *
               * Collateral amount: 160
               * borrowed amount: 80
               * health factor: 2
               * Required borrowing amount: 80*2/5=32
               * Required collateral amount: 160*5/2-160 = 240
               */
              async function makeRequireRepayTest(): Promise<IRequireRepayResults> {
                return makeRequireRepay({
                  collateralAmounts: ["110", "150", "160"],
                  borrowAmounts: ["1.1", "1.5", "80"],
                  repayAmounts: {amountCollateralNum: "240", amountBorrowNum: "32"},
                  indexPoolAdapter: 2,
                  healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
                  // healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},
                  amountToReturn1: "180", // amount is prepared
                  amountToTransfer1: "0",  // ...but was not sent at the first call
                  amountToReturn2: "0",
                  amountToTransfer2: "180",
                  initialConverterBalanceBorrowAsset: "0",
                  initialUserBalance: "1000",
                });
              }

              it("should keep all positions opened", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.openedPositions.length).eq(3);
              });
              it("should not change total debt", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.totalDebtAmountOut).eq(1.1 + 1.5 + 80);
              });
              it("should update total collateral", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.totalCollateralAmountOut).eq(110 + 150 + 160 + 180);
              });
              it("should return expected initial status of the pool adapter", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.poolAdapterStatusBefore.opened).eq(true);
                expect(r.poolAdapterStatusBefore.collateralAmount).eq(160);
                expect(r.poolAdapterStatusBefore.amountToPay).eq(80);
              });
              it("should return expected final status of the pool adapter", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.poolAdapterStatusAfter.opened).eq(true);
                expect(r.poolAdapterStatusAfter.collateralAmount).eq(160 + 180);
                expect(r.poolAdapterStatusAfter.amountToPay).eq(80);
              });
              it("should make expected count of calls of requirePayAmountBack", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.countCallsOfRequirePayAmountBack).eq(2);
              });
              it("should send expected amount at first call of requireRepay", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.amountPassedToRequireRepayAtFirstCall).eq(240);
              });
              it("should send expected amount at second call of requireRepay", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.amountPassedToRequireRepayAtSecondCall).eq(180);
              });
              it("should change balance of collateral asset of the user expectedly", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.initialUserCollateralBalance - r.finalUserCollateralBalance).eq(180);
              });
            });
          });
          describe("Health factor of the pool adapter is changed during receiving of the requested amount", () => {
            describe("The debt is completely closed", () => {
              let snapshotLocal0: string;
              before(async function () {
                snapshotLocal0 = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshotLocal0);
              });

              async function makeRequireRepayTest(): Promise<IRequireRepayResults> {
                return makeRequireRepay({
                  collateralAmounts: ["110", "150", "320"],
                  borrowAmounts: ["1.1", "1.5", "32"],
                  repayAmounts: {amountCollateralNum: "32", amountBorrowNum: "16"},
                  indexPoolAdapter: 2,
                  healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
                  healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},
                  amountToReturn1: "31", // amount is prepared
                  amountToTransfer1: "0",  // ...but was not sent at the first call
                  amountToReturn2: "0",
                  amountToTransfer2: "31", // the amount is sent on the
                  initialConverterBalanceBorrowAsset: "0",
                  initialUserBalance: "63", // 32 + 31
                  closeDebtAtFirstCall: true,
                });
              }

              /**
               * In practice, it should be changed, but the test implementation is not ideal...
               */
              it.skip("should keep all positions opened", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.openedPositions.length).eq(3);
              });
              it("should change total debt", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.totalDebtAmountOut).eq(1.1 + 1.5);
              });
              it("should update total collateral", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.totalCollateralAmountOut).eq(110 + 150);
              });
              it("should return expected initial status of the pool adapter", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.poolAdapterStatusBefore.opened).eq(true);
                expect(r.poolAdapterStatusBefore.collateralAmount).eq(320);
                expect(r.poolAdapterStatusBefore.amountToPay).eq(32);
              });
              it("the debt should be closed on completion", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.poolAdapterStatusAfter.opened).eq(false);
                expect(r.poolAdapterStatusAfter.collateralAmount).eq(0);
                expect(r.poolAdapterStatusAfter.amountToPay).eq(0);
              });
              it("should make only single of requirePayAmountBack", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.countCallsOfRequirePayAmountBack).eq(1);
              });
              it("should send expected amount at first call of requireRepay", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.amountPassedToRequireRepayAtFirstCall).eq(32);
              });
              it("should not change balance of collateral asset of the user", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.initialUserCollateralBalance).eq(r.finalUserCollateralBalance);
              });
            });
            describe("Amount is reduced", () => {
              let snapshotLocal0: string;
              before(async function () {
                snapshotLocal0 = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshotLocal0);
              });

              /**
               * target health factor: 5
               *
               * Collateral amount: 160
               * borrowed amount: 80
               * health factor: 2
               * Required borrowing amount: 80*2/5=32
               * Required collateral amount: 160*5/2-160 = 240
               *
               * Amount added to the collateral: 120
               * Collateral amount: 280
               * health factor: 280/80=3.5
               * Required collateral amount: 280*5/3.5-280 = 120
               */
              async function makeRequireRepayTest(): Promise<IRequireRepayResults> {
                return makeRequireRepay({
                  collateralAmounts: ["110", "150", "160"],
                  borrowAmounts: ["1.1", "1.5", "80"],
                  repayAmounts: {amountCollateralNum: "240", amountBorrowNum: "32"},
                  indexPoolAdapter: 2,
                  healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
                  // healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},
                  amountToReturn1: "240", // requested amount is prepared
                  amountToTransfer1: "0",  // ...but was not sent at the first call
                  amountToReturn2: "0",
                  amountToTransfer2: "", // transfer requested amount
                  initialConverterBalanceBorrowAsset: "0",
                  initialUserBalance: "1000",
                  amountToSendToPoolAdapterAtFirstCall: "120",
                });
              }

              it("should keep all positions opened", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                console.log(r);
                expect(r.openedPositions.length).eq(3);
              });
              it("should not change total debt", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.totalDebtAmountOut).eq(1.1 + 1.5 + 80);
              });
              it("should update total collateral", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.totalCollateralAmountOut).eq(110 + 150 + 160 + 120 + 120);
              });
              it("should return expected initial status of the pool adapter", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.poolAdapterStatusBefore.opened).eq(true);
                expect(r.poolAdapterStatusBefore.collateralAmount).eq(160);
                expect(r.poolAdapterStatusBefore.amountToPay).eq(80);
              });
              it("should return expected final status of the pool adapter", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.poolAdapterStatusAfter.opened).eq(true);
                expect(r.poolAdapterStatusAfter.collateralAmount).eq(400);
                expect(r.poolAdapterStatusAfter.amountToPay).eq(80);
              });
              it("should make two calls of requirePayAmountBack", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.countCallsOfRequirePayAmountBack).eq(2);
              });
              it("should send expected amount at first call of requireRepay", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.amountPassedToRequireRepayAtFirstCall).eq(240);
              });
              it("should reduce balance of the user on expecgted amount of collateral asset", async () => {
                const r = await loadFixture(makeRequireRepayTest);
                expect(r.initialUserCollateralBalance - r.finalUserCollateralBalance).eq(120);
              });
            });
          });
        });
      });
      describe("Bad paths", () => {
        let snapshot0: string;
        beforeEach(async function () {
          snapshot0 = await TimeUtils.snapshot();
        });
        afterEach(async function () {
          await TimeUtils.rollback(snapshot0);
        });

        it("should revert if not keeper", async () => {
          await expect(
            makeRequireRepay({
              collateralAmounts: ["110", "150", "320"],
              borrowAmounts: ["1.1", "1.5", "32"],
              repayAmounts: {amountCollateralNum: "32", amountBorrowNum: "16"},
              indexPoolAdapter: 2,
              healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
              healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},
              amountToReturn1: "32",
              amountToTransfer1: "32",
              amountToReturn2: "0",
              amountToTransfer2: "0",
              initialConverterBalanceBorrowAsset: "0",
              initialUserBalance: "64",
              notKeeper: true
            })
          ).revertedWith("TC-42 keeper only"); // KEEPER_ONLY
        });
        it("should revert if try to make full repay", async () => {
          await expect(
            makeRequireRepay({
              collateralAmounts: ["110", "150", "160"],
              borrowAmounts: ["1.1", "1.5", "80"],
              repayAmounts: {
                amountCollateralNum: "160", // full repay
                amountBorrowNum: "80" // full repay
              },
              indexPoolAdapter: 2,
              healthFactorsBeforeBorrow: {minHealthFactor2: 100, targetHealthFactor2: 200},
              // healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},
              amountToReturn1: "240", // amount is prepared
              amountToTransfer1: "0",  // ...but was not sent at the first call
              amountToReturn2: "0",
              amountToTransfer2: "240", // the amount is sent on the
              initialConverterBalanceBorrowAsset: "0",
              initialUserBalance: "1000",
            })
          ).revertedWith("TC-40 repay to rebalance not allowed"); // REPAY_TO_REBALANCE_NOT_ALLOWED
        });
        it("should revert if try to repay too much", async () => {
          await expect(
            makeRequireRepay({
              collateralAmounts: ["110", "150", "160"],
              borrowAmounts: ["1.1", "1.5", "80"],
              repayAmounts: {
                amountCollateralNum: "1600", // too much
                amountBorrowNum: "800" // too much
              },
              indexPoolAdapter: 2,
              healthFactorsBeforeBorrow: {minHealthFactor2: 100, targetHealthFactor2: 200},
              // healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},
              amountToReturn1: "240", // amount is prepared
              amountToTransfer1: "0",  // ...but was not sent at the first call
              amountToReturn2: "0",
              amountToTransfer2: "240", // the amount is sent on the
              initialConverterBalanceBorrowAsset: "0",
              initialUserBalance: "1000",
            })
          ).revertedWith("TC-40 repay to rebalance not allowed"); // REPAY_TO_REBALANCE_NOT_ALLOWED
        });
        it("should revert if try to require zero amount of borrow asset", async () => {
          await expect(
            makeRequireRepay({
              collateralAmounts: ["110", "150", "320"],
              borrowAmounts: ["1.1", "1.5", "32"],
              repayAmounts: {
                amountCollateralNum: "10",
                amountBorrowNum: "0" // (!) error
              },
              indexPoolAdapter: 2,
              healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
              healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},
              amountToReturn1: "32",
              amountToTransfer1: "32",
              amountToReturn2: "0",
              amountToTransfer2: "0",
              initialConverterBalanceBorrowAsset: "0",
              initialUserBalance: "64" // 32 + 32
            })
          ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
        });
        // todo
        // describe("Result health factor is too big", () => {
        //   it("should NOT revert", async () => {
        //     await tryToRepayWrongAmount(180_000); // no revert for simplicity
        //   });
        // });
        // describe("Result health factor is too small", () => {
        //   it("should NOT revert", async () => {
        //     await tryToRepayWrongAmount(100_000); // no revert because partial rebalance is allowed
        //   });
        // });
        it("should not change balances of the Tetu converter if not zero amount was put on balance", async () => {
          const ret = await makeRequireRepay({
            collateralAmounts: ["110", "150", "320"],
            borrowAmounts: ["1.1", "1.5", "32"],
            repayAmounts: {amountCollateralNum: "32", amountBorrowNum: "16"},
            indexPoolAdapter: 2,
            healthFactorsBeforeBorrow: {minHealthFactor2: 400, targetHealthFactor2: 500},
            healthFactorsBeforeRepay: {minHealthFactor2: 800, targetHealthFactor2: 1000},
            amountToReturn1: "32",
            amountToTransfer1: "32",
            amountToReturn2: "0",
            amountToTransfer2: "0",
            initialUserBalance: "64",
            initialConverterBalanceCollateral: "2000",
            initialConverterBalanceBorrowAsset: "1000",
          })
          expect(ret.finalConverterBalanceCollateral).eq(2000);
          expect(ret.finalConverterBalanceBorrowAsset).eq(1000);
        });
      });
    });
  });

  describe("borrow with mocked swap manager", () => {
    let snapshot0: string;
    beforeEach(async function () {
      snapshot0 = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot0);
    });

//region Test impl
    interface IMakeConversionUsingBorrowingResults {
      init: ISetupResults;
      receiver: string;
      borrowStatus: IBorrowStatus[];
    }

    interface IMakeConversionUsingBorrowingParams {
      zeroReceiver?: boolean;
      incorrectConverterAddress?: string;
      /* Allow to modify collateral amount that is sent to TetuConverter by the borrower. Default is 1e18 */
      transferAmountMultiplier18?: BigNumber;
      /* Don't register pool adapters during initialization. The pool adapters will be registered inside TetuConverter*/
      skipPreregistrationOfPoolAdapters?: boolean;
      usePoolAdapterStub?: boolean;
      setPoolAdaptersStatus?: IPoolAdapterStatus;
      minHealthFactor2?: number;
      skipWhitelistUser?: boolean;
      initialConverterBalanceBorrowAsset?: string;
      initialConverterBalanceCollateral?: string;
    }

    interface IMakeConversionUsingSwap {
      init: ISetupResults;
      receiver: string;
      swapManagerMock: SwapManagerMock;
      conversionResult: IConversionResults;
    }

    interface ISwapManagerMockParams {
      /* By default, converter is equal to the address of the swap-manager */
      converter?: string;
      maxTargetAmount: number;
      apr18: BigNumber;
      targetAmountAfterSwap: number;
      initialConverterBalanceBorrowAsset?: string;
      initialConverterBalanceCollateral?: string;
    }

    /**
     * Test for TetuConverter.borrow() using swap.
     * Both borrow/swap converters are mocks with enabled log.
     *    Don't register pool adapters during initialization.
     *    The pool adapters will be registered inside TetuConverter
     * @param p
     * @param collateralAmountNum
     * @param exactBorrowAmountNum
     */
    async function makeConversionUsingSwap(
      p: ISwapManagerMockParams,
      collateralAmountNum: number,
      exactBorrowAmountNum: number
    ): Promise<IMakeConversionUsingSwap> {
      const receiver = ethers.Wallet.createRandom().address;

      const core = await CoreContracts.build(
        await TetuConverterApp.createController(
          deployer,
          {
            networkId: HARDHAT_NETWORK_ID,
            swapManagerFabric: {
              deploy: async () => (await MocksHelper.createSwapManagerMock(deployer)).address
            }
          }
        )
      );
      const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
        0,
        {
          tetuAppSetupParams: {setupTetuLiquidatorToSwapBorrowToCollateral: true}
        });

      if (p.initialConverterBalanceCollateral) {
        await init.sourceToken.mint(init.core.tc.address, parseUnits(p.initialConverterBalanceCollateral, await init.sourceToken.decimals()));
      }
      if (p.initialConverterBalanceBorrowAsset) {
        await init.targetToken.mint(init.core.tc.address, parseUnits(p.initialConverterBalanceBorrowAsset, await init.targetToken.decimals()));
      }

      // let's replace real swap manager by mocked one
      const swapManagerMock = SwapManagerMock__factory.connect(await core.controller.swapManager(), deployer);
      await swapManagerMock.setupSwap(
        getBigNumberFrom(p.targetAmountAfterSwap, await init.targetToken.decimals())
      );
      await swapManagerMock.setupGetConverter(
        p.converter || swapManagerMock.address,
        getBigNumberFrom(p.maxTargetAmount, await init.targetToken.decimals()),
        p.apr18
      );

      const conversionResult = await callBorrowerBorrow(
        init,
        receiver,
        exactBorrowAmountNum,
        getBigNumberFrom(collateralAmountNum, await init.sourceToken.decimals())
      );

      return {
        init,
        receiver,
        swapManagerMock,
        conversionResult
      }
    }

//endregion Test impl

    describe("Good paths", () => {
      describe("Convert using swapping", () => {
        it("should return expected values", async () => {
          const amountCollateralNum = 100_000;
          const amountToBorrowNum = 100;
          const r = await makeConversionUsingSwap(
            {
              targetAmountAfterSwap: amountToBorrowNum,
              maxTargetAmount: amountToBorrowNum,
              apr18: BigNumber.from(1)
            },
            amountCollateralNum,
            amountToBorrowNum
          );

          const lastSwapInputParams = (await r.swapManagerMock.lastSwapInputParams());
          const ret = [
            // returned borrowed amount
            (await r.swapManagerMock.lastSwapResultTargetAmount()),

            // amount of collateral transferred to swap manager
            await r.init.sourceToken.balanceOf(r.swapManagerMock.address),

            // parameters passed to swap function
            lastSwapInputParams.sourceToken,
            lastSwapInputParams.sourceAmount,
            lastSwapInputParams.targetToken,
            lastSwapInputParams.receiver,
          ].map(x => BalanceUtils.toString(x)).join("\n");

          const expected = [
            getBigNumberFrom(
              amountToBorrowNum,
              await r.init.targetToken.decimals()
            ),
            getBigNumberFrom(amountCollateralNum, await r.init.sourceToken.decimals()),
            r.init.sourceToken.address,
            getBigNumberFrom(amountCollateralNum, await r.init.sourceToken.decimals()),
            r.init.targetToken.address,
            r.receiver
          ].map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Broken converter", () => {
        describe("Incorrect converter to swap (the passed address is not the address of the swap manager)", () => {
          it("should revert", async () => {
            const amountCollateralNum = 100_000;
            const amountToBorrowNum = 100;
            const differentSwapManager = await MocksHelper.createSwapManagerMock(deployer);
            await expect(
              makeConversionUsingSwap(
                {
                  targetAmountAfterSwap: amountToBorrowNum,
                  maxTargetAmount: amountToBorrowNum,
                  apr18: BigNumber.from(1),
                  converter: differentSwapManager.address // (!)
                },
                amountCollateralNum,
                amountToBorrowNum
              )
            ).revertedWith("TC-44 incorrect converter"); // INCORRECT_CONVERTER_TO_SWAP
          });
        });
      });

      describe("Not zero amount was put on balance of TetuConverter", () => {
        it("should make swap and keep the amount untouched", async () => {
          const amountCollateralNum = 100_000;
          const amountToBorrowNum = 100;
          const r = await makeConversionUsingSwap(
            {
              targetAmountAfterSwap: amountToBorrowNum,
              maxTargetAmount: amountToBorrowNum,
              apr18: BigNumber.from(1),
              initialConverterBalanceBorrowAsset: "200000",
              initialConverterBalanceCollateral: "500000",
            },
            amountCollateralNum,
            amountToBorrowNum
          );

          const lastSwapInputParams = (await r.swapManagerMock.lastSwapInputParams());
          const ret = [
            // returned borrowed amount
            (await r.swapManagerMock.lastSwapResultTargetAmount()),

            // amount of collateral transferred to swap manager
            await r.init.sourceToken.balanceOf(r.swapManagerMock.address),

            // parameters passed to swap function
            lastSwapInputParams.sourceToken,
            lastSwapInputParams.sourceAmount,
            lastSwapInputParams.targetToken,
            lastSwapInputParams.receiver,
          ].map(x => BalanceUtils.toString(x)).join("\n");
          const expected = [
            getBigNumberFrom(
              amountToBorrowNum,
              await r.init.targetToken.decimals()
            ),
            getBigNumberFrom(amountCollateralNum, await r.init.sourceToken.decimals()),
            r.init.sourceToken.address,
            getBigNumberFrom(amountCollateralNum, await r.init.sourceToken.decimals()),
            r.init.targetToken.address,
            r.receiver
          ].map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
          expect(+formatUnits(await r.init.targetToken.balanceOf(r.init.core.tc.address), await r.init.targetToken.decimals())).eq(200_000);
          expect(+formatUnits(await r.init.sourceToken.balanceOf(r.init.core.tc.address), await r.init.sourceToken.decimals())).eq(500_000);
        });
      })
    });
  });

  describe("getDebtAmountStored", () => {
    interface IGetDebtAmountCurrentResults {
      // getDebtAmountCurrent
      totalDebtAmountOut: number;
      totalCollateralAmountOut: number;

      // makeBorrow results
      sumDebts: number;
      sumCollaterals: number;
      collateralAmounts: number[];
      expectedSumCollaterals: number;
    }

    interface IGetDebtAmountCurrentParams {
      gapDebtRequired?: boolean;
      useDebtGap?: boolean;
    }

    async function makeGetDebtAmountTest(
      core: CoreContracts,
      collateralAmounts: number[],
      p?: IGetDebtAmountCurrentParams
    ): Promise<IGetDebtAmountCurrentResults> {
      const pr = await prepareTetuAppWithMultipleLendingPlatforms(core, collateralAmounts.length);
      const sourceTokenDecimals = await pr.sourceToken.decimals();
      const borrowTokenDecimals = await pr.targetToken.decimals();
      const borrows: IBorrowStatus[] = await makeBorrow(
        pr,
        collateralAmounts,
        BigNumber.from(100),
        BigNumber.from(100_000),
        {debtGapRequired: p?.gapDebtRequired ?? false}
      );

      const tcAsUc = ITetuConverter__factory.connect(
        pr.core.tc.address,
        await DeployerUtils.startImpersonate(pr.userContract.address)
      );

      const r = (await tcAsUc.getDebtAmountStored(
        await tcAsUc.signer.getAddress(),
        pr.sourceToken.address,
        pr.targetToken.address,
        p?.useDebtGap ?? false
      ));
      return {
        totalDebtAmountOut: +formatUnits(r.totalDebtAmountOut, borrowTokenDecimals),
        totalCollateralAmountOut: +formatUnits(r.totalCollateralAmountOut, sourceTokenDecimals),
        sumDebts: +formatUnits(getSum(borrows.map(x => x.status?.amountToPay || BigNumber.from(0))), borrowTokenDecimals),
        sumCollaterals: +formatUnits(getSum(borrows.map(x => x.status?.collateralAmount || BigNumber.from(0))), sourceTokenDecimals),
        collateralAmounts: borrows.map(x => +formatUnits(x.status?.collateralAmount || BigNumber.from(0), sourceTokenDecimals)),
        expectedSumCollaterals: collateralAmounts.reduce((prev, cur) => prev + cur, 0),
      }
    }

    describe("No opened positions", () => {
      it("should return zero", async () => {
        const core = await loadFixture(buildCoreContracts);
        const r = await makeGetDebtAmountTest(core, []);
        expect(r.totalDebtAmountOut).eq(0);
        expect(r.totalCollateralAmountOut).eq(0);
        expect(r.sumDebts).eq(0);
        expect(r.sumCollaterals).eq(0);
        expect(r.collateralAmounts.join()).eq("");
      });
    });
    describe("Single opened position", () => {
      it("should return expected values for the opened position", async () => {
        const core = await loadFixture(buildCoreContracts);
        const r = await makeGetDebtAmountTest(core, [1000], {gapDebtRequired: false, useDebtGap: false});
        expect(r.totalDebtAmountOut).eq(r.sumDebts);
        expect(r.totalCollateralAmountOut).eq(r.sumCollaterals);
        expect(r.collateralAmounts.join()).eq([1000].join());
      });
    });
    describe("Multiple opened positions", () => {
      describe("No gap debt", () => {
        describe("debt gap is not required", () => {
          it("should return sum of debts of all opened positions", async () => {
            const core = await loadFixture(buildCoreContracts);
            const r = await makeGetDebtAmountTest(core, [1000, 2000, 50], {gapDebtRequired: false, useDebtGap: false});
            expect(r.totalDebtAmountOut).eq(r.sumDebts);
            expect(r.totalCollateralAmountOut).eq(r.sumCollaterals);
            expect(r.collateralAmounts.join()).eq([1000, 2000, 50].join());
          });
        });
        describe("debt gap is required", () => {
          it("should return sum of debts of all opened positions", async () => {
            const core = await loadFixture(buildCoreContracts);
            const r = await makeGetDebtAmountTest(core, [1000, 2000, 50], {gapDebtRequired: false, useDebtGap: true});
            expect(r.totalDebtAmountOut).eq(r.sumDebts);
            expect(r.totalCollateralAmountOut).eq(r.sumCollaterals);
            expect(r.collateralAmounts.join()).eq([1000, 2000, 50].join());
          });
        });
      });
      describe("With debt gap", () => {
        describe("debt gap is not required", () => {
          it("should return sum of debts of all opened positions", async () => {
            const core = await loadFixture(buildCoreContracts);
            const r = await makeGetDebtAmountTest(core, [1000, 2000, 50], {gapDebtRequired: true, useDebtGap: false});
            expect(r.totalDebtAmountOut).eq(r.sumDebts);
            expect(r.totalCollateralAmountOut).eq(r.sumCollaterals);
            expect(r.collateralAmounts.join()).eq([1000, 2000, 50].join());
          });
        });
        describe("debt gap is required", () => {
          it("should return sum of debts of all opened positions with debt gap", async () => {
            const core = await loadFixture(buildCoreContracts);
            const r = await makeGetDebtAmountTest(core, [1000, 2000, 50], {gapDebtRequired: true, useDebtGap: true});
            expect(r.totalDebtAmountOut).eq(r.sumDebts * 1.01); // debt gap is 1%
            expect(r.totalCollateralAmountOut).eq(r.sumCollaterals);
            expect(r.collateralAmounts.join()).eq([1000, 2000, 50].join());
          });
        });
      });
    });
  });

  describe("getDebtAmountCurrent", () => {
    interface IGetDebtAmountCurrentResults {
      // getDebtAmountCurrent
      totalDebtAmountOut: number;
      totalCollateralAmountOut: number;

      // makeBorrow results
      sumDebts: number;
      sumCollaterals: number;
      collateralAmounts: number[];
      expectedSumCollaterals: number;
    }

    interface IGetDebtAmountCurrentParams {
      gapDebtRequired?: boolean;
      useDebtGap?: boolean;
      notWhitelisted?: boolean;
    }

    async function makeGetDebtAmountTest(
      core: CoreContracts,
      collateralAmounts: number[],
      p?: IGetDebtAmountCurrentParams
    ): Promise<IGetDebtAmountCurrentResults> {
      const pr = await prepareTetuAppWithMultipleLendingPlatforms(core, collateralAmounts.length);
      const sourceTokenDecimals = await pr.sourceToken.decimals();
      const borrowTokenDecimals = await pr.targetToken.decimals();
      const borrows: IBorrowStatus[] = await makeBorrow(
        pr,
        collateralAmounts,
        BigNumber.from(100),
        BigNumber.from(100_000),
        {debtGapRequired: p?.gapDebtRequired}
      );

      const tcAsUc = ITetuConverter__factory.connect(
        pr.core.tc.address,
        await DeployerUtils.startImpersonate(pr.userContract.address)
      );
      const tcAsCaller = p?.notWhitelisted
        ? tcAsUc.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
        : tcAsUc;

      const r = (await tcAsCaller.callStatic.getDebtAmountCurrent(
        await tcAsCaller.signer.getAddress(),
        pr.sourceToken.address,
        pr.targetToken.address,
        p?.useDebtGap || false,
      ));

      return {
        totalDebtAmountOut: +formatUnits(r.totalDebtAmountOut, borrowTokenDecimals),
        totalCollateralAmountOut: +formatUnits(r.totalCollateralAmountOut, sourceTokenDecimals),
        sumDebts: +formatUnits(getSum(borrows.map(x => x.status?.amountToPay || BigNumber.from(0))), borrowTokenDecimals),
        sumCollaterals: +formatUnits(getSum(borrows.map(x => x.status?.collateralAmount || BigNumber.from(0))), sourceTokenDecimals),
        collateralAmounts: borrows.map(x => +formatUnits(x.status?.collateralAmount || BigNumber.from(0), sourceTokenDecimals)),
        expectedSumCollaterals: collateralAmounts.reduce((prev, cur) => prev + cur, 0),
      }
    }

    describe("Good paths", () => {
      describe("No opened positions", () => {
        it("should return zero", async () => {
          const core = await loadFixture(buildCoreContracts);
          const r = await makeGetDebtAmountTest(core, []);
          expect(r.totalDebtAmountOut).eq(0);
          expect(r.totalCollateralAmountOut).eq(0);
          expect(r.sumDebts).eq(0);
          expect(r.sumCollaterals).eq(0);
          expect(r.collateralAmounts.join()).eq("");
        });
      });
      describe("Single opened position", () => {
        it("should return expected values for the opened position", async () => {
          const core = await loadFixture(buildCoreContracts);
          const r = await makeGetDebtAmountTest(core, [1000], {gapDebtRequired: false, useDebtGap: false});
          expect(r.totalDebtAmountOut).eq(r.sumDebts);
          expect(r.totalCollateralAmountOut).eq(r.sumCollaterals);
          expect(r.collateralAmounts.join()).eq([1000].join());
        });
      });
      describe("Multiple opened positions", () => {
        describe("No gap debt", () => {
          describe("debt gap is not required", () => {
            it("should return sum of debts of all opened positions", async () => {
              const core = await loadFixture(buildCoreContracts);
              const r = await makeGetDebtAmountTest(core, [1000, 2000, 50], {
                gapDebtRequired: false,
                useDebtGap: false
              });
              expect(r.totalDebtAmountOut).eq(r.sumDebts);
              expect(r.totalCollateralAmountOut).eq(r.sumCollaterals);
              expect(r.collateralAmounts.join()).eq([1000, 2000, 50].join());
            });
          });
          describe("debt gap is required", () => {
            it("should return sum of debts of all opened positions", async () => {
              const core = await loadFixture(buildCoreContracts);
              const r = await makeGetDebtAmountTest(core, [1000, 2000, 50], {gapDebtRequired: false, useDebtGap: true});
              expect(r.totalDebtAmountOut).eq(r.sumDebts);
              expect(r.totalCollateralAmountOut).eq(r.sumCollaterals);
              expect(r.collateralAmounts.join()).eq([1000, 2000, 50].join());
            });
          });
        });
        describe("With debt gap", () => {
          describe("debt gap is not required", () => {
            it("should return sum of debts of all opened positions", async () => {
              const core = await loadFixture(buildCoreContracts);
              const r = await makeGetDebtAmountTest(core, [1000, 2000, 50], {gapDebtRequired: true, useDebtGap: false});
              expect(r.totalDebtAmountOut).eq(r.sumDebts);
              expect(r.totalCollateralAmountOut).eq(r.sumCollaterals);
              expect(r.collateralAmounts.join()).eq([1000, 2000, 50].join());
            });
          });
          describe("debt gap is required", () => {
            it("should return sum of debts of all opened positions with debt gap", async () => {
              const core = await loadFixture(buildCoreContracts);
              const r = await makeGetDebtAmountTest(core, [1000, 2000, 50], {gapDebtRequired: true, useDebtGap: true});
              expect(r.totalDebtAmountOut).eq(r.sumDebts * 1.01); // debt gap is 1%
              expect(r.totalCollateralAmountOut).eq(r.sumCollaterals);
              expect(r.collateralAmounts.join()).eq([1000, 2000, 50].join());
            });
          });
        });
      });
    });
    describe("Bad paths", () => {
      it("should revert if not whitelisted", async () => {
        const core = await loadFixture(buildCoreContracts);
        await expect(
          makeGetDebtAmountTest(core, [], {notWhitelisted: true})
        ).revertedWith("TC-57 whitelist"); // OUT_OF_WHITE_LIST
      });
    })
  });

  describe("claimRewards", () => {
    let core: CoreContracts;
    let snapshotLocal: string;

    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      core = await CoreContracts.build(
        await TetuConverterApp.createController(
          deployer,
          {
            networkId: HARDHAT_NETWORK_ID,
            debtMonitorFabric: {deploy: async () => (await MocksHelper.createDebtMonitorMock(deployer)).address}
          }
        )
      );
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface ISetupClaimRewards {
      receiver: string;
      user: string;
      debtMonitorMock: DebtMonitorMock;
      controller: ConverterController;
      tetuConverter: TetuConverter;
      poolAdapter: PoolAdapterMock;
    }

    async function setupPoolAdapter(controller: ConverterController, user: string): Promise<PoolAdapterMock> {
      const poolAdapter = await MocksHelper.createPoolAdapterMock(deployer);
      await poolAdapter.initialize(
        controller.address,
        ethers.Wallet.createRandom().address, // pool
        user,
        ethers.Wallet.createRandom().address, // collateralAsset
        ethers.Wallet.createRandom().address, // borrowAsset
        ethers.Wallet.createRandom().address, // originConverter
        ethers.Wallet.createRandom().address, // cTokenMock
        getBigNumberFrom(1, 18), // collateralFactor
        getBigNumberFrom(1, 18), // borrowRate
        ethers.Wallet.createRandom().address  // priceOracle
      );
      return poolAdapter;
    }

    async function setupClaimRewards(): Promise<ISetupClaimRewards> {
      const user = ethers.Wallet.createRandom().address;
      const receiver = ethers.Wallet.createRandom().address;

      const poolAdapter = await setupPoolAdapter(core.controller, user);
      return {
        controller: core.controller,
        tetuConverter: core.tc,
        debtMonitorMock: DebtMonitorMock__factory.connect(core.dm.address, deployer),
        receiver,
        user,
        poolAdapter
      }
    }

    describe("Good paths", () => {
      describe("No rewards", () => {
        it("should return empty arrays", async () => {
          const c = await setupClaimRewards();

          const r = await c.tetuConverter.callStatic.claimRewards(c.receiver);
          const ret = [
            r.amountsOut.length,
            r.rewardTokensOut.length
          ].join();
          const expected = [
            0,
            0
          ].join();
          expect(ret).eq(expected);
        });
      });
      describe("One pool adapter has rewards", () => {
        it("should return expected values and increase receiver amount", async () => {
          const rewardToken = (await MocksHelper.createTokens([18]))[0];
          const rewardsAmount = getBigNumberFrom(100, 18);

          const c = await setupClaimRewards();

          await c.debtMonitorMock.setPositionsForUser(c.user, [c.poolAdapter.address]);
          await rewardToken.mint(c.poolAdapter.address, rewardsAmount);
          await c.poolAdapter.setRewards(rewardToken.address, rewardsAmount);

          const tetuConverterAsUser = TetuConverter__factory.connect(
            c.tetuConverter.address,
            await DeployerUtils.startImpersonate(c.user)
          );

          const balanceBefore = await rewardToken.balanceOf(c.receiver);
          const r = await tetuConverterAsUser.callStatic.claimRewards(c.receiver);
          await tetuConverterAsUser.claimRewards(c.receiver);
          const balanceAfter = await rewardToken.balanceOf(c.receiver);

          const ret = [
            r.amountsOut.length,
            r.amountsOut[0],
            r.rewardTokensOut.length,
            r.rewardTokensOut[0],

            balanceBefore,
            balanceAfter
          ].map(x => BalanceUtils.toString(x)).join("\n");
          const expected = [
            1,
            rewardsAmount,
            1,
            rewardToken.address,

            0,
            rewardsAmount
          ].map(x => BalanceUtils.toString(x)).join("\n");
          expect(ret).eq(expected);
        });
      });
      describe("Two pool adapters, only one has rewards", () => {
        it("should claim rewards from two pools", async () => {
          const rewardToken1 = (await MocksHelper.createTokens([18]))[0];
          const rewardsAmount1 = getBigNumberFrom(100, 18);

          const c = await setupClaimRewards();
          const poolAdapter2 = await setupPoolAdapter(c.controller, c.user);

          await c.debtMonitorMock.setPositionsForUser(
            c.user,
            [c.poolAdapter.address, poolAdapter2.address]
          );
          await rewardToken1.mint(c.poolAdapter.address, rewardsAmount1);
          await c.poolAdapter.setRewards(rewardToken1.address, rewardsAmount1);

          const tetuConverterAsUser = TetuConverter__factory.connect(
            c.tetuConverter.address,
            await DeployerUtils.startImpersonate(c.user)
          );

          const balanceBefore1 = await rewardToken1.balanceOf(c.receiver);
          const r = await tetuConverterAsUser.callStatic.claimRewards(c.receiver);
          await tetuConverterAsUser.claimRewards(c.receiver);
          const balanceAfter1 = await rewardToken1.balanceOf(c.receiver);

          const ret = [
            r.amountsOut.length,
            r.amountsOut[0],
            r.rewardTokensOut.length,
            r.rewardTokensOut[0],

            balanceBefore1,
            balanceAfter1,
          ].map(x => BalanceUtils.toString(x)).join("\n");
          const expected = [
            1,
            rewardsAmount1,
            1,
            rewardToken1.address,

            0,
            rewardsAmount1,
          ].map(x => BalanceUtils.toString(x)).join("\n");
          expect(ret).eq(expected);
        });
      });
      describe("Two pool adapters, both have rewards", () => {
        it("should claim rewards from two pools", async () => {
          const rewardToken1 = (await MocksHelper.createTokens([18]))[0];
          const rewardsAmount1 = getBigNumberFrom(100, 18);
          const rewardToken2 = (await MocksHelper.createTokens([15]))[0];
          const rewardsAmount2 = getBigNumberFrom(2222, 15);

          const c = await setupClaimRewards();
          const poolAdapter2 = await setupPoolAdapter(c.controller, c.user);

          await c.debtMonitorMock.setPositionsForUser(
            c.user,
            [c.poolAdapter.address, poolAdapter2.address]
          );
          await rewardToken1.mint(c.poolAdapter.address, rewardsAmount1);
          await c.poolAdapter.setRewards(rewardToken1.address, rewardsAmount1);

          await rewardToken2.mint(poolAdapter2.address, rewardsAmount2);
          await poolAdapter2.setRewards(rewardToken2.address, rewardsAmount2);

          const tetuConverterAsUser = TetuConverter__factory.connect(
            c.tetuConverter.address,
            await DeployerUtils.startImpersonate(c.user)
          );

          const balanceBefore1 = await rewardToken1.balanceOf(c.receiver);
          const balanceBefore2 = await rewardToken2.balanceOf(c.receiver);
          const r = await tetuConverterAsUser.callStatic.claimRewards(c.receiver);
          await tetuConverterAsUser.claimRewards(c.receiver);
          const balanceAfter1 = await rewardToken1.balanceOf(c.receiver);
          const balanceAfter2 = await rewardToken2.balanceOf(c.receiver);

          const ret = [
            r.amountsOut.length,
            r.amountsOut[0],
            r.amountsOut[1],
            r.rewardTokensOut.length,
            r.rewardTokensOut[0],
            r.rewardTokensOut[1],

            balanceBefore1,
            balanceAfter1,

            balanceBefore2,
            balanceAfter2,
          ].map(x => BalanceUtils.toString(x)).join("\n");
          const expected = [
            2,
            rewardsAmount1,
            rewardsAmount2,
            2,
            rewardToken1.address,
            rewardToken2.address,

            0,
            rewardsAmount1,

            0,
            rewardsAmount2
          ].map(x => BalanceUtils.toString(x)).join("\n");
          expect(ret).eq(expected);
        });
      });
    });
  });

  describe("onRequireAmountBySwapManager", () => {
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    async function makeTestOnRequireAmountBySwapManager(
      init: ISetupResults,
      approver: string,
      signer?: string
    ): Promise<{ ret: string, expected: string }> {

      // approver approves source amount to TetuConverter
      const sourceAmount = parseUnits("1", await init.sourceToken.decimals());
      const sourceTokenAsApprover = MockERC20__factory.connect(
        init.sourceToken.address,
        await DeployerUtils.startImpersonate(approver)
      );
      await sourceTokenAsApprover.mint(approver, sourceAmount);
      await sourceTokenAsApprover.approve(init.core.tc.address, sourceAmount);

      // swap manager requires the source amount from TetuConverter
      const tcAsSigner = TetuConverter__factory.connect(
        init.core.tc.address,
        await DeployerUtils.startImpersonate(signer || init.core.swapManager.address)
      );
      const balanceBefore = await sourceTokenAsApprover.balanceOf(init.core.swapManager.address);
      await tcAsSigner.onRequireAmountBySwapManager(approver, init.sourceToken.address, sourceAmount);
      const balanceAfter = await sourceTokenAsApprover.balanceOf(init.core.swapManager.address);

      const ret = formatUnits(balanceAfter.sub(balanceBefore), await init.sourceToken.decimals());
      const expected = formatUnits(sourceAmount, await init.sourceToken.decimals());

      return {ret, expected};
    }

    describe("Good paths", () => {
      describe("The amount is approved by a user contract", () => {
        it("should return expected values", async () => {
          const core = await CoreContracts.build(await TetuConverterApp.createController(deployer, {networkId: HARDHAT_NETWORK_ID,}));
          const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 0);
          const r = await makeTestOnRequireAmountBySwapManager(init, ethers.Wallet.createRandom().address);
          expect(r.ret).eq(r.expected);
        });
      });
      describe("The amount is approved by TetuConverter", () => {
        it("should return expected values", async () => {
          const core = await CoreContracts.build(await TetuConverterApp.createController(deployer, {networkId: HARDHAT_NETWORK_ID,}));
          const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 0);
          const r = await makeTestOnRequireAmountBySwapManager(init, init.core.tc.address);
          expect(r.ret).eq(r.expected);
        });
      });
    });
    describe("Bad paths", () => {
      it("revert if called by not swap manager", async () => {
        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer, {networkId: HARDHAT_NETWORK_ID,}));
        const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 0);
        await expect(
          makeTestOnRequireAmountBySwapManager(init, init.core.tc.address, ethers.Wallet.createRandom().address)
        ).revertedWith("TC-53 swap manager only"); // ONLY_SWAP_MANAGER
      });
    });
  });

//endregion Unit tests
});
