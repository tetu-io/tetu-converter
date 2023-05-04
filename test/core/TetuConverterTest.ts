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
  ConverterController,
  PoolAdapterStub__factory,
  IPoolAdapter,
  DebtMonitorMock__factory,
  SwapManagerMock__factory,
  PriceOracleMock__factory,
  PoolAdapterMock2__factory,
  IConverterController__factory,
  IERC20Metadata__factory,
  CTokenMock
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
import {getSum} from "../baseUT/utils/CommonUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {boolean} from "hardhat/internal/core/params/argumentTypes";

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

    const initialCollateralAmount = parseUnits(sourceAmountNumber.toString(), sourceDecimals);
    const availableBorrowLiquidityPerPool = parseUnits(availableBorrowLiquidityNumber.toString(), targetDecimals);

    const r = await prepareContracts(core, tt, p);

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

  async function buildCoreContracts(): Promise<CoreContracts> {
    return CoreContracts.build(await TetuConverterApp.createController(deployer));
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
  ): Promise<IMakeFindConversionStrategyResults> {
    const core = await CoreContracts.build(
      await TetuConverterApp.createController(deployer, {
        priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
      })
    );
    const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
      params?.borrowRateNum ? 1 : 0,
      {tetuAppSetupParams: params?.swapConfig}
    );
    if (params?.setConverterToPauseState) {
      await core.controller.connect(
        await DeployerUtils.startImpersonate(await core.controller.governance())
      ).setPaused(true)
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
  ): Promise<IMakeFindConversionStrategyResults> {
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
  ): Promise<IMakeFindConversionStrategyResults | undefined> {
    const core = await CoreContracts.build(
      await TetuConverterApp.createController(deployer, {
        priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
      })
    );
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

//endregion findBorrowStrategies test impl

//region findSwapStrategy test impl
  /**
   * Set up test for findConversionStrategy
   * @param sourceAmountNum
   * @param swapConfig Swap manager config; undefined if there is no DEX
   * @param setConverterToPauseState
   */
  async function makeFindSwapStrategy(
    sourceAmountNum: number,
    swapConfig: IPrepareContractsSetupParams,
    setConverterToPauseState?: boolean
  ): Promise<IMakeFindConversionStrategyResults> {
    const core = await CoreContracts.build(
      await TetuConverterApp.createController(deployer, {
        priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
      })
    );
    const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 0, {tetuAppSetupParams: swapConfig});
    await PriceOracleMock__factory.connect(await core.controller.priceOracle(), deployer).changePrices(
      [init.sourceToken.address, init.targetToken.address],
      [parseUnits("1"), parseUnits("1")] // prices are set to 1 for simplicity
    );

    if (setConverterToPauseState) {
      await core.controller.connect(
        await DeployerUtils.startImpersonate(await core.controller.governance())
      ).setPaused(true)
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

//endregion findSwapStrategy test impl

//region Unit tests
  describe("constructor", () => {
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

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
    ): Promise<TetuConverter> {
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
        const controller = IConverterController__factory.connect(await tetuConverter.controller(), deployer);
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
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

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
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

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
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

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
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
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

      const core = await CoreContracts.build(await TetuConverterApp.createController(
        deployer,
        {
          minHealthFactor2: p?.minHealthFactor2,
        }
      ));
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
            swapManagerFabric: async () => (await MocksHelper.createSwapManagerMock(deployer)).address
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
                      opened: true,
                      debtGapRequired: false
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
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas threshold", async () => {
        const receiver = ethers.Wallet.createRandom().address;

        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
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
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
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

        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
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
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    interface IRepayBadPathParams {
      receiverIsNull?: boolean;
      userSendsNotEnoughAmountToTetuConverter?: boolean;
      hackSendBorrowAssetAmountToBalance?: string;
      initialConverterBalanceBorrowAsset?: string;
      initialConverterBalanceCollateral?: string;
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
      p?: IRepayBadPathParams,
      priceImpact?: number,
    ): Promise<IRepayResults> {
      const core = await CoreContracts.build(
        await TetuConverterApp.createController(deployer, {
          priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
        })
      );
      const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
        collateralAmounts.length,
        {tetuAppSetupParams: {setupTetuLiquidatorToSwapBorrowToCollateral, priceImpact}}
      );
      await PriceOracleMock__factory.connect(await core.controller.priceOracle(), deployer).changePrices(
        [init.sourceToken.address, init.targetToken.address],
        [parseUnits("1"), parseUnits("1")] // prices are set to 1 for simplicity
      );
      const targetTokenDecimals = await init.targetToken.decimals();

      if (p?.initialConverterBalanceCollateral) {
        await init.sourceToken.mint(init.core.tc.address, parseUnits(p.initialConverterBalanceCollateral, await init.sourceToken.decimals()));
      }
      if (p?.initialConverterBalanceBorrowAsset) {
        await init.targetToken.mint(init.core.tc.address, parseUnits(p.initialConverterBalanceBorrowAsset, targetTokenDecimals));
      }

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
        init.targetToken.address,
        false
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
              getBigNumberFrom(1600 - 100, await r.init.targetToken.decimals())
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
              getBigNumberFrom(1600 - 200, await r.init.targetToken.decimals())
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
              getBigNumberFrom(1600 - 600, await r.init.targetToken.decimals())
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
              getBigNumberFrom(1600 - 1500, await r.init.targetToken.decimals())
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
      describe("Try to hack", () => {
        describe("Try to broke repay by sending small amount of borrow asset on balance of the TetuConverter", () => {
          it("should return expected values", async () => {
            const amountToRepay = 70;
            const exactBorrowAmount = 120;
            const r = await makeRepayTest(
              [1_000_000],
              [exactBorrowAmount],
              amountToRepay,
              false,
              {
                hackSendBorrowAssetAmountToBalance: "1"
              }
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
              {receiverIsNull: true}
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
              {userSendsNotEnoughAmountToTetuConverter: true}
            )
          ).revertedWith("TC-41 wrong amount received"); // WRONG_AMOUNT_RECEIVED
        });
      });
      describe("Not zero amount was put on balance of TetuConverter", () => {
        it("should return expected values", async () => {
          const exactBorrowAmount = 120;
          const amountToRepay = exactBorrowAmount;
          const r = await makeRepayTest(
            [1_000_000],
            [exactBorrowAmount],
            amountToRepay,
            false,
            {
              initialConverterBalanceBorrowAsset: "200000",
              initialConverterBalanceCollateral: "500000",
            }
          );

          expect(r.countOpenedPositions).eq(0);
          expect(r.totalDebtAmountOut).eq(+formatUnits((exactBorrowAmount - amountToRepay).toString(), await r.init.targetToken.decimals()));
          expect(+formatUnits(await r.init.targetToken.balanceOf(r.init.core.tc.address), await r.init.targetToken.decimals())).eq(200_000);
          expect(+formatUnits(await r.init.sourceToken.balanceOf(r.init.core.tc.address), await r.init.sourceToken.decimals())).eq(500_000);
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas threshold", async () => {
        const receiver = ethers.Wallet.createRandom().address;

        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
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
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    interface IRequireRepayBadPathParams {
      notKeeper?: boolean;
      sendIncorrectAmountToTetuConverter?: {
        numerator: number;
        denominator: number;
      }
      wrongResultHealthFactor?: boolean;
      initialConverterBalanceBorrowAsset?: string;
      initialConverterBalanceCollateral?: string;
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
      amountCollateralNum: number,
      amountBorrowNum: number,
    }

    async function setupBorrowerRequireAmountBackBehavior(
      init: ISetupResults,
      amountToRepayCollateralAsset: BigNumber,
      repayBadPathParams?: IRequireRepayBadPathParams,
    ) {
      const numerator = repayBadPathParams?.sendIncorrectAmountToTetuConverter?.numerator || 1;
      const denominator = repayBadPathParams?.sendIncorrectAmountToTetuConverter?.denominator || 1;
      const amountUserSendsToTetuConverter = amountToRepayCollateralAsset.mul(numerator).div(denominator);
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
    ): Promise<IRequireRepayResults> {
      const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
      const init = await prepareTetuAppWithMultipleLendingPlatforms(core, collateralAmounts.length);
      const targetTokenDecimals = await init.targetToken.decimals();
      const sourceTokenDecimals = await init.sourceToken.decimals();

      if (repayBadPathParams?.initialConverterBalanceCollateral) {
        await init.sourceToken.mint(init.core.tc.address, parseUnits(repayBadPathParams.initialConverterBalanceCollateral, sourceTokenDecimals));
      }
      if (repayBadPathParams?.initialConverterBalanceBorrowAsset) {
        await init.targetToken.mint(init.core.tc.address, parseUnits(repayBadPathParams.initialConverterBalanceBorrowAsset, targetTokenDecimals));
      }

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
        init.targetToken.address,
        false
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

    interface IMakeRequireRepayTestResults {
      ret: string;
      expected: string;
      r: IRequireRepayResults;
    }

    async function makeRequireRepayTest(p?: IRequireRepayBadPathParams): Promise<IMakeRequireRepayTestResults> {
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
      const amountToRepayBorrowNum = -selectedPoolAdapterBorrow * (1 / healthFactorMultiplier - 1);

      // requiredAmountCollateralAsset = CollateralAmount * (HealthFactorTarget/HealthFactorCurrent - 1)
      const amountToRepayCollateralNum = selectedPoolAdapterCollateral * (healthFactorMultiplier - 1);

      const exactBorrowAmountsSum = exactBorrowAmounts.reduce((prev, cur) => prev + cur, 0);
      const exactCollateralAmountsSum = collateralAmounts.reduce((prev, cur) => prev + cur, 0);

      const r = await makeRequireRepay(
        collateralAmounts,
        exactBorrowAmounts,
        {
          amountCollateralNum: amountToRepayCollateralNum,
          amountBorrowNum: amountToRepayBorrowNum
        },
        poolAdapterIndex,
        p,
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
        getBigNumberFrom(exactBorrowAmountsSum, targetDecimals),
        getBigNumberFrom(exactCollateralAmountsSum + amountToRepayCollateralNum, sourceDecimals),

        getBigNumberFrom(selectedPoolAdapterBorrow, targetDecimals),
        getBigNumberFrom(selectedPoolAdapterCollateral, sourceDecimals),
        true,

        getBigNumberFrom(selectedPoolAdapterBorrow, targetDecimals),
        getBigNumberFrom(selectedPoolAdapterCollateral + amountToRepayCollateralNum, sourceDecimals),
        true,
      ].map(x => BalanceUtils.toString(x)).join("\n");
      return {ret, expected, r};
    }

    describe("Good paths", () => {
      describe("Repay using collateral asset", () => {
        it("should return expected values", async () => {
          const r = await makeRequireRepayTest();
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
          const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1, {usePoolAdapterStub: true});
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
        describe("Send to high amount-to-repay to TetuConverter", () => {
          it("should revert", async () => {
            await expect(
              tryToRepayWrongAmount(
                correctAmountToRepay,
                {
                  sendIncorrectAmountToTetuConverter: {
                    numerator: 2,
                    denominator: 1
                  }
                }
              )
            ).revertedWith("TC-41 wrong amount received"); // WRONG_AMOUNT_RECEIVED
          });
        });
        describe("Send to small amount-to-repay to TetuConverter", () => {
          it("should NOT revert", async () => {
            await tryToRepayWrongAmount(
              correctAmountToRepay,
              {
                sendIncorrectAmountToTetuConverter: {
                  numerator: 1,
                  denominator: 2
                }
              }
            );

            // nothing to check - no revert
          });
        });
      });
      describe("Result health factor is too big", () => {
        it("should NOT revert", async () => {
          await tryToRepayWrongAmount(180_000); // no revert for simplicity
        });
      });
      describe("Result health factor is too small", () => {
        it("should NOT revert", async () => {
          await tryToRepayWrongAmount(100_000); // no revert because partial rebalance is allowed
        });
      });
      describe("Not zero amount was put on balance of TetuConverter", () => {
        it("should return expected values", async () => {
          const {ret, expected, r} = await makeRequireRepayTest({
            initialConverterBalanceBorrowAsset: "500000",
            initialConverterBalanceCollateral: "200000"
          });
          expect(ret).eq(expected);
          expect(+formatUnits(await r.init.sourceToken.balanceOf(r.init.core.tc.address), await r.init.sourceToken.decimals())).eq(200_000);
          expect(+formatUnits(await r.init.targetToken.balanceOf(r.init.core.tc.address), await r.init.targetToken.decimals())).eq(500_000);
        });
      });
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

      const r = (await tcAsUc.callStatic.getDebtAmountCurrent(
        await tcAsUc.signer.getAddress(),
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

  describe("estimateRepay", () => {
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    interface IMakeEstimateRepayResults {
      borrowAssetAmount: BigNumber,
      unobtainableCollateralAssetAmount: BigNumber,
      init: ISetupResults
    }
    interface IMakeEstimateRepayParams {
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
      const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
      const init = await prepareTetuAppWithMultipleLendingPlatforms(core, p.collateralAmounts.length);
      const collateralTokenDecimals = await init.sourceToken.decimals();

      await makeBorrow(
        init,
        p.collateralAmounts,
        BigNumber.from(100),
        BigNumber.from(100_000),
        {
          exactBorrowAmounts: p.exactBorrowAmounts,
          debtGapRequired: p.debtGapRequired
        }
      );

      const tcAsUser = ITetuConverter__factory.connect(
        init.core.tc.address,
        await DeployerUtils.startImpersonate(init.userContract.address)
      );

      const {borrowAssetAmount, unobtainableCollateralAssetAmount} = await tcAsUser.estimateRepay(
        await tcAsUser.signer.getAddress(),
        init.sourceToken.address,
        getBigNumberFrom(p.collateralAmountToRedeem, collateralTokenDecimals),
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
      unobtainableCollateralAssetAmount?: number,
      debtGapRequired?: boolean
    ): Promise<{ ret: string, expected: string }> {
      const r = await makeEstimateRepay({
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
      describe("Debt gap is required", () => {
        it("should return expected values", async () => {
          const collateralAmounts = [100_000, 200_000, 300_000];
          const borrowedAmounts = [25_000, 40_000, 20_000];
          const collateralAmountToRedeem = 600_000;
          const borrowedAmountToRepay = 85_000;
          const r = await makeEstimateRepayTest(
            collateralAmounts,
            borrowedAmounts,
            collateralAmountToRedeem,
            borrowedAmountToRepay * 101/100, // +1% of debt gap
            undefined,
            true // debt gap is required
          );
          expect(r.ret).eq(r.expected);
        });
      });
    });
  });

  describe("claimRewards", () => {
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
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
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

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
            priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
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

          await init.userContract.setUpRequireAmountBack(
            parseUnits("1", await init.targetToken.decimals()),
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
      describe("Close liquidated position", () => {
        it("should emit expected events", async () => {
          const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
          const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1, {usePoolAdapterStub: true});

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
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
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
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    interface IQuoteRepayParams {
      collateralPrice?: string;
      borrowPrice?: string;
    }

    interface IQuoteRepayResults {
      init: ISetupResults;
      collateralAmountOutNum: number;
      swappedAmountOutNum: number;
      gasUsed: BigNumber;
    }

    async function makeQuoteRepayTest(
      collateralAmounts: number[],
      exactBorrowAmounts: number[],
      amountToRepayNum: number,
      params?: IQuoteRepayParams
    ): Promise<IQuoteRepayResults> {
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

      const qouteRepayResults = await tcAsUc.callStatic.quoteRepay(
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
        collateralAmountOutNum: Number(formatUnits(qouteRepayResults.collateralAmountOut, sourceTokenDecimals)),
        swappedAmountOutNum: Number(formatUnits(qouteRepayResults.swappedAmountOut, sourceTokenDecimals)),
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
        it("should return all collaterals", async () => {
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
          expect(ret.swappedAmountOutNum).eq(20);
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
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
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

      // initialize TetuConverter-app
      const core = await CoreContracts.build(
        await TetuConverterApp.createController(deployer, {
          priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
        })
      );

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
      const amountOut = await core.tc.callStatic.safeLiquidate(
        sourceToken.address,
        amountIn,
        targetToken.address,
        p.receiver,
        p.priceImpactToleranceSource,
        p.priceImpactToleranceTarget
      );
      const tx = await core.tc.safeLiquidate(
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
        controlGasLimitsEx(ret.gasUsed, GAS_TC_SAFE_LIQUIDATE, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("isConversionValid", () => {
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

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

  describe("repayTheBorrow", () => {
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
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

      const core = await CoreContracts.build(await TetuConverterApp.createController(deployer, {}));
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
      describe("Normal case", () => {
        it("should return expected values", async () => {
          const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
          const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);

          const r = await makeRepayTheBorrowTest({
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
              collateralAmount: "100",
              amountToPay: "50",
              opened: true,
              collateralAmountLiquidated: "0",
              healthFactor18: "2"
            }
          });
          const ret = [
            r.collateralAmountOut,
            r.repaidAmountOut,
            r.balanceUserAfterRepay.collateral,
            r.balanceUserAfterRepay.borrow
          ].join();
          const expected = [
            100,
            50,
            100,
            0
          ].join();
          expect(ret).eq(expected);
        });
      });
      describe("Ensure update status is called", () => {
        it("should return expected values", async () => {
          const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
          const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);

          const r = await makeRepayTheBorrowTest({
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
          const ret = [
            r.collateralAmountOut,
            r.repaidAmountOut,
            r.balanceUserAfterRepay.collateral,
            r.balanceUserAfterRepay.borrow
          ].join();
          const expected = [
            100,
            50,
            100,
            0
          ].join();
          expect(ret).eq(expected);
        });
      });
      describe("Return less amount than required", () => {
        it("should return expected values", async () => {
          const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
          const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);

          const r = await makeRepayTheBorrowTest({
            collateralAsset,
            borrowAsset,
            tetuConverterCallback: {
              amount: "50",
              amountOut: "40", // (!)
              amountToSend: "40" // (!)
            },
            repayParams: {
              closePosition: false, // (!)
              borrowAmountSendToReceiver: "0",
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
          const ret = [
            r.collateralAmountOut,
            r.repaidAmountOut,
            r.balanceUserAfterRepay.collateral,
            r.balanceUserAfterRepay.borrow
          ].join();
          const expected = [
            100,
            40,
            100,
            0
          ].join();
          expect(ret).eq(expected);
        });
      });
      describe("Return a part of borrow-amount back to the user", () => {
        it("should return expected values", async () => {
          const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
          const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);

          const r = await makeRepayTheBorrowTest({
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
          const ret = [
            r.collateralAmountOut,
            r.repaidAmountOut,
            r.balanceUserAfterRepay.collateral,
            r.balanceUserAfterRepay.borrow
          ].join();
          const expected = [
            100,
            40 - 5,
            100,
            5
          ].join();
          expect(ret).eq(expected);
        });
      });
      describe("Check onTransferAmounts", () => {
        it("should pass expected values to onTransferAmounts if only collateral is sent", async () => {
          const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
          const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);

          const r = await makeRepayTheBorrowTest({
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
              collateralAmount: "100",
              amountToPay: "50",
              opened: true,
              collateralAmountLiquidated: "0",
              healthFactor18: "2"
            }
          });
          const ret = [
            r.onTransferAmounts.assets,
            r.onTransferAmounts.amounts,
          ].join();
          const expected = [
            [borrowAsset.address, collateralAsset.address],
            [0, 100]
          ].join();
          expect(ret).eq(expected);
        });
        it("should pass expected values to onTransferAmounts if both collateral and borrow-asset were sent", async () => {
          const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
          const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);

          const r = await makeRepayTheBorrowTest({
            collateralAsset,
            borrowAsset,
            tetuConverterCallback: {
              amount: "50",
              amountOut: "50",
              amountToSend: "50"
            },
            repayParams: {
              closePosition: true,
              borrowAmountSendToReceiver: "11",
              collateralAmountSendToReceiver: "93",
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
          const ret = [
            r.onTransferAmounts.assets,
            r.onTransferAmounts.amounts,
          ].join();
          const expected = [
            [borrowAsset.address, collateralAsset.address],
            [11, 93]
          ].join();
          expect(ret).eq(expected);
        });
      });
      describe('Debt gap is required', () => {
        it("should return expected values", async () => {
          const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
          const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);

          const r = await makeRepayTheBorrowTest({
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
          const ret = [
            r.collateralAmountOut,
            r.repaidAmountOut,
            r.balanceUserAfterRepay.collateral,
            r.balanceUserAfterRepay.borrow
          ].join();
          const expected = [
            100,
            50.2, // 50.5 - 0.3 = 50.2
            100,
            0.3
          ].join();
          expect(ret).eq(expected);
        });
      });
    });
    describe("Bad paths", () => {
      it("should revert if try to close position with not enough amount", async () => {
        const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
        const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);

        await expect(makeRepayTheBorrowTest({
          collateralAsset,
          borrowAsset,
          tetuConverterCallback: {
            amount: "50",
            amountOut: "40", // (!) amount is not enough
            amountToSend: "40" // (!)
          },
          repayParams: {
            closePosition: true, // (!) .. but we try to close the position
            borrowAmountSendToReceiver: "0",
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
        })).revertedWith("TC-41 wrong amount received"); // WRONG_AMOUNT_RECEIVED
      });
      it("should revert if callback returns zero amount", async () => {
        const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
        const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);

        await expect(makeRepayTheBorrowTest({
          collateralAsset,
          borrowAsset,
          tetuConverterCallback: {
            amount: "50",
            amountOut: "0", // (!) amount is zero
            amountToSend: "0" // (!)
          },
          repayParams: {
            closePosition: false,
            borrowAmountSendToReceiver: "0",
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
        })).revertedWith("TC-28 zero balance"); // ZERO_BALANCE
      });
      it("should revert if not governance", async () => {
        const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
        const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);

        await expect(makeRepayTheBorrowTest({
          collateralAsset,
          borrowAsset,
          tetuConverterCallback: {
            amount: "50",
            amountOut: "50",
            amountToSend: "50"
          },
          repayParams: {
            closePosition: false,
            borrowAmountSendToReceiver: "0",
            collateralAmountSendToReceiver: "100",
            amountToRepay: "40"
          },
          statusParams: {
            collateralAmount: "100",
            amountToPay: "50",
            opened: true,
            collateralAmountLiquidated: "0",
            healthFactor18: "2"
          },
          tetuConverterExecutor: ethers.Wallet.createRandom().address // (!) not governance
        })).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
      });
      it("should revert if there is no debt", async () => {
        const collateralAsset = await MocksHelper.createMockedCToken(deployer, 8);
        const borrowAsset = await MocksHelper.createMockedCToken(deployer, 11);

        await expect(makeRepayTheBorrowTest({
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
            collateralAmountSendToReceiver: "0",
            amountToRepay: "50"
          },
          statusParams: {
            collateralAmount: "0", // (!) no debts => no collateral
            amountToPay: "0", // (!) no debts
            opened: true,
            collateralAmountLiquidated: "0",
            healthFactor18: "2"
          }
        })).revertedWith("TC-27 repay failed"); // REPAY_FAILED
      });
    });
  });

  describe("getPositions", () => {
    beforeEach(async function () {
      snapshotForEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotForEach);
    });

    it("should return single open position after borrowing", async () => {
      const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
      const init = await prepareTetuAppWithMultipleLendingPlatforms(core, 1);
      await makeBorrow(init, [100], BigNumber.from(100), BigNumber.from(100_000));
      const r = await core.tc.getPositions(init.userContract.address, init.sourceToken.address, init.targetToken.address);
      expect(r.length).eq(1);
    });
  });

  describe("salvage", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        const receiver = ethers.Wallet.createRandom().address;
        const sourceToken = await MocksHelper.createMockedCToken(deployer, 6);
        const targetToken = await MocksHelper.createMockedCToken(deployer, 7);

        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer, {
          priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
        }));

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

        const core = await CoreContracts.build(await TetuConverterApp.createController(deployer, {
          priceOracleFabric: async () => (await MocksHelper.getPriceOracleMock(deployer, [], [])).address
        }));

        await expect(
          core.tc.connect(await Misc.impersonate(receiver)).salvage(receiver, sourceToken.address, 800)
        ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
      });
    });
  });

//endregion Unit tests
});
