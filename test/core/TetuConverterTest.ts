import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {
  IERC20__factory,
  MockERC20,
  MockERC20__factory,
  TetuConverter,
  Borrower,
  PoolAdapterMock__factory,
  LendingPlatformMock__factory,
  BorrowManager__factory,
  IPoolAdapter__factory,
  PoolAdapterMock,
  ITetuConverter__factory,
  TetuConverter__factory,
  TetuLiquidatorMock__factory,
  SwapManagerMock,
  ConverterUnknownKind,
  DebtMonitorMock,
  Controller,
  PoolAdapterStub__factory,
  IPoolAdapter,
  DebtMonitorMock__factory,
  SwapManagerMock__factory,
  PriceOracleMock__factory, IController__factory
} from "../../typechain";
import {
  IBorrowInputParams,
  BorrowManagerHelper,
  IPoolInstanceInfo,
  IPrepareContractsSetupParams
} from "../baseUT/helpers/BorrowManagerHelper";
import {CoreContracts} from "../baseUT/types/CoreContracts";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BalanceUtils, IContractToInvestigate} from "../baseUT/utils/BalanceUtils";
import {BigNumber, ContractTransaction} from "ethers";
import {Misc} from "../../scripts/utils/Misc";
import {IPoolAdapterStatus} from "../baseUT/types/BorrowRepayDataTypes";
import {getExpectedApr18} from "../baseUT/apr/aprUtils";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {controlGasLimitsEx} from "../../scripts/utils/hardhatUtils";
import {
  GAS_FIND_CONVERSION_STRATEGY_ONLY_BORROW_AVAILABLE,
  GAS_FIND_SWAP_STRATEGY, GAS_TC_BORROW, GAS_TC_QUOTE_REPAY, GAS_TC_REPAY, GAS_TC_SAFE_LIQUIDATE,
} from "../baseUT/GasLimit";
import {ICreateControllerParams, TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";

describe("TetuConverterTest", () => {
//region Constants
  const BLOCKS_PER_DAY = 6456;
//endregion Constants

//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

  beforeEach(async function () {
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
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

  /**
   * Deploy BorrowerMock. Create TetuConverter-app and pre-register all pool adapters (implemented by PoolAdapterMock).
   * @param core
   * @param tt
   * @param tetuAppSetupParams
   * @param usePoolAdapterStub
   *      true: use PoolAdapterStub to implement pool adapters
   *      false: use PoolAdapterMock to implement pool adapters.
   */
  async function prepareContracts(
    core: CoreContracts,
    tt: IBorrowInputParams,
    tetuAppSetupParams?: IPrepareContractsSetupParams,
    usePoolAdapterStub = false
  ) : Promise<IPrepareResults>{
    const periodInBlocks = 117;
    const {sourceToken, targetToken, poolsInfo} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(
      core,
      deployer,
      tt,
      async () => usePoolAdapterStub
        ? (await MocksHelper.createPoolAdapterStub(deployer, parseUnits("0.5"))).address
        : (await MocksHelper.createPoolAdapterMock(deployer)).address,
      tetuAppSetupParams
    );
    const userContract = await MocksHelper.deployBorrower(deployer.address, core.controller, periodInBlocks);
    await core.controller.setWhitelistValues([userContract.address], true);
    const bmAsTc = BorrowManager__factory.connect(core.bm.address,
      await DeployerUtils.startImpersonate(core.tc.address)
    );

    let cToken: string | undefined;
    const poolAdapters: string[] = [];
    for (const pi of poolsInfo) {
      if (! cToken) {
        cToken = pi.asset2cTokens.get(sourceToken.address) || "";
      }

      if (!tetuAppSetupParams?.skipPreregistrationOfPoolAdapters) {
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
    tetuAppSetupParams?: IPrepareContractsSetupParams,
    usePoolAdapterStub = false
  ) : Promise<ISetupResults> {
    const targetDecimals = 6;
    const sourceDecimals = 17;
    const sourceAmountNumber = 100_000_000_000;
    const availableBorrowLiquidityNumber = 100_000_000_000;
    const tt: IBorrowInputParams = {
      collateralFactor: 0.5,
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

    const initialCollateralAmount = getBigNumberFrom(sourceAmountNumber, sourceDecimals);
    const availableBorrowLiquidityPerPool = getBigNumberFrom(availableBorrowLiquidityNumber, targetDecimals);

    const r = await prepareContracts(core, tt, tetuAppSetupParams, usePoolAdapterStub);

    // put a lot of collateral asset on user's balance
    await MockERC20__factory.connect(r.sourceToken.address, deployer).mint(
      r.userContract.address,
      initialCollateralAmount
    );

    // put a lot of borrow assets to pool-stubs
    for (const pi of r.poolInstances) {
      await MockERC20__factory.connect(r.targetToken.address, deployer)
        .mint(pi.pool, availableBorrowLiquidityPerPool);
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
  ) : Promise<IConversionResults> {
    const amountToBorrow = exactBorrowAmount
      ? getBigNumberFrom(exactBorrowAmount, await pp.targetToken.decimals())
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
    params?: IMakeBorrowInputParams
  ) : Promise<IBorrowStatus[]> {
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
        }
      }

      // emulate on-chain call to get borrowedAmountOut
      const borrowResult = await callBorrowerBorrow(
        pp,
        params?.receiver || pp.userContract.address,
        params?.exactBorrowAmounts ? params?.exactBorrowAmounts[i] : undefined,
        collateralAmount,
        {
          badPathParamManualConverter: params?.transferAmountMultiplier18
            ? pp.poolInstances[i].converter
            : params?.badPathParamManualConverter,
          badPathTransferAmountMultiplier18: params?.transferAmountMultiplier18,
          entryData: params?.entryData
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
  interface IFindConversionStrategyMulti {
    converters: string[];
    collateralAmountsOut: BigNumber[];
    amountsToBorrowOut: BigNumber[];
    aprs18: BigNumber[];
  }
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
  ) : Promise<IFindConversionStrategySingle> {
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
  ) : Promise<IFindConversionStrategySingle> {
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

//region findConversionStrategy test impl
  interface IFindConversionStrategyInputParams {
    /** Borrow rate (as num, no decimals); undefined if there is no lending pool */
    borrowRateNum?: number;
    /** Swap manager config; undefined if there is no DEX */
    swapConfig?: IPrepareContractsSetupParams;
    entryData?: string;
    setConverterToPauseState?: boolean;
  }

  interface IFindConversionStrategyBadParams {
    zeroSourceAmount?: boolean;
    zeroPeriod?: boolean;
  }

  interface IMakeFindConversionStrategySwapAndBorrowResults {
    results: IFindConversionStrategySingle;
    expectedSwap: IFindConversionStrategySingle;
    expectedBorrowing: IFindConversionStrategySingle;
  }

  /**
   * Set up test for findConversionStrategy
   */
  async function makeFindConversionStrategy(
    sourceAmountNum: number,
    periodInBlocks: number,
    params?: IFindConversionStrategyInputParams
  ) : Promise<IMakeFindConversionStrategyResults> {
    const core = await CoreContracts.build(
      await TetuConverterApp.createController(deployer, {
        priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
      })
    );
    const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
      params?.borrowRateNum ? 1: 0,
      params?.swapConfig
    );
    if (params?.setConverterToPauseState) {
      await core.controller.connect(
        await DeployerUtils.startImpersonate(await core.controller.governance())
      ) .setPaused(true)
    }

    await PriceOracleMock__factory.connect(await core.controller.priceOracle(), deployer).changePrices(
      [init.sourceToken.address, init.targetToken.address],
      [parseUnits("1"), parseUnits("1")] // prices are set to 1 for simplicity
    );

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

    // source amount must be approved to TetuConverter before calling findConversionStrategy
    const sourceAmount = parseUnits(sourceAmountNum.toString(), await init.sourceToken.decimals());
    const signer = await init.core.tc.signer.getAddress();
    await MockERC20__factory.connect(init.sourceToken.address, init.core.tc.signer).mint(signer, sourceAmount);
    await MockERC20__factory.connect(init.sourceToken.address, init.core.tc.signer).approve(core.tc.address, sourceAmount);

    const results = await init.core.tc.callStatic.findConversionStrategy(
      params?.entryData || "0x",
      init.sourceToken.address,
      sourceAmount,
      init.targetToken.address,
      periodInBlocks
    );
    const tx = await init.core.tc.findConversionStrategy(
      params?.entryData || "0x",
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
    badPathsParams?: IFindConversionStrategyBadParams
  ) : Promise<IMakeFindConversionStrategyResults> {
    return makeFindConversionStrategy(
      badPathsParams?.zeroSourceAmount ? 0 : 1000,
      badPathsParams?.zeroPeriod ? 0 : 100,
      {
        borrowRateNum: useLendingPool ? 1000 : undefined,
        swapConfig: useDexPool
          ? {
            priceImpact: 1_000,
            setupTetuLiquidatorToSwapBorrowToCollateral: true,
          }
          : undefined
      }


    );
  }

  async function makeFindConversionStrategySwapAndBorrow(
    period: number,
    priceImpact: number,
  ) : Promise<IMakeFindConversionStrategySwapAndBorrowResults> {
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
//endregion findConversionStrategy test impl

//region findBorrowStrategies test impl
  interface IMakeFindBorrowStrategyParams {
    borrowRateNum?: number;
    entryData?: string;
    setConverterToPauseState?: boolean;
  }
  /**
   * Set up test for findBorrowStrategies
   */
  async function makeFindBorrowStrategy(
    sourceAmountNum: number,
    periodInBlocks: number,
    params?: IMakeFindBorrowStrategyParams
  ) : Promise<IMakeFindConversionStrategyResults | undefined> {
    const core = await CoreContracts.build(
      await TetuConverterApp.createController(deployer, {
        priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
      })
    );
    const init = await prepareTetuAppWithMultipleLendingPlatforms(core,params?.borrowRateNum ? 1: 0);

    if (params?.setConverterToPauseState) {
      await core.controller.connect(
        await DeployerUtils.startImpersonate(await core.controller.governance())
      ) .setPaused(true)
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

    return  results.converters.length
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
  ) : Promise<IMakeFindConversionStrategyResults | undefined> {
    return makeFindBorrowStrategy(
      badPathsParams?.zeroSourceAmount ? 0 : 1000,
      badPathsParams?.zeroPeriod ? 0 : 100,
      { borrowRateNum: 1000 }
    );
  }
//endregion findBorrowStrategies test impl

//region findSwapStrategy test impl
  /**
   * Set up test for findConversionStrategy
   * @param sourceAmountNum
   * @param swapConfig Swap manager config; undefined if there is no DEX
   */
  async function makeFindSwapStrategy(
    sourceAmountNum: number,
    swapConfig: IPrepareContractsSetupParams,
    setConverterToPauseState?: boolean
  ) : Promise<IMakeFindConversionStrategyResults> {
    const core = await CoreContracts.build(
      await TetuConverterApp.createController(deployer, {
        priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
      })
    );
    const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 0, swapConfig);
    await PriceOracleMock__factory.connect(await core.controller.priceOracle(), deployer).changePrices(
      [init.sourceToken.address, init.targetToken.address],
      [parseUnits("1"), parseUnits("1")] // prices are set to 1 for simplicity
    );

    if (setConverterToPauseState) {
      await core.controller.connect(
        await DeployerUtils.startImpersonate(await core.controller.governance())
      ) .setPaused(true)
    }

    // source amount must be approved to TetuConverter before calling findConversionStrategy
    const sourceAmount = parseUnits(sourceAmountNum.toString(), await init.sourceToken.decimals());
    const signer = await init.core.tc.signer.getAddress();
    await MockERC20__factory.connect(init.sourceToken.address, init.core.tc.signer).mint(signer, sourceAmount);
    await MockERC20__factory.connect(init.sourceToken.address, init.core.tc.signer).approve(core.tc.address, sourceAmount);

    const results = await init.core.tc.callStatic.findSwapStrategy(
      swapConfig.entryData || "0x",
      init.sourceToken.address,
      sourceAmount,
      init.targetToken.address,
    );
    const tx = await init.core.tc.findSwapStrategy(
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
  ) : Promise<IMakeFindConversionStrategyResults> {
    return makeFindSwapStrategy(
      sourceAmount,
      {
          priceImpact,
          setupTetuLiquidatorToSwapBorrowToCollateral: true,
          entryData
        }
    );
  }
//endregion findSwapStrategy test impl

//region Unit tests
  describe("constructor", () => {
    interface IMakeConstructorTestParams {
      useZeroController?: boolean;
      useZeroBorrowManager?: boolean;
      useZeroDebtMonitor?: boolean;
      useZeroSwapManager?: boolean;
      useZeroKeeper?: boolean;
      useZeroPriceOracle?: boolean;
    }
    async function makeConstructorTest(
      params?: IMakeConstructorTestParams
    ) : Promise<TetuConverter> {
      const controller = await TetuConverterApp.createController(
        deployer,
        {
          tetuConverterFabric: (async (c, borrowManager, debtMonitor, swapManager, keeper, priceOracle) => (
              await CoreContractsHelper.createTetuConverter(
                deployer,
                params?.useZeroController ? Misc.ZERO_ADDRESS : c.address,
                params?.useZeroBorrowManager ? Misc.ZERO_ADDRESS : borrowManager,
                params?.useZeroDebtMonitor ? Misc.ZERO_ADDRESS : debtMonitor,
                params?.useZeroSwapManager ? Misc.ZERO_ADDRESS : swapManager,
                params?.useZeroKeeper ? Misc.ZERO_ADDRESS : keeper,
                params?.useZeroPriceOracle ? Misc.ZERO_ADDRESS : priceOracle
              )).address
          ),
          borrowManagerFabric: async () => ethers.Wallet.createRandom().address,
          debtMonitorFabric: async () => ethers.Wallet.createRandom().address,
          keeperFabric: async () => ethers.Wallet.createRandom().address,
          swapManagerFabric: async () => ethers.Wallet.createRandom().address,
          tetuLiquidatorAddress: ethers.Wallet.createRandom().address
        }
      );
      return TetuConverter__factory.connect(await controller.tetuConverter(), deployer);
    }
    describe("Good paths", () => {
      it("should return expected values", async () => {
        // we can call any function of TetuConverter to ensure that it was created correctly
        // let's check it using ADDITIONAL_BORROW_DELTA_DENOMINATOR()
        const tetuConverter = await makeConstructorTest();
        const ret = await tetuConverter.ADDITIONAL_BORROW_DELTA_DENOMINATOR();

        expect(ret.eq(0)).eq(false);
      });
      it("should initialize immutable variables by expected values", async () => {
        // we can call any function of TetuConverter to ensure that it was created correctly
        // let's check it using ADDITIONAL_BORROW_DELTA_DENOMINATOR()
        const tetuConverter = await makeConstructorTest();
        const controller = IController__factory.connect(await tetuConverter.controller(), deployer);
        const ret = [
          await tetuConverter.borrowManager(),
          await tetuConverter.debtMonitor(),
          await tetuConverter.swapManager(),
          await tetuConverter.keeper(),
          await tetuConverter.priceOracle()
        ].join();
        const expected = [
          await controller.borrowManager(),
          await controller.debtMonitor(),
          await controller.swapManager(),
          await controller.keeper(),
          await controller.priceOracle()
        ].join();

        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert if controller is zero", async () => {
        await expect(
          makeConstructorTest({useZeroController: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert if borrowManager is zero", async () => {
        await expect(
          makeConstructorTest({useZeroBorrowManager: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert if debtMonitor is zero", async () => {
        await expect(
          makeConstructorTest({useZeroDebtMonitor: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert if swapManager is zero", async () => {
        await expect(
          makeConstructorTest({useZeroSwapManager: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert if keeper is zero", async () => {
        await expect(
          makeConstructorTest({useZeroKeeper: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert if priceOracle is zero", async () => {
        await expect(
          makeConstructorTest({useZeroPriceOracle: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
    });
  });

  describe("findConversionStrategy", () => {
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
            controlGasLimitsEx(r.gas, GAS_FIND_CONVERSION_STRATEGY_ONLY_BORROW_AVAILABLE, (u, t) => {
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
        describe("Both borrowing and swap are available", () => {
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
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should return expected values", async () => {
        const {gas} = await makeFindConversionStrategy(
          100_000,
          BLOCKS_PER_DAY * 31,
          {borrowRateNum: 1000},
        );
        controlGasLimitsEx(gas, GAS_FIND_CONVERSION_STRATEGY_ONLY_BORROW_AVAILABLE, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("findBorrowStrategies", () => {
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
            makeFindBorrowStrategyTest({ zeroSourceAmount: true })
          ).revertedWith("TC-43 zero amount"); // ZERO_AMOUNT
        });
      });
      describe("Period is 0", () => {
        it("should revert", async () => {
          await expect(
            makeFindBorrowStrategyTest({ zeroPeriod: true})
          ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
        });
      });
    });
  });

  describe("findSwapStrategy", () => {
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
            true // setConverterToPauseState
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
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should return expected values", async () => {
        const r = await makeFindSwapStrategyTest();
        controlGasLimitsEx(r.gas, GAS_FIND_SWAP_STRATEGY, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("borrow", () => {
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
    }

    /**
     * Test for TetuConverter.borrow() using borrowing.
     * Both borrow converters are mocks with enabled log.
     */
    async function makeConversionUsingBorrowing (
      collateralAmounts: number[],
      exactBorrowAmounts: number[] | undefined,
      params?: IMakeConversionUsingBorrowingParams
    ) : Promise<IMakeConversionUsingBorrowingResults > {
      const receiver = params?.zeroReceiver
        ? Misc.ZERO_ADDRESS
        : ethers.Wallet.createRandom().address;

      const core = await CoreContracts.build(await TetuConverterApp.createController(
        deployer,
        {
          minHealthFactor2: params?.minHealthFactor2
        }
      ));
      const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
        collateralAmounts.length,
        {
          skipPreregistrationOfPoolAdapters: params?.skipPreregistrationOfPoolAdapters
        },
        params?.usePoolAdapterStub
      );

      if (params?.setPoolAdaptersStatus && params?.usePoolAdapterStub) {
        for (const poolAdapter of init.poolAdapters) {
          await PoolAdapterStub__factory.connect(poolAdapter, deployer).setManualStatus(
            params?.setPoolAdaptersStatus.collateralAmount,
            params?.setPoolAdaptersStatus.amountToPay,
            params?.setPoolAdaptersStatus.healthFactor18,
            params?.setPoolAdaptersStatus.opened,
            params?.setPoolAdaptersStatus.collateralAmountLiquidated
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
          badPathParamManualConverter: params?.incorrectConverterAddress,
          transferAmountMultiplier18: params?.transferAmountMultiplier18
        }
      );

      return {
        init,
        receiver,
        borrowStatus,
      }
    }

    /**
     * Test for TetuConverter.borrow() using swap.
     * Both borrow/swap converters are mocks with enabled log.
     *    Don't register pool adapters during initialization.
     *    The pool adapters will be registered inside TetuConverter
     * @param swapManagerMockParams
     * @param collateralAmountNum
     * @param exactBorrowAmountNum
     */
    async function makeConversionUsingSwap (
      swapManagerMockParams: ISwapManagerMockParams,
      collateralAmountNum: number,
      exactBorrowAmountNum: number
    ) : Promise<IMakeConversionUsingSwap > {
      const receiver = ethers.Wallet.createRandom().address;

      const core = await CoreContracts.build(
        await TetuConverterApp.createController(
          deployer,
          {
            swapManagerFabric: async () => (await MocksHelper.createSwapManagerMock(deployer)).address
          }
        )
      );
      const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
        0,
        {
          setupTetuLiquidatorToSwapBorrowToCollateral: true
        }
      );
      // let's replace real swap manager by mocked one
      const swapManagerMock = SwapManagerMock__factory.connect(await core.controller.swapManager(), deployer);
      await swapManagerMock.setupSwap(
        getBigNumberFrom(swapManagerMockParams.targetAmountAfterSwap, await init.targetToken.decimals())
      );
      await swapManagerMock.setupGetConverter(
        swapManagerMockParams.converter || swapManagerMock.address,
        getBigNumberFrom(swapManagerMockParams.maxTargetAmount, await init.targetToken.decimals()),
        swapManagerMockParams.apr18
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
            const r = await makeConversionUsingBorrowing (
              [100_000],
              [100],
              { skipPreregistrationOfPoolAdapters: true }
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
                    opened: true
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
              const expected = [false, true, true].join();
              expect(ret).eq(expected);
            });
          });
          describe("Pool adapter is unhealthy (rebalancing is missed)", () => {
            it("should register and use new pool adapter", async () => {
              await expect(
                  makeConversionUsingBorrowing(
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
                      opened: true
                    }
                  }
                )
              ).revertedWith("TC-46 rebalancing is required"); // REBALANCING_IS_REQUIRED
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
                    opened: true
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
              const expected = [false, false, true, true].join();
              expect(ret).eq(expected);
            });
          });
        });
      });
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
            ).revertedWith("TC-35: UNKNOWN CONVERSION"); // UNSUPPORTED_CONVERSION_KIND
          });
        });
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
      describe("Receiver is null", () => {
        it("should revert", async () => {
          await expect(
            makeConversionUsingBorrowing (
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
            makeConversionUsingBorrowing (
              [100_000],
              [0], // (!)
            )
          ).revertedWith("TC-43 zero amount"); // ZERO_AMOUNT
        });
      });
      describe("Collateral amount is 0", () => {
        it("should revert", async () => {
          await expect(
            makeConversionUsingBorrowing (
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
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas threshold", async () => {
        const receiver = ethers.Wallet.createRandom().address;

        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
        const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1,
          {
            skipPreregistrationOfPoolAdapters: true
          }
        );

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
          receiver
        );

        controlGasLimitsEx(gasUsed, GAS_TC_BORROW, (u, t) => {
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
      ) : Promise<IMakeConversionUsingBorrowingResults > {
        const receiver = ethers.Wallet.createRandom().address;

        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
        const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
          collateralAmounts.length,
          {
            setupTetuLiquidatorToSwapBorrowToCollateral
          }
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

              const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
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
    interface IRepayBadPathParams {
      receiverIsNull?: boolean,
      userSendsNotEnoughAmountToTetuConverter?: boolean
    }
    interface IRepayOutputValues {
      collateralAmountOut: BigNumber;
      returnedBorrowAmountOut: BigNumber;
      swappedLeftoverCollateralOut: BigNumber;
      swappedLeftoverBorrowOut: BigNumber;
    }
    interface IRepayResults {
      countOpenedPositions: number;
      totalDebtAmountOut: BigNumber;
      totalCollateralAmountOut: BigNumber;
      init: ISetupResults;
      receiverCollateralBalanceBeforeRepay: BigNumber;
      receiverCollateralBalanceAfterRepay: BigNumber;
      receiverBorrowAssetBalanceBeforeRepay: BigNumber;
      receiverBorrowAssetBalanceAfterRepay: BigNumber;
      repayOutput: IRepayOutputValues;
    }
    async function makeRepayTest(
      collateralAmounts: number[],
      exactBorrowAmounts: number[],
      amountToRepayNum: number,
      setupTetuLiquidatorToSwapBorrowToCollateral = false,
      repayBadPathParams?: IRepayBadPathParams,
      priceImpact?: number,
    ) : Promise<IRepayResults> {
      const core = await CoreContracts.build(
        await TetuConverterApp.createController(deployer, {
          priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
        })
      );
      const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
        collateralAmounts.length,
        {
          setupTetuLiquidatorToSwapBorrowToCollateral,
          priceImpact
        }
      );
      await PriceOracleMock__factory.connect(await core.controller.priceOracle(), deployer).changePrices(
        [init.sourceToken.address, init.targetToken.address],
        [parseUnits("1"), parseUnits("1")] // prices are set to 1 for simplicity
      );
      const targetTokenDecimals = await init.targetToken.decimals();

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

      const amountToRepay = await getBigNumberFrom(amountToRepayNum, targetTokenDecimals);
      const amountToSendToTetuConverter = repayBadPathParams?.userSendsNotEnoughAmountToTetuConverter
        ? amountToRepay.div(2)
        : amountToRepay;
      await init.targetToken.mint(tcAsUc.address, amountToSendToTetuConverter);

      const receiver = repayBadPathParams?.receiverIsNull
        ? Misc.ZERO_ADDRESS
        : init.userContract.address;

      const receiverCollateralBalanceBeforeRepay = receiver === Misc.ZERO_ADDRESS
        ? BigNumber.from(0)
        : await init.sourceToken.balanceOf(receiver);
      const receiverBorrowAssetBalanceBeforeRepay = receiver === Misc.ZERO_ADDRESS
        ? BigNumber.from(0)
        : await init.targetToken.balanceOf(receiver);

      const repayOutput = await tcAsUc.callStatic.repay(
        init.sourceToken.address,
        init.targetToken.address,
        amountToRepay,
        receiver
      );
      await tcAsUc.repay(
        init.sourceToken.address,
        init.targetToken.address,
        amountToRepay,
        receiver
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
        init.targetToken.address
      );

      return {
        countOpenedPositions: borrowsAfterRepay.length,
        totalDebtAmountOut,
        totalCollateralAmountOut,
        init,
        receiverCollateralBalanceAfterRepay,
        receiverCollateralBalanceBeforeRepay,
        receiverBorrowAssetBalanceBeforeRepay,
        receiverBorrowAssetBalanceAfterRepay,
        repayOutput
      }
    }

    describe("Good paths", () => {
      describe("Single borrow", () => {
        describe("Partial repay", () => {
          it("should return expected values", async () => {
            const amountToRepay = 70;
            const exactBorrowAmount = 120;
            const r = await makeRepayTest(
              [1_000_000],
              [exactBorrowAmount],
              amountToRepay
            );

            const ret = [
              r.countOpenedPositions,
              r.totalDebtAmountOut
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              1,
              getBigNumberFrom(exactBorrowAmount - amountToRepay, await r.init.targetToken.decimals())
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Full repay", () => {
          it("should return expected values", async () => {
            const exactBorrowAmount = 120;
            const amountToRepay = exactBorrowAmount;
            const r = await makeRepayTest(
              [1_000_000],
              [exactBorrowAmount],
              amountToRepay
            );

            const ret = [
              r.countOpenedPositions,
              r.totalDebtAmountOut
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              0,
              getBigNumberFrom(exactBorrowAmount - amountToRepay, await r.init.targetToken.decimals())
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Pure swap", () => {
          describe("Collateral and borrow prices are equal", () => {
            it("should return expected values", async () => {
              const amountToRepay = 70;
              const r = await makeRepayTest(
                [],
                [],
                amountToRepay,
                true
              );
              const expectedCollateralAmountToReceive = getBigNumberFrom(
                amountToRepay, // the prices are equal
                await r.init.sourceToken.decimals()
              );

              const ret = [
                r.countOpenedPositions,
                r.totalDebtAmountOut.toString(),
                r.receiverCollateralBalanceAfterRepay.sub(r.receiverCollateralBalanceBeforeRepay).toString(),
              ].join();

              const expected = [
                0,
                0,
                expectedCollateralAmountToReceive.toString()
              ].join();

              expect(ret).eq(expected);
            });
            describe("SwapManager wap doesn't have a conversion way", () => {
              it("should return unswapped borrow asset back to receiver", async () => {
                const exactBorrowAmount = 120;
                const amountToSwap = 100;
                const amountToRepay = exactBorrowAmount + amountToSwap;
                const r = await makeRepayTest(
                  [1_000_000],
                  [exactBorrowAmount],
                  amountToRepay,
                  false // swapManager doesn't have a conversion way
                );

                const ret = [
                  r.countOpenedPositions,
                  r.totalDebtAmountOut,
                  r.receiverBorrowAssetBalanceAfterRepay.sub(r.receiverBorrowAssetBalanceBeforeRepay)
                ].map(x => BalanceUtils.toString(x)).join("\n");

                const expected = [
                  0,
                  0,
                  getBigNumberFrom(amountToSwap, await r.init.targetToken.decimals()),
                ].map(x => BalanceUtils.toString(x)).join("\n");

                expect(ret).eq(expected);
              });
            });
          });
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

            const amountToRepay = exactBorrowAmount + amountBorrowAssetToSwap;
            const r = await makeRepayTest(
              [initialCollateralAmount],
              [exactBorrowAmount],
              amountToRepay,
              true,
              undefined,
              priceImpact
            );

            // the prices of borrow and collateral assets are equal
            const expectedCollateralAmountFromSwapping = amountBorrowAssetToSwap
              * (PRICE_IMPACT_NUMERATOR - priceImpact) / PRICE_IMPACT_NUMERATOR;

            const expectedCollateralAmountToReceive = getBigNumberFrom(
              initialCollateralAmount + expectedCollateralAmountFromSwapping,
              await r.init.sourceToken.decimals()
            );

            const ret = [
              r.countOpenedPositions,
              r.totalDebtAmountOut,
              r.receiverCollateralBalanceAfterRepay.sub(r.receiverCollateralBalanceBeforeRepay),
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              0,
              0,
              expectedCollateralAmountToReceive.toString()
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });

        });
      });
      describe("Multiple borrows", () => {
        describe("Partial repay of single pool adapter", () => {
          it("should return expected values", async () => {
            const amountToRepay = 100;
            const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
            const exactBorrowAmounts = [200, 400, 1000]; // sum == 1600
            const r = await makeRepayTest(
              collateralAmounts,
              exactBorrowAmounts,
              amountToRepay
            );

            const ret = [
              r.countOpenedPositions,
              r.totalDebtAmountOut
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              3,
              getBigNumberFrom(1600-100, await r.init.targetToken.decimals())
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Partial repay, full repay of first pool adapter", () => {
          it("should return expected values", async () => {
            const amountToRepay = 200;
            const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
            const exactBorrowAmounts = [200, 400, 1000]; // sum == 1600
            const r = await makeRepayTest(
              collateralAmounts,
              exactBorrowAmounts,
              amountToRepay
            );

            const ret = [
              r.countOpenedPositions,
              r.totalDebtAmountOut
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              2,
              getBigNumberFrom(1600-200, await r.init.targetToken.decimals())
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Partial repay, two pool adapters", () => {
          it("should return expected values", async () => {
            const amountToRepay = 600;
            const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
            const exactBorrowAmounts = [200, 400, 1000]; // sum == 1600
            const r = await makeRepayTest(
              collateralAmounts,
              exactBorrowAmounts,
              amountToRepay
            );

            const ret = [
              r.countOpenedPositions,
              r.totalDebtAmountOut
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              1,
              getBigNumberFrom(1600-600, await r.init.targetToken.decimals())
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Partial repay, all pool adapters", () => {
          it("should return expected values", async () => {
            const amountToRepay = 1500;
            const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
            const exactBorrowAmounts = [200, 400, 1000]; // sum == 1600
            const r = await makeRepayTest(
              collateralAmounts,
              exactBorrowAmounts,
              amountToRepay
            );

            const ret = [
              r.countOpenedPositions,
              r.totalDebtAmountOut
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              1,
              getBigNumberFrom(1600-1500, await r.init.targetToken.decimals())
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Full repay, no swap", () => {
          it("should return expected values", async () => {
            const amountToRepay = 1600;
            const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
            const exactBorrowAmounts = [200, 400, 1000]; // sum == 1600
            const totalCollateralAmount = collateralAmounts.reduce((prev, cur) => prev + cur, 0);
            const r = await makeRepayTest(
              collateralAmounts,
              exactBorrowAmounts,
              amountToRepay
            );

            const ret = [
              r.countOpenedPositions,
              r.totalDebtAmountOut.toString(),

              r.repayOutput.collateralAmountOut,
              r.repayOutput.returnedBorrowAmountOut,
              r.repayOutput.swappedLeftoverCollateralOut,
              r.repayOutput.swappedLeftoverBorrowOut
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              0,
              getBigNumberFrom(0, await r.init.targetToken.decimals()),

              parseUnits(totalCollateralAmount.toString(), await r.init.sourceToken.decimals()),
              0, // there is no leftover
              0,
              0
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Full repay with swap", () => {
          it("should return expected values", async () => {
            const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
            const exactBorrowAmounts = [200, 400, 1000];
            const totalBorrowAmount = exactBorrowAmounts.reduce((prev, cur) => prev + cur, 0);
            const totalCollateralAmount = collateralAmounts.reduce((prev, cur) => prev + cur, 0);
            const amountToSwap = 300;
            const amountToRepay = totalBorrowAmount + amountToSwap;

            // We need to set big price impact
            // TetuConverter should prefer to use borrowing instead swapping
            const PRICE_IMPACT_NUMERATOR = 100_000; // SwapManager.PRICE_IMPACT_NUMERATOR
            const priceImpact = PRICE_IMPACT_NUMERATOR / 100; // 1%

            const r = await makeRepayTest(
              collateralAmounts,
              exactBorrowAmounts,
              amountToRepay,
              true,
              undefined,
              priceImpact
            );

            const ret = [
              r.countOpenedPositions,
              r.totalDebtAmountOut.toString(),
              r.receiverCollateralBalanceAfterRepay.sub(r.receiverCollateralBalanceBeforeRepay),
              r.receiverBorrowAssetBalanceAfterRepay.sub(r.receiverBorrowAssetBalanceBeforeRepay)
            ].map(x => BalanceUtils.toString(x)).join("\n");

            // the prices of borrow and collateral assets are equal
            const expectedCollateralAmountFromSwapping = amountToSwap
              * (PRICE_IMPACT_NUMERATOR - priceImpact) / PRICE_IMPACT_NUMERATOR;

            const expectedCollateralAmountToReceive = getBigNumberFrom(
              totalCollateralAmount + expectedCollateralAmountFromSwapping,
              await r.init.sourceToken.decimals()
            );

            const expected = [
              0,
              getBigNumberFrom(0, await r.init.targetToken.decimals()),
              expectedCollateralAmountToReceive,
              0
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
          it("should return expected output values", async () => {
            const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
            const exactBorrowAmounts = [200, 400, 1000];
            const totalBorrowAmount = exactBorrowAmounts.reduce((prev, cur) => prev + cur, 0);
            const totalCollateralAmount = collateralAmounts.reduce((prev, cur) => prev + cur, 0);
            const amountToSwap = 300;
            const amountToRepay = totalBorrowAmount + amountToSwap;

            // We need to set big price impact
            // TetuConverter should prefer to use borrowing instead swapping
            const PRICE_IMPACT_NUMERATOR = 100_000; // SwapManager.PRICE_IMPACT_NUMERATOR
            const priceImpact = PRICE_IMPACT_NUMERATOR / 100; // 1%

            const r = await makeRepayTest(
              collateralAmounts,
              exactBorrowAmounts,
              amountToRepay,
              true,
              undefined,
              priceImpact
            );
            console.log(r);

            const ret = [
              r.repayOutput.collateralAmountOut,
              r.repayOutput.returnedBorrowAmountOut,
              r.repayOutput.swappedLeftoverCollateralOut,
              r.repayOutput.swappedLeftoverBorrowOut
            ].map(x => BalanceUtils.toString(x)).join("\n");

            // the prices of borrow and collateral assets are equal
            const expectedCollateralAmountFromSwapping = amountToSwap * (PRICE_IMPACT_NUMERATOR - priceImpact) / PRICE_IMPACT_NUMERATOR;
            const expectedCollateralAmountToReceive = totalCollateralAmount + expectedCollateralAmountFromSwapping;

            const expected = [
              parseUnits(expectedCollateralAmountToReceive.toString(), await r.init.sourceToken.decimals()),
              0, // there is no not-swapped leftover
              parseUnits(expectedCollateralAmountFromSwapping.toString(), await r.init.sourceToken.decimals()),
              parseUnits(amountToSwap.toString(), await r.init.targetToken.decimals()),
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
      });
    });
    describe("Bad paths", () => {
      describe("Receiver is null", () => {
        it("should revert", async () => {
          const exactBorrowAmount = 120;
          const amountToRepay = exactBorrowAmount + 1; // (!)
          await expect(
            makeRepayTest(
              [1_000_000],
              [exactBorrowAmount],
              amountToRepay,
              false,
              { receiverIsNull: true }
            )
          ).revertedWith("TC-1 zero address");
        });
      });
      describe("Send incorrect amount-to-repay to TetuConverter", () => {
        it("should revert", async () => {
          const exactBorrowAmount = 120;
          const amountToRepay = exactBorrowAmount + 1; // (!)
          await expect(
            makeRepayTest(
              [1_000_000],
              [exactBorrowAmount],
              amountToRepay,
              false,
              { userSendsNotEnoughAmountToTetuConverter: true }
            )
          ).revertedWith("TC-41 wrong amount received"); // WRONG_AMOUNT_RECEIVED
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas threshold", async () => {
        const receiver = ethers.Wallet.createRandom().address;

        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
        const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1,
          {
            skipPreregistrationOfPoolAdapters: true
          }
        );

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
          receiver
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
          receiver
        );

        controlGasLimitsEx(gasUsed, GAS_TC_REPAY, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("requireRepay", () => {

    interface IRequireRepayBadPathParams {
      notKeeper?: boolean;
      sendIncorrectAmountToTetuConverter?: boolean;
      wrongResultHealthFactor?: boolean;
    }
    interface IHealthFactorParams {
      minHealthFactor2: number;
      targetHealthFactor2: number;
      maxHealthFactor2: number;
    }
    interface IRequireRepayResults {
      openedPositions: string[];
      totalDebtAmountOut: BigNumber;
      totalCollateralAmountOut: BigNumber;
      init: ISetupResults;
      poolAdapterStatusBefore: IPoolAdapterStatus;
      poolAdapterStatusAfter: IPoolAdapterStatus;
    }
    interface IRepayAmounts {
      useCollateral: boolean,
      amountCollateralNum: number,
      amountBorrowNum: number,
    }

    async function setupBorrowerRequireAmountBackBehavior(
      init: ISetupResults,
      amountToRepayCollateralAsset: BigNumber,
      repayBadPathParams?: IRequireRepayBadPathParams,
    ) {
      const divider = repayBadPathParams?.sendIncorrectAmountToTetuConverter ? 2 : 1;
      const amountUserSendsToTetuConverter = amountToRepayCollateralAsset.div(divider);
      await init.sourceToken.mint(init.userContract.address, amountUserSendsToTetuConverter);
      await init.userContract.setUpRequireAmountBack(amountUserSendsToTetuConverter);
    }

    async function makeRequireRepay(
      collateralAmounts: number[],
      exactBorrowAmounts: number[],
      repayAmounts: IRepayAmounts,
      indexPoolAdapter: number,
      repayBadPathParams?: IRequireRepayBadPathParams,
      healthFactorsBeforeBorrow?: IHealthFactorParams,
      healthFactorsBeforeRepay?: IHealthFactorParams,
    ) : Promise<IRequireRepayResults> {
      const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
      const init = await prepareTetuAppWithMultipleLendingPlatforms(core, collateralAmounts.length);
      const targetTokenDecimals = await init.targetToken.decimals();
      const sourceTokenDecimals = await init.sourceToken.decimals();

      if (healthFactorsBeforeBorrow) {
        await init.core.controller.setMaxHealthFactor2(healthFactorsBeforeBorrow.maxHealthFactor2);
        await init.core.controller.setTargetHealthFactor2(healthFactorsBeforeBorrow.targetHealthFactor2);
        await init.core.controller.setMinHealthFactor2(healthFactorsBeforeBorrow.minHealthFactor2);
      }

      // make borrows
      await makeBorrow(
        init,
        collateralAmounts,
        BigNumber.from(100),
        BigNumber.from(100_000),
        {
          exactBorrowAmounts
        }
      );

      if (healthFactorsBeforeRepay) {
        await init.core.controller.setMaxHealthFactor2(healthFactorsBeforeRepay.maxHealthFactor2);
        await init.core.controller.setTargetHealthFactor2(healthFactorsBeforeRepay.targetHealthFactor2);
        await init.core.controller.setMinHealthFactor2(healthFactorsBeforeRepay.minHealthFactor2);
      }

      // assume, the keeper detects problem health factor in the given pool adapter
      const tcAsKeeper = repayBadPathParams?.notKeeper
        ? init.core.tc
        : TetuConverter__factory.connect(
            init.core.tc.address,
            await DeployerUtils.startImpersonate(await init.core.controller.keeper())
        );
      const poolAdapter = init.poolAdapters[indexPoolAdapter];
      const paAsUc = IPoolAdapter__factory.connect(
        poolAdapter,
        await DeployerUtils.startImpersonate(init.userContract.address)
      );

      // ... so we need to claim soma borrow amount back from user contract
      // put the amount on user contract and require repay
      const amountToRepayCollateralAsset = await getBigNumberFrom(repayAmounts.amountCollateralNum, sourceTokenDecimals);
      const amountToRepayBorrowAsset = await getBigNumberFrom(repayAmounts.amountBorrowNum, targetTokenDecimals);

      await setupBorrowerRequireAmountBackBehavior(init, amountToRepayCollateralAsset, repayBadPathParams);

      const poolAdapterStatusBefore: IPoolAdapterStatus = await paAsUc.getStatus();
      console.log("poolAdapterStatusBefore", poolAdapterStatusBefore);
      await tcAsKeeper.requireRepay(
        amountToRepayBorrowAsset,
        amountToRepayCollateralAsset,
        poolAdapter
      );

      const tcAsUc = ITetuConverter__factory.connect(
        init.core.tc.address,
        await DeployerUtils.startImpersonate(init.userContract.address)
      );

      const poolAdapterStatusAfter: IPoolAdapterStatus = await paAsUc.getStatus();
      console.log("poolAdapterStatusAfter", poolAdapterStatusAfter);

      const openedPositions = await core.dm.getPositions(init.userContract.address, init.sourceToken.address, init.targetToken.address);
      const {
        totalDebtAmountOut,
        totalCollateralAmountOut
      } = await tcAsUc.getDebtAmountStored(
        await tcAsUc.signer.getAddress(),
        init.sourceToken.address,
        init.targetToken.address
      );

      return {
        openedPositions,
        totalDebtAmountOut,
        totalCollateralAmountOut,
        init,
        poolAdapterStatusBefore,
        poolAdapterStatusAfter
      }
    }

    describe("Good paths", () => {
      async function makeRequireRepayTest(
        payUsingCollateral: boolean
      ) : Promise<{ret: string, expected: string}> {
        const minHealthFactor2 = 400;
        const targetHealthFactor2 = 500;
        const maxHealthFactor2 = 1000;
        const healthFactorMultiplier = 2;
        const collateralFactor = 0.5; // it's set inside makeRequireRepay...

        const selectedPoolAdapterCollateral = 2_000_000;
        const selectedPoolAdapterBorrow = selectedPoolAdapterCollateral
          * collateralFactor
          / targetHealthFactor2
          * 100; // 2_000_000 * 0.5 / 5 = 200_000;
        const collateralAmounts = [1_000_000, 1_500_000, selectedPoolAdapterCollateral];
        const exactBorrowAmounts = [100, 200, selectedPoolAdapterBorrow];
        const poolAdapterIndex = 2;

        // requiredAmountBorrowAsset = BorrowAmount * (HealthFactorCurrent/HealthFactorTarget - 1)
        const amountToRepayBorrowNum = -selectedPoolAdapterBorrow * (1/healthFactorMultiplier - 1);

        // requiredAmountCollateralAsset = CollateralAmount * (HealthFactorTarget/HealthFactorCurrent - 1)
        const amountToRepayCollateralNum = selectedPoolAdapterCollateral * (healthFactorMultiplier - 1);

        const exactBorrowAmountsSum = exactBorrowAmounts.reduce((prev, cur) => prev + cur, 0);
        const exactCollateralAmountsSum = collateralAmounts.reduce((prev, cur) => prev + cur, 0);

        const r = await makeRequireRepay(
          collateralAmounts,
          exactBorrowAmounts,
          {
            useCollateral: payUsingCollateral,
            amountCollateralNum: amountToRepayCollateralNum,
            amountBorrowNum: amountToRepayBorrowNum
          },
          poolAdapterIndex,
          undefined,
          {
            minHealthFactor2,
            maxHealthFactor2,
            targetHealthFactor2
          },
          {
            minHealthFactor2: minHealthFactor2 * healthFactorMultiplier,
            maxHealthFactor2: maxHealthFactor2 * healthFactorMultiplier,
            targetHealthFactor2: targetHealthFactor2 * healthFactorMultiplier
          }
        );
        console.log(r);
        const targetDecimals = await r.init.targetToken.decimals();
        const sourceDecimals = await r.init.sourceToken.decimals();

        const expectedPaidAmountToRepayBorrowNum = payUsingCollateral
          ? 0
          : amountToRepayBorrowNum;

        const expectedPaidAmountToRepayCollateralNum = payUsingCollateral
          ? amountToRepayCollateralNum
          : 0;

        const ret = [
          r.openedPositions.length,
          r.totalDebtAmountOut,
          r.totalCollateralAmountOut,

          r.poolAdapterStatusBefore.amountToPay,
          r.poolAdapterStatusBefore.collateralAmount,
          r.poolAdapterStatusBefore.opened,

          r.poolAdapterStatusAfter.amountToPay,
          r.poolAdapterStatusAfter.collateralAmount,
          r.poolAdapterStatusAfter.opened,
        ].map(x => BalanceUtils.toString(x)).join("\n");

        const expected = [
          3,
          getBigNumberFrom(exactBorrowAmountsSum - expectedPaidAmountToRepayBorrowNum, targetDecimals),
          getBigNumberFrom(exactCollateralAmountsSum + expectedPaidAmountToRepayCollateralNum, sourceDecimals),

          getBigNumberFrom(selectedPoolAdapterBorrow, targetDecimals),
          getBigNumberFrom(selectedPoolAdapterCollateral, sourceDecimals),
          true,

          getBigNumberFrom(selectedPoolAdapterBorrow - expectedPaidAmountToRepayBorrowNum, targetDecimals),
          getBigNumberFrom(selectedPoolAdapterCollateral + expectedPaidAmountToRepayCollateralNum, sourceDecimals),
          true,
        ].map(x => BalanceUtils.toString(x)).join("\n");
        return {ret, expected};
      }
      describe("Repay using collateral asset", () => {
        it("should return expected values", async () => {
          const r = await makeRequireRepayTest(true);
          expect(r.ret).eq(r.expected);
        });
      });
      describe("Repay using borrow asset", () => {
        it("should return expected values", async () => {
          const r = await makeRequireRepayTest(false);
          expect(r.ret).eq(r.expected);
        });
      });
      describe("Repay with zero collateral repay-amount", () => {
        it("should call DebtMonitor.closeLiquidatedPosition", async () => {
          const core = await CoreContracts.build(
            await TetuConverterApp.createController(
              deployer,
              {
                debtMonitorFabric: async () => (await MocksHelper.createDebtMonitorMock(deployer)).address,
              }
            )
          );
          const init = await prepareTetuAppWithMultipleLendingPlatforms(
            core,
            1,
            undefined,
            true
          );
          const poolAdapter = PoolAdapterStub__factory.connect(init.poolAdapters[0], deployer);

          const tcAsKeeper = TetuConverter__factory.connect(
            core.tc.address,
            await DeployerUtils.startImpersonate(await core.controller.keeper())
          );

          await tcAsKeeper.requireRepay(
            parseUnits("1", init.borrowInputParams.targetDecimals),
            BigNumber.from(0), // (!) liquidation happens, there is no collateral on user's balance in the pool
            poolAdapter.address
          );

          const debtMonitorMock = DebtMonitorMock__factory.connect(core.dm.address, deployer);
          const ret = await debtMonitorMock.closeLiquidatedPositionLastCalledParam();
          const expected = poolAdapter.address;

          expect(ret).eq(expected);
        });
      });
    });
    describe("Bad paths", () => {
      const selectedPoolAdapterBorrow = 250_000; // 2_000_000 * 0.5 / 4
      const correctAmountToRepay = 150_000;

      async function tryToRepayWrongAmount(
        amountToRepay: number,
        repayBadPathParams?: IRequireRepayBadPathParams,
      ) {
        const selectedPoolAdapterCollateral = 2_000_000;

        const collateralAmounts = [1_000_000, 1_500_000, selectedPoolAdapterCollateral];
        const exactBorrowAmounts = [100, 200, selectedPoolAdapterBorrow];
        const poolAdapterIndex = 2;

        const minHealthFactor2 = 400;
        const targetHealthFactor2 = 500;
        const maxHealthFactor2 = 1000;

        await makeRequireRepay(
          collateralAmounts,
          exactBorrowAmounts,
          {
            useCollateral: false, // this value can be overwritten in some tests
            amountBorrowNum: amountToRepay,
            amountCollateralNum: amountToRepay
          },
          poolAdapterIndex,
          repayBadPathParams,
          {
            minHealthFactor2,
            maxHealthFactor2,
            targetHealthFactor2
          },
          {
            minHealthFactor2: minHealthFactor2 * 2,
            maxHealthFactor2: maxHealthFactor2 * 2,
            targetHealthFactor2: targetHealthFactor2 * 2
          }
        );
      }
      describe("Not keeper", () => {
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(
              correctAmountToRepay,
              {notKeeper: true}
            )
          ).revertedWith("TC-42 keeper only"); // KEEPER_ONLY
        });
      });
      describe("Try to make full repay", () => {
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(selectedPoolAdapterBorrow) // full repay
          ).revertedWith("TC-40 repay to rebalance not allowed"); // REPAY_TO_REBALANCE_NOT_ALLOWED
        });
      });
      describe("Try to repay too much", () => {
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(2 * selectedPoolAdapterBorrow)
          ).revertedWith("TC-40 repay to rebalance not allowed"); // REPAY_TO_REBALANCE_NOT_ALLOWED
        });
      });
      describe("Try to require zero amount of borrow asset", () => {
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(0)
          ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
        });
      });
      describe("Send incorrect amount-to-repay to TetuConverter", () => {
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(
              correctAmountToRepay,
              {
                sendIncorrectAmountToTetuConverter: true
              }
            )
          ).revertedWith("TC-41 wrong amount received"); // WRONG_AMOUNT_RECEIVED
        });
      });
      describe("Result health factor is too big", () => {
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(
              180_000
            )
          ).revertedWith("TC-39: wrong rebalancing"); // WRONG_REBALANCING
        });
      });
      describe("Result health factor is too small", () => {
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(
              100_000
            )
          ).revertedWith("TC-39: wrong rebalancing"); // WRONG_REBALANCING
        });
      });
    });
  });

  describe("getDebtAmountStored", () => {
    describe("Good paths", () => {
      async function makeGetDebtAmountTest(collateralAmounts: number[]) : Promise<{sret: string, sexpected: string}> {
        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
        const pr = await prepareTetuAppWithMultipleLendingPlatforms(core, collateralAmounts.length);
        const sourceTokenDecimals = await pr.sourceToken.decimals();
        const borrows: IBorrowStatus[] = await makeBorrow(
          pr,
          collateralAmounts,
          BigNumber.from(100),
          BigNumber.from(100_000)
        );

        const tcAsUc = ITetuConverter__factory.connect(
          pr.core.tc.address,
          await DeployerUtils.startImpersonate(pr.userContract.address)
        );

        const {
          totalDebtAmountOut,
          totalCollateralAmountOut
        } =(await tcAsUc.getDebtAmountStored(
          await tcAsUc.signer.getAddress(),
          pr.sourceToken.address,
          pr.targetToken.address
        ));

        const sret = [
          totalDebtAmountOut,
          totalCollateralAmountOut,
          ...borrows.map(x => x.status?.collateralAmount || 0)
        ].map(x => BalanceUtils.toString(x)).join("\n");
        const sexpected = [
          borrows.reduce(
            (prev, cur) => prev.add(cur.status?.amountToPay || 0),
            BigNumber.from(0)
          ),
          collateralAmounts.reduce(
            (prev, cur) => prev.add(
              getBigNumberFrom(cur, sourceTokenDecimals)
            ),
            BigNumber.from(0)
          ),
          ...collateralAmounts.map(a => getBigNumberFrom(a, sourceTokenDecimals))
        ].map(x => BalanceUtils.toString(x)).join("\n");

        return {sret, sexpected};
      }
      describe("No opened positions", () => {
        it("should return zero", async () => {
          const ret = await makeGetDebtAmountTest([]);
          expect(ret.sret).eq(ret.sexpected);
        });
      });
      describe("Single opened position", () => {
        it("should return the debt of the opened position", async () => {
          const ret = await makeGetDebtAmountTest([1000]);
          expect(ret.sret).eq(ret.sexpected);
        });
      });
      describe("Multiple opened positions", () => {
        it("should return sum of debts of all opened positions", async () => {
          const ret = await makeGetDebtAmountTest([1000, 2000, 3000, 50]);
          expect(ret.sret).eq(ret.sexpected);
        });
      });
    });
  });

  describe("getDebtAmountCurrent", () => {
    describe("Good paths", () => {
      async function makeGetDebtAmountTest(collateralAmounts: number[]) : Promise<{sret: string, sexpected: string}> {
        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
        const pr = await prepareTetuAppWithMultipleLendingPlatforms(core, collateralAmounts.length);
        const sourceTokenDecimals = await pr.sourceToken.decimals();
        const borrows: IBorrowStatus[] = await makeBorrow(
          pr,
          collateralAmounts,
          BigNumber.from(100),
          BigNumber.from(100_000)
        );

        const tcAsUc = ITetuConverter__factory.connect(
          pr.core.tc.address,
          await DeployerUtils.startImpersonate(pr.userContract.address)
        );

        const {
          totalDebtAmountOut,
          totalCollateralAmountOut
        } = (await tcAsUc.callStatic.getDebtAmountCurrent(
          await tcAsUc.signer.getAddress(),
          pr.sourceToken.address,
          pr.targetToken.address
        ));

        const sret = [
          totalDebtAmountOut,
          totalCollateralAmountOut,
          ...borrows.map(x => x.status?.collateralAmount || 0)
        ].map(x => BalanceUtils.toString(x)).join("\n");
        const sexpected = [
          borrows.reduce(
            (prev, cur) => prev.add(cur.status?.amountToPay || 0),
            BigNumber.from(0)
          ),
          collateralAmounts.reduce(
            (prev, cur) => prev.add(
              getBigNumberFrom(cur, sourceTokenDecimals)
            ),
            BigNumber.from(0)
          ),
          ...collateralAmounts.map(a => getBigNumberFrom(a, sourceTokenDecimals))
        ].map(x => BalanceUtils.toString(x)).join("\n");

        return {sret, sexpected};
      }
      describe("No opened positions", () => {
        it("should return zero", async () => {
          const ret = await makeGetDebtAmountTest([]);
          expect(ret.sret).eq(ret.sexpected);
        });
      });
      describe("Single opened position", () => {
        it("should return the debt of the opened position", async () => {
          const ret = await makeGetDebtAmountTest([1000]);
          expect(ret.sret).eq(ret.sexpected);
        });
      });
      describe("Multiple opened positions", () => {
        it("should return sum of debts of all opened positions", async () => {
          const ret = await makeGetDebtAmountTest([1000, 2000, 3000, 50]);
          expect(ret.sret).eq(ret.sexpected);
        });
      });
    });
  });

  describe("estimateRepay", () => {
    /* Make N borrows, ask to return given amount of collateral.
    * Return borrowed amount that should be return
    * and amount of unobtainable collateral (not zero if we ask too much)
    * */
    async function makeEstimateRepay(
      collateralAmounts: number[],
      exactBorrowAmounts: number[],
      collateralAmountToRedeem: number
    ) : Promise<{
      borrowAssetAmount: BigNumber,
      unobtainableCollateralAssetAmount: BigNumber,
      init: ISetupResults
    }> {
      const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
      const init = await prepareTetuAppWithMultipleLendingPlatforms(core, collateralAmounts.length);
      const collateralTokenDecimals = await init.sourceToken.decimals();

      await makeBorrow(
        init,
        collateralAmounts,
        BigNumber.from(100),
        BigNumber.from(100_000),
        {
          exactBorrowAmounts
        }
      );

      const tcAsUser = ITetuConverter__factory.connect(
        init.core.tc.address,
        await DeployerUtils.startImpersonate(init.userContract.address)
      );

      const {borrowAssetAmount, unobtainableCollateralAssetAmount} = await tcAsUser.estimateRepay(
        await tcAsUser.signer.getAddress(),
        init.sourceToken.address,
        getBigNumberFrom(collateralAmountToRedeem, collateralTokenDecimals),
        init.targetToken.address
      );

      return {
        init,
        borrowAssetAmount,
        unobtainableCollateralAssetAmount
      }
    }
    async function makeEstimateRepayTest(
      collateralAmounts: number[],
      borrowedAmounts: number[],
      collateralAmountToRedeem: number,
      borrowedAmountToRepay: number,
      unobtainableCollateralAssetAmount?: number
    ) : Promise<{ret: string, expected: string}>{
      const r = await makeEstimateRepay(
        collateralAmounts,
        borrowedAmounts,
        collateralAmountToRedeem
      );
      const ret = [
        r.borrowAssetAmount,
        r.unobtainableCollateralAssetAmount
      ].map(x => BalanceUtils.toString(x)).join("\n");
      const expected = [
        getBigNumberFrom(borrowedAmountToRepay, await r.init.targetToken.decimals()),
        getBigNumberFrom(unobtainableCollateralAssetAmount || 0, await r.init.sourceToken.decimals())
      ].map(x => BalanceUtils.toString(x)).join("\n");
      return {ret, expected};
    }

    describe("Good paths", () => {
      describe("Single pool adapter", () => {
        describe("Partial repay is required", () => {
          it("should return expected values", async () => {
            const collateralAmounts = [100_000];
            const borrowedAmounts = [25_000];
            const collateralAmountToRedeem = 10_000;
            const borrowedAmountToRepay = 2_500;
            const r = await makeEstimateRepayTest(
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
              collateralAmounts,
              borrowedAmounts,
              collateralAmountToRedeem,
              borrowedAmountToRepay
            );
            expect(r.ret).eq(r.expected);
          });
        });
      });
      describe("Multiple pool adapters", () => {
        describe("Partial repay is required", () => {
          it("should return expected values, two loans", async () => {
            const collateralAmounts = [100_000, 200_000, 300_000];
            const borrowedAmounts = [25_000, 40_000, 20_000];
            const collateralAmountToRedeem = 300_000;
            const borrowedAmountToRepay = 65_000;
            const r = await makeEstimateRepayTest(
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
              collateralAmounts,
              borrowedAmounts,
              collateralAmountToRedeem,
              borrowedAmountToRepay
            );
            expect(r.ret).eq(r.expected);
          });
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
              collateralAmounts,
              borrowedAmounts,
              collateralAmountToRedeem,
              borrowedAmountToRepay,
            );
            expect(r.ret).eq(r.expected);
          });
        });
      });
    });
  });

  describe("claimRewards", () => {
    interface ISetupClaimRewards {
      receiver: string;
      user: string;
      debtMonitorMock: DebtMonitorMock;
      controller: Controller;
      tetuConverter: TetuConverter;
      poolAdapter: PoolAdapterMock;
    }
    async function setupPoolAdapter(controller: Controller, user: string) : Promise<PoolAdapterMock> {
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
    async function setupClaimRewards() : Promise<ISetupClaimRewards> {
      const user = ethers.Wallet.createRandom().address;
      const receiver = ethers.Wallet.createRandom().address;
      const core = await CoreContracts.build(
        await TetuConverterApp.createController(
          deployer,
          {
            debtMonitorFabric: async () => (await MocksHelper.createDebtMonitorMock(deployer)).address
          }
        )
      );
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

  describe("events", () => {
    describe("Borrow, partial repay", () => {
      it("should emit expected events", async () => {
        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
        const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1);

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
            init.userContract.address
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
          const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
          const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1);

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
              init.userContract.address
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
          const cp: ICreateControllerParams = {
            priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [],[])).address
          };
          const core = await CoreContracts.build(await TetuConverterApp.createController(deployer, cp));
          const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1);

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
              init.userContract.address
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
          const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
          const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1);

          await init.userContract.borrowExactAmount(
            init.sourceToken.address,
            parseUnits("1000", await init.sourceToken.decimals()),
            init.targetToken.address,
            init.userContract.address,
            parseUnits("250", await init.targetToken.decimals())
          );

          const tcAsKeeper = TetuConverter__factory.connect(
            init.core.tc.address,
            await DeployerUtils.startImpersonate(await core.controller.keeper())
          );

          await init.userContract.setUpRequireAmountBack(
            parseUnits("1", await init.targetToken.decimals()),
          );

          await init.targetToken.mint(init.userContract.address, parseUnits("1", await init.targetToken.decimals()));
          await init.targetToken.mint(init.userContract.address, parseUnits("2", await init.sourceToken.decimals()));

          await expect(
            tcAsKeeper.requireRepay(
              parseUnits("1", await init.targetToken.decimals()),
              parseUnits("2", await init.sourceToken.decimals()),
              init.poolAdapters[0],
            )
          ).to.emit(core.tc, "OnRequireRepayRebalancing").withArgs(
            init.poolAdapters[0],
            parseUnits("1", await init.targetToken.decimals()),
            false,
            parseUnits("250", await init.targetToken.decimals())
          );
        });
      });
      describe("Close liquidated position", () => {
        it("should emit expected events", async () => {
          const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
          const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1, undefined, true);

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
          );

          await expect(
            tcAsKeeper.requireRepay(
              parseUnits("1", await init.targetToken.decimals()),
              parseUnits("0", await init.sourceToken.decimals()),
              init.poolAdapters[0],
            )
          ).to.emit(core.tc, "OnRequireRepayCloseLiquidatedPosition").withArgs(
            init.poolAdapters[0],
            parseUnits("207", await init.targetToken.decimals()),
          );
        });
      });
    });

    describe("Claim rewards", () => {
      it("should emit expected events", async () => {
        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
        const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1);

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

  describe("onRequireAmountBySwapManager", () => {
    async function makeTestOnRequireAmountBySwapManager(
      init: ISetupResults,
      approver: string,
      signer?: string
    ) : Promise<{ret: string, expected: string}> {

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
          const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
          const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 0);
          const r = await makeTestOnRequireAmountBySwapManager(init, ethers.Wallet.createRandom().address);
          expect(r.ret).eq(r.expected);
        });
      });
      describe("The amount is approved by TetuConverter", () => {
        it("should return expected values", async () => {
          const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
          const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 0);
          const r = await makeTestOnRequireAmountBySwapManager(init, init.core.tc.address);
          expect(r.ret).eq(r.expected);
        });
      });
    });
    describe("Bad paths", () => {
      it("revert if called by not swap manager", async () => {
        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
        const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 0);
        await expect(
          makeTestOnRequireAmountBySwapManager(init, init.core.tc.address, ethers.Wallet.createRandom().address)
        ).revertedWith("TC-53 swap manager only"); // ONLY_SWAP_MANAGER
      });
    });
  });

  describe("quoteRepay", () => {
    interface IQuoteRepayParams {
      collateralPrice?: string;
      borrowPrice?: string;
    }
    interface IQuoteRepayResults {
      init: ISetupResults;
      collateralAmountOutNum: number;
      gasUsed: BigNumber;
    }
    async function makeQuoteRepayTest(
      collateralAmounts: number[],
      exactBorrowAmounts: number[],
      amountToRepayNum: number,
      params?: IQuoteRepayParams
    ) : Promise<IQuoteRepayResults> {
      const core = await CoreContracts.build(
        await TetuConverterApp.createController(deployer, {
          priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
        })
      );
      const init = await prepareTetuAppWithMultipleLendingPlatforms(core, collateralAmounts.length);
      await PriceOracleMock__factory.connect(await core.controller.priceOracle(), deployer).changePrices(
        [init.sourceToken.address, init.targetToken.address],
        [
          parseUnits(params?.collateralPrice || "1"),
          parseUnits(params?.borrowPrice || "1")
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

      const collateralAmountOut = await tcAsUc.callStatic.quoteRepay(
        await tcAsUc.signer.getAddress(),
        init.sourceToken.address,
        init.targetToken.address,
        parseUnits(amountToRepayNum.toString(), targetTokenDecimals)
      );
      const gasUsed = await tcAsUc.estimateGas.quoteRepay(
        await tcAsUc.signer.getAddress(),
        init.sourceToken.address,
        init.targetToken.address,
        parseUnits(amountToRepayNum.toString(), targetTokenDecimals)
      );

      return {
        init,
        collateralAmountOutNum: Number(formatUnits(collateralAmountOut, sourceTokenDecimals)),
        gasUsed
      }
    }
    describe("Good paths", () => {
      describe("AmountToRepay is 0", () => {
        it("should return 0", async () => {
          const ret = await makeQuoteRepayTest([100], [10], 0);
          expect(ret.collateralAmountOutNum).eq(0);
        });
      });
      describe("AmountToRepay is less or equal than the debt", () => {
        it("should return expected part of collateral, two loans", async () => {
          const ret = await makeQuoteRepayTest([105, 200], [10, 20], 10);
          expect(ret.collateralAmountOutNum).eq(105);
        });
        it("should return expected part of collateral, three loans", async () => {
          const ret = await makeQuoteRepayTest([105, 200, 300], [10, 20, 30], 30);
          expect(ret.collateralAmountOutNum).eq(305);
        });
        it("should return all collateral", async () => {
          const ret = await makeQuoteRepayTest([105, 200, 300], [10, 20, 30], 60);
          expect(ret.collateralAmountOutNum).eq(605);
        });
      });
      describe("AmountToRepay is greater than the debt", () => {
        it("should return all collateral and swapped amount", async () => {
          const ret = await makeQuoteRepayTest(
            [105, 200, 300],
            [10, 20, 30],
            100,
            {
              collateralPrice: "2",
              borrowPrice: "1"
            }
          );
          expect(ret.collateralAmountOutNum).eq(605 + 20);
        });
      });
    });
    describe("Bad paths", () => {
      it("should revert if collateral asset price is zero", async () => {
        await expect(
          makeQuoteRepayTest(
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
          makeQuoteRepayTest(
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
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas threshold", async () => {
        const ret = await makeQuoteRepayTest([100], [10], 0);
        controlGasLimitsEx(ret.gasUsed, GAS_TC_QUOTE_REPAY, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("safeLiquidate", () => {
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
    }
    interface ISafeLiquidateTestResults {
      core: CoreContracts;
      gasUsed: BigNumber;
      amountOut: BigNumber;
      targetBalanceReceiver: BigNumber;
    }
    async function makeSafeLiquidateTest(
      params: ISafeLiquidateTestInputParams
    ) : Promise<ISafeLiquidateTestResults> {
      // initialize mocked tokens
      const sourceToken = await MocksHelper.createMockedCToken(deployer, params.sourceDecimals);
      const targetToken = await MocksHelper.createMockedCToken(deployer, params.targetDecimals);

      // initialize TetuConverter-app
      const core = await CoreContracts.build(
        await TetuConverterApp.createController(deployer, {
          priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
        })
      );

      // setup PriceOracle-prices
      await PriceOracleMock__factory.connect(await core.controller.priceOracle(), deployer).changePrices(
        [sourceToken.address, targetToken.address],
        [params.priceOracleSourcePrice, params.priceOracleTargetPrice]
      );

      // setup TetuLiquidator
      const tetuLiquidator = TetuLiquidatorMock__factory.connect(await core.controller.tetuLiquidator(), deployer);
      await tetuLiquidator.changePrices(
        [sourceToken.address, targetToken.address],
        [params.liquidatorSourcePrice, params.liquidatorTargetPrice]
      );
      await tetuLiquidator.setPriceImpact(params.priceImpact);

      const amountIn = parseUnits(params.amountInNum, await sourceToken.decimals());
      await sourceToken.mint(core.tc.address, amountIn);
      const amountOut = await core.tc.callStatic.safeLiquidate(
        sourceToken.address,
        amountIn,
        targetToken.address,
        params.receiver,
        params.priceImpactToleranceSource,
        params.priceImpactToleranceTarget
      );
      const tx = await core.tc.safeLiquidate(
        sourceToken.address,
        parseUnits(params.amountInNum, await sourceToken.decimals()),
        targetToken.address,
        params.receiver,
        params.priceImpactToleranceSource,
        params.priceImpactToleranceTarget
      );

      const gasUsed = (await tx.wait()).gasUsed;
      return {
        core,
        gasUsed,
        amountOut,
        targetBalanceReceiver: await targetToken.balanceOf(params.receiver)
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
        controlGasLimitsEx(ret.gasUsed, GAS_TC_SAFE_LIQUIDATE, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("isConversionValid", () => {
    // isConversionValid is tested in SwapLibTest, so there is only simple test here
    describe("Good paths", () => {
      it("should return expected values", async () => {
        // initialize mocked tokens
        const sourceToken = await MocksHelper.createMockedCToken(deployer, 6);
        const targetToken = await MocksHelper.createMockedCToken(deployer, 7);

        // initialize TetuConverter-app
        const core = await CoreContracts.build(
          await TetuConverterApp.createController(deployer, {
            priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
          })
        );

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

// //region Make reconversion
//   interface IMakeReconversionResults {
//     balancesInitial: Map<string, (BigNumber | string)[]>;
//     balancesAfterBorrow: Map<string, (BigNumber | string)[]>;
//     balancesAfterReconversion: Map<string, (BigNumber | string)[]>;
//     poolInstances: IPoolInstanceInfo[];
//     poolAdapters: string[];
//     borrowsAfterBorrow: string[];
//     borrowsAfterReconversion: string[];
//   }
//   /**
//    * 1. Create N pools
//    * 2. Set initial BR for each pool
//    * 3. Make borrow using pool with the lowest BR
//    * 2. Chang BR to different values. Now different pool has the lowest BR
//    * 5. Call reconvert
//    * Borrow should be reconverted to expected pool
//    */
//   async function makeReconversion(
//     tt: IBorrowInputParams,
//     sourceAmountNumber: number,
//     availableBorrowLiquidityNumber: number,
//     mapOldNewBR: Map<string, BigNumber>
//   ) : Promise<IMakeReconversionResults> {
//     const sourceAmount = getBigNumberFrom(sourceAmountNumber, tt.sourceDecimals);
//     const availableBorrowLiquidity = getBigNumberFrom(availableBorrowLiquidityNumber, tt.targetDecimals);
//
//     const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
//     const {poolInstances, cToken, userContract, sourceToken, targetToken, poolAdapters} =
//       await prepareContracts(core, tt);
//
//     console.log("cToken is", cToken);
//     console.log("Pool adapters:", poolAdapters.join("\n"));
//     console.log("Pools:", poolInstances.join("\n"));
//
//     const contractsToInvestigate: IContractToInvestigate[] = [
//       {name: "userContract", contract: userContract.address},
//       {name: "tc", contract: core.tc.address},
//       ...poolInstances.map((x, index) => ({name: `pool ${index}`, contract: x.pool})),
//       ...poolAdapters.map((x, index) => ({name: `PA ${index}`, contract: x})),
//     ];
//     const tokensToInvestigate = [sourceToken.address, targetToken.address, cToken];
//
//     // initialize balances
//     await MockERC20__factory.connect(sourceToken.address, deployer).mint(userContract.address, sourceAmount);
//     for (const pi of poolInstances) {
//       await MockERC20__factory.connect(targetToken.address, deployer).mint(pi.pool, availableBorrowLiquidity);
//     }
//     // we need to put some amount on user balance - to be able to return debts
//     await MockERC20__factory.connect(targetToken.address, deployer).mint(userContract.address, availableBorrowLiquidity);
//
//     // get balances before start
//     const balancesInitial = await BalanceUtils.getBalancesObj(deployer, contractsToInvestigate, tokensToInvestigate);
//     console.log("before", before);
//
//     // borrow
//     await userContract.borrowMaxAmount(
//       sourceToken.address,
//       sourceAmount,
//       targetToken.address,
//       userContract.address
//     );
//
//     // get result balances
//     const balancesAfterBorrow = await BalanceUtils.getBalancesObj(deployer, contractsToInvestigate, tokensToInvestigate);
//
//     // get address of PA where the borrow was made
//     const borrowsAfterBorrow = await userContract.getBorrows(sourceToken.address, targetToken.address);
//     console.log("borrowsAfterBorrow", borrowsAfterBorrow);
//
//     // change borrow rates
//     for (let i = 0; i < poolAdapters.length; ++i) {
//       // we need to change borrow rate in platform adapter (to select strategy correctly)
//       // and in the already created pool adapters (to make new borrow correctly)
//       // Probably it worth to move borrow rate to pool stub to avoid possibility of br-unsync
//       const platformAdapter = await LendingPlatformMock__factory.connect(poolInstances[i].platformAdapter, deployer);
//       const brOld = await platformAdapter.borrowRates(targetToken.address);
//       const brNewValue = mapOldNewBR.get(brOld.toString()) || brOld;
//
//       await PoolAdapterMock__factory.connect(poolAdapters[i], deployer).changeBorrowRate(brNewValue);
//       await platformAdapter.changeBorrowRate(targetToken.address, brNewValue);
//     }
//
//     // reconvert the borrow
//     // return borrowed amount to userContract (there are no debts in the mock, so the borrowed amount is enough)
//     const status = await PoolAdapterMock__factory.connect(borrowsAfterBorrow[0], deployer).getStatus();
//     const borrowTokenAsUser = IERC20__factory.connect(targetToken.address
//       , await DeployerUtils.startImpersonate(userContract.address));
//     await borrowTokenAsUser.transfer(userContract.address, status.amountToPay);
//     console.log(`Borrow token, balance of user contract=${borrowTokenAsUser.balanceOf(userContract.address)}`);
//     console.log(`Amount to pay=${(await status).amountToPay}`);
//
//     // TODO: await userContract.requireReconversion(borrowsAfterBorrow[0]);
//
//     // get address of PA where the new borrow was made
//     const borrowsAfterReconversion = await userContract.getBorrows(sourceToken.address, targetToken.address);
//     console.log("borrowsAfterReconversion", borrowsAfterReconversion);
//
//     // get result balances
//     const balancesAfterReconversion = await BalanceUtils.getBalancesObj(deployer
//       , contractsToInvestigate
//       , tokensToInvestigate
//     );
//
//     return {
//       balancesInitial,
//       balancesAfterBorrow,
//       balancesAfterReconversion,
//       poolAdapters,
//       poolInstances,
//       borrowsAfterBorrow,
//       borrowsAfterReconversion,
//     }
//   }
// //endregion Make reconversion
//   describe("TODO:requireReconversion", () => {
//     describe("Good paths", () => {
//       it("should return expected values", async () => {
//         expect.fail("TODO");
//       });
//     });
//     describe("Bad paths", () => {
//       it("should revert", async () => {
//         expect.fail("TODO");
//       });
//     });
//   });


// describe.skip("TODO: reconvert", () => {
//   describe("Good paths", () => {
//     it("should make reconversion", async () => {
//       const sourceAmountNumber = 100_000;
//       const availableBorrowLiquidityNumber = 200_000_000;
//
//       const bn0 = BigNumber.from(0);
//       const targetDecimals = 12;
//       const sourceDecimals = 24;
//       // initial borrow rates
//       const brPA1 = getBigNumberFrom(3, targetDecimals - 6); // 3e-6 (lower)
//       const brPA2 = getBigNumberFrom(5, targetDecimals - 6); // 5e-6 (higher)
//       // changed borrow rates
//       const brPA1new = getBigNumberFrom(7, targetDecimals - 6); // 7e-6 (higher)
//       const brPA2new = getBigNumberFrom(2, targetDecimals - 6); // 2e-6 (lower)
//
//       const tt: IBorrowInputParams = {
//         collateralFactor: 0.8,
//         priceSourceUSD: 0.1,
//         priceTargetUSD: 4,
//         sourceDecimals,
//         targetDecimals,
//         availablePools: [
//           // POOL 1
//           {   // source, target
//             borrowRateInTokens: [bn0, brPA1],
//             availableLiquidityInTokens: [0, availableBorrowLiquidityNumber]
//           },
//           // POOL 2
//           {   // source, target
//             borrowRateInTokens: [bn0, brPA2],
//             availableLiquidityInTokens: [0, availableBorrowLiquidityNumber]
//           },
//         ]
//       };
//       const mapOldNewBr = new Map<string, BigNumber>();
//       mapOldNewBr.set(brPA1.toString(), brPA1new);
//       mapOldNewBr.set(brPA2.toString(), brPA2new);
//
//       const ret = await makeReconversion(
//         tt,
//         sourceAmountNumber,
//         availableBorrowLiquidityNumber,
//         mapOldNewBr
//       );
//
//       const INDEX_BORROW_TOKEN = 1;
//
//       const sret = [
//         ret.borrowsAfterBorrow[0] === ret.poolAdapters[0],
//         ret.borrowsAfterReconversion[0] === ret.poolAdapters[1],
//
//         // user balance of borrow token
//         ret.balancesAfterBorrow.get("userContract")![INDEX_BORROW_TOKEN].toString(),
//         ret.balancesAfterReconversion?.get("userContract")![INDEX_BORROW_TOKEN].toString(),
//       ].join("\n");
//
//       console.log(ret);
//
//       const borrowedAmount = ret.balancesInitial.get("pool 0")![INDEX_BORROW_TOKEN]
//         .sub(ret.balancesAfterBorrow.get("pool 0")![INDEX_BORROW_TOKEN]);
//       const initialUserBalance = BigNumber.from(ret.balancesInitial.get("userContract")![INDEX_BORROW_TOKEN]);
//
//       const sexpected = [
//         true,
//         true,
//
//         initialUserBalance.add(borrowedAmount).toString(),
//         initialUserBalance.add(borrowedAmount).toString()
//       ].join("\n");
//
//       expect(sret).eq(sexpected);
//     });
//   });
//   describe("Bad paths", () => {
//
//   });
// });

// describe("requireAdditionalBorrow", () => {
//   interface ITestResults {
//     userContract: Borrower;
//     borrowedAmount: BigNumber;
//     expectedBorrowAmount: BigNumber;
//     poolAdapter: string;
//     targetHealthFactor2: number;
//     userContractBalanceBorrowAssetAfterBorrow: BigNumber;
//     userContractFinalBalanceBorrowAsset: BigNumber;
//   }
//   /**
//    * Make borrow, reduce all health factors twice, make additional borrow of the same amount
//    */
//   async function makeTest(amountTestCorrectionFactor: number = 1) : Promise<ITestResults> {
//     // prepare app
//     const targetDecimals = 6;
//
//     const collateralFactor = 0.5;
//     const sourceAmountNumber = 100_000;
//     const minHealthFactorInitial2 = 1000;
//     const targetHealthFactorInitial2 = 2000;
//     const maxHealthFactorInitial2 = 4000;
//     const minHealthFactorUpdated2 = 500;
//     const targetHealthFactorUpdated2 = 1000;
//     const maxHealthFactorUpdated2 = 2000;
//
//     const expectedBorrowAmount = getBigNumberFrom(
//       sourceAmountNumber * collateralFactor * 100 / targetHealthFactorInitial2, // == 2500
//       targetDecimals
//     );
//
//     const availableBorrowLiquidityNumber = 200_000_000;
//     const tt: IBorrowInputParams = {
//       collateralFactor,
//       priceSourceUSD: 1,
//       priceTargetUSD: 1,
//       sourceDecimals: 18,
//       targetDecimals,
//       availablePools: [{   // source, target
//         borrowRateInTokens: [BigNumber.from(0), BigNumber.from(0)],
//         availableLiquidityInTokens: [0, availableBorrowLiquidityNumber]
//       }]
//     };
//     const collateralAmount = getBigNumberFrom(sourceAmountNumber, tt.sourceDecimals);
//     const availableBorrowLiquidity = getBigNumberFrom(availableBorrowLiquidityNumber, targetDecimals);
//
//     const {core, poolInstances, userContract, sourceToken, targetToken, poolAdapters} = await prepareContracts(tt);
//     const poolInstance = poolInstances[0];
//     const poolAdapter = poolAdapters[0];
//
//     // initialize balances
//     await MockERC20__factory.connect(sourceToken.address, deployer).mint(userContract.address, collateralAmount);
//     await MockERC20__factory.connect(targetToken.address, deployer).mint(poolInstance.pool, availableBorrowLiquidity);
//
//     // setup high values for all health factors
//     await core.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
//     await core.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
//     await core.controller.setMinHealthFactor2(minHealthFactorInitial2);
//
//     // make borrow
//     await userContract.borrowMaxAmount(
//       sourceToken.address,
//       collateralAmount,
//       targetToken.address,
//       userContract.address // receiver
//     );
//     const borrowedAmount = await userContract.totalBorrowedAmount();
//     const userContractBalanceBorrowAssetAfterBorrow = await targetToken.balanceOf(userContract.address);
//
//     // reduce all health factors down on 2 times to have possibility for additional borrow
//     await core.controller.setMinHealthFactor2(minHealthFactorUpdated2);
//     await core.controller.setTargetHealthFactor2(targetHealthFactorUpdated2);
//     await core.controller.setMaxHealthFactor2(maxHealthFactorUpdated2);
//
//     // make additional borrow
//     // health factors were reduced twice, so we should be able to borrow same amount as before
//     const tcAsKeeper = TetuConverter__factory.connect(
//       core.tc.address,
//       await DeployerUtils.startImpersonate(await core.controller.keeper())
//     );
//     await tcAsKeeper.requireAdditionalBorrow(
//       borrowedAmount.mul(100 * amountTestCorrectionFactor).div(100),
//       poolAdapter
//     );
//
//     return {
//       poolAdapter,
//       borrowedAmount,
//       expectedBorrowAmount,
//       userContract,
//       targetHealthFactor2: targetHealthFactorUpdated2,
//       userContractBalanceBorrowAssetAfterBorrow,
//       userContractFinalBalanceBorrowAsset: await targetToken.balanceOf(userContract.address)
//     }
//   }
//   describe("Good paths", () => {
//     describe("Borrow exact expected amount", () => {
//       let testResults: ITestResults;
//       before(async function () {
//         testResults = await makeTest();
//       })
//       describe("Make borrow, change health factors, make additional borrow", async () => {
//         it("should return expected borrowed amount", async () => {
//           const ret = testResults.borrowedAmount.eq(testResults.expectedBorrowAmount);
//           expect(ret).eq(true);
//         });
//         it("pool adapter should have expected health factor", async () => {
//           const poolAdapter = IPoolAdapter__factory.connect(testResults.poolAdapter, deployer);
//           const poolAdapterStatus = await poolAdapter.getStatus();
//           const ret = poolAdapterStatus.healthFactor18.div(getBigNumberFrom(1, 16)).toNumber();
//           const expected = testResults.targetHealthFactor2;
//           expect(ret).eq(expected);
//         });
//         it("should send notification to user-contract", async () => {
//           const config = await IPoolAdapter__factory.connect(testResults.poolAdapter, deployer).getConfig();
//           const ret = [
//             (await testResults.userContract.onTransferBorrowedAmountLastResultBorrowAsset()).toString(),
//             (await testResults.userContract.onTransferBorrowedAmountLastResultCollateralAsset()).toString(),
//             (await testResults.userContract.onTransferBorrowedAmountLastResultAmountBorrowAssetSentToBorrower()).toString(),
//           ].join();
//           const expected = [
//             config.borrowAsset,
//             config.collateralAsset,
//             testResults.expectedBorrowAmount.toString()
//           ].join();
//           expect(ret).eq(expected);
//         });
//         it("should send expected amount on balance of the user-contract", async () => {
//           const ret = [
//             (await testResults.userContractBalanceBorrowAssetAfterBorrow).toString(),
//             (await testResults.userContractFinalBalanceBorrowAsset).toString(),
//           ].join();
//           const expected = [
//             testResults.expectedBorrowAmount.toString(),
//             testResults.expectedBorrowAmount.mul(2).toString()
//           ].join();
//           expect(ret).eq(expected);
//         });
//       });
//     });
//     describe('Borrow approx amount, difference is allowed', function () {
//       it('should not revert', async () => {
//         await makeTest(0.99);
//         expect(true).eq(true); // no exception above
//       });
//       it('should not revert', async () => {
//         await makeTest(1.01);
//         expect(true).eq(true); // no exception above
//       });
//     });
//   });
//   describe("Bad paths", () => {
//     describe("Rebalancing put health factor down too much", () => {
//       it("should revert", async () => {
//         await expect(
//           makeTest(
//             5 // we try to borrow too big additional amount = 5 * borrowedAmount (!)
//           )
//         ).revertedWith("TC-3 wrong health factor");
//       });
//     });
//     describe("Rebalancing put health factor down not enough", () => {
//       it("should revert", async () => {
//         await expect(
//           makeTest(
//             0.1 // we try to borrow too small additional amount = 0.1 * borrowedAmount (!)
//           )
//         ).revertedWith("");
//       });
//     });
//   });
// });

//endregion Unit tests
});