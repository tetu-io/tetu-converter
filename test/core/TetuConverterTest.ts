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
  PoolAdapterStub__factory, IPoolAdapter, SwapManager__factory, DebtMonitorMock__factory, SwapManagerMock__factory
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
import {BigNumber} from "ethers";
import {Misc} from "../../scripts/utils/Misc";
import {IPoolAdapterStatus} from "../baseUT/types/BorrowRepayDataTypes";
import {getExpectedApr18} from "../baseUT/apr/aprUtils";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {parseUnits} from "ethers/lib/utils";
import {controlGasLimitsEx} from "../../scripts/utils/hardhatUtils";
import {
  GAS_FIND_CONVERSION_STRATEGY_ONLY_BORROW_AVAILABLE,
} from "../baseUT/GasLimit";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";

describe("TetuConverterTest", () => {
//region Constants
  const BLOCKS_PER_DAY = 6456;
  const CONVERSION_MODE_AUTO = 0;
  const CONVERSION_MODE_BORROW = 1;
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
    usePoolAdapterStub: boolean = false
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
    usePoolAdapterStub: boolean = false
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
        x => ({   // source, target
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

  async function callBorrowerBorrow(
    pp: ISetupResults,
    receiver: string,
    exactBorrowAmount: number | undefined,
    collateralAmount: BigNumber,
    badPathParamManualConverter?: string,
    badPathTransferAmountMultiplier18?: BigNumber
  ) : Promise<IConversionResults> {
    const amountToBorrow = exactBorrowAmount
      ? getBigNumberFrom(exactBorrowAmount, await pp.targetToken.decimals())
      : 0;
    const borrowAmountReceiver = receiver || pp.userContract.address;
    const uc = pp.userContract;
    const sourceToken = pp.sourceToken.address;
    const targetToken = pp.targetToken.address;

    const borrowedAmountOut: BigNumber = exactBorrowAmount === undefined
      ? await uc.callStatic.borrowMaxAmount(sourceToken, collateralAmount, targetToken, borrowAmountReceiver)
      : badPathParamManualConverter === undefined
        ? await uc.callStatic.borrowExactAmount(sourceToken, collateralAmount, targetToken, borrowAmountReceiver, amountToBorrow)
        : await uc.callStatic.borrowExactAmountBadPaths(sourceToken, collateralAmount, targetToken, borrowAmountReceiver, amountToBorrow,
          badPathParamManualConverter,
          badPathTransferAmountMultiplier18 || Misc.WEI
        );

    const gas: BigNumber = exactBorrowAmount === undefined
      ? await uc.estimateGas.borrowMaxAmount(sourceToken, collateralAmount, targetToken, borrowAmountReceiver)
      : badPathParamManualConverter === undefined
        ? await uc.estimateGas.borrowExactAmount(sourceToken, collateralAmount, targetToken, borrowAmountReceiver, amountToBorrow)
        : await uc.estimateGas.borrowExactAmountBadPaths(sourceToken, collateralAmount, targetToken, borrowAmountReceiver, amountToBorrow,
          badPathParamManualConverter,
          badPathTransferAmountMultiplier18 || Misc.WEI
        );

    // ask TetuConverter to make a borrow, the pool adapter with best borrow rate will be selected
    if (exactBorrowAmount === undefined) {
      await uc.borrowMaxAmount(sourceToken, collateralAmount, targetToken, borrowAmountReceiver);
    } else {
      if (badPathParamManualConverter === undefined) {
        await uc.borrowExactAmount(sourceToken, collateralAmount, targetToken, borrowAmountReceiver, amountToBorrow);
      } else {
        await uc.borrowExactAmountBadPaths(sourceToken, collateralAmount, targetToken, borrowAmountReceiver, amountToBorrow,
          badPathParamManualConverter,
          badPathTransferAmountMultiplier18 || Misc.WEI
        );
      }
    }

    return {borrowedAmountOut, gas};
  }

  /**
   *    Make a borrow in each pool adapter using provided collateral amount.
   * @param pp
   * @param collateralAmounts
   * @param bestBorrowRateInBorrowAsset
   * @param ordinalBorrowRateInBorrowAsset
   * @param exactBorrowAmounts
   * @param receiver
   * @param badPathParamManualConverter
   * @param transferAmountMultiplier18
   */
  async function makeBorrow(
    pp: ISetupResults,
    collateralAmounts: number[],
    bestBorrowRateInBorrowAsset: BigNumber,
    ordinalBorrowRateInBorrowAsset: BigNumber,
    exactBorrowAmounts?: number[],
    receiver?: string,
    badPathParamManualConverter?: string,
    transferAmountMultiplier18?: BigNumber
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
        receiver || pp.userContract.address,
        exactBorrowAmounts ? exactBorrowAmounts[i] : undefined,
        collateralAmount,
        transferAmountMultiplier18
          ? pp.poolInstances[i].converter
          : badPathParamManualConverter,
        transferAmountMultiplier18
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

//region Make reconversion
  interface IMakeReconversionResults {
    balancesInitial: Map<string, (BigNumber | string)[]>;
    balancesAfterBorrow: Map<string, (BigNumber | string)[]>;
    balancesAfterReconversion: Map<string, (BigNumber | string)[]>;
    poolInstances: IPoolInstanceInfo[];
    poolAdapters: string[];
    borrowsAfterBorrow: string[];
    borrowsAfterReconversion: string[];
  }
  /**
   * 1. Create N pools
   * 2. Set initial BR for each pool
   * 3. Make borrow using pool with the lowest BR
   * 2. Chang BR to different values. Now different pool has the lowest BR
   * 5. Call reconvert
   * Borrow should be reconverted to expected pool
   */
  async function makeReconversion(
    tt: IBorrowInputParams,
    sourceAmountNumber: number,
    availableBorrowLiquidityNumber: number,
    mapOldNewBR: Map<string, BigNumber>
  ) : Promise<IMakeReconversionResults> {
    const sourceAmount = getBigNumberFrom(sourceAmountNumber, tt.sourceDecimals);
    const availableBorrowLiquidity = getBigNumberFrom(availableBorrowLiquidityNumber, tt.targetDecimals);

    const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
    const {poolInstances, cToken, userContract, sourceToken, targetToken, poolAdapters} =
      await prepareContracts(core, tt);

    console.log("cToken is", cToken);
    console.log("Pool adapters:", poolAdapters.join("\n"));
    console.log("Pools:", poolInstances.join("\n"));

    const contractsToInvestigate: IContractToInvestigate[] = [
      {name: "userContract", contract: userContract.address},
      {name: "tc", contract: core.tc.address},
      ...poolInstances.map((x, index) => ({name: `pool ${index}`, contract: x.pool})),
      ...poolAdapters.map((x, index) => ({name: `PA ${index}`, contract: x})),
    ];
    const tokensToInvestigate = [sourceToken.address, targetToken.address, cToken];

    // initialize balances
    await MockERC20__factory.connect(sourceToken.address, deployer).mint(userContract.address, sourceAmount);
    for (const pi of poolInstances) {
      await MockERC20__factory.connect(targetToken.address, deployer).mint(pi.pool, availableBorrowLiquidity);
    }
    // we need to put some amount on user balance - to be able to return debts
    await MockERC20__factory.connect(targetToken.address, deployer).mint(userContract.address, availableBorrowLiquidity);

    // get balances before start
    const balancesInitial = await BalanceUtils.getBalancesObj(deployer, contractsToInvestigate, tokensToInvestigate);
    console.log("before", before);

    // borrow
    await userContract.borrowMaxAmount(
      sourceToken.address,
      sourceAmount,
      targetToken.address,
      userContract.address
    );

    // get result balances
    const balancesAfterBorrow = await BalanceUtils.getBalancesObj(deployer, contractsToInvestigate, tokensToInvestigate);

    // get address of PA where the borrow was made
    const borrowsAfterBorrow = await userContract.getBorrows(sourceToken.address, targetToken.address);
    console.log("borrowsAfterBorrow", borrowsAfterBorrow);

    // change borrow rates
    for (let i = 0; i < poolAdapters.length; ++i) {
      // we need to change borrow rate in platform adapter (to select strategy correctly)
      // and in the already created pool adapters (to make new borrow correctly)
      // Probably it worth to move borrow rate to pool stub to avoid possibility of br-unsync
      const platformAdapter = await LendingPlatformMock__factory.connect(poolInstances[i].platformAdapter, deployer);
      const brOld = await platformAdapter.borrowRates(targetToken.address);
      const brNewValue = mapOldNewBR.get(brOld.toString()) || brOld;

      await PoolAdapterMock__factory.connect(poolAdapters[i], deployer).changeBorrowRate(brNewValue);
      await platformAdapter.changeBorrowRate(targetToken.address, brNewValue);
    }

    // reconvert the borrow
    // return borrowed amount to userContract (there are no debts in the mock, so the borrowed amount is enough)
    const status = await PoolAdapterMock__factory.connect(borrowsAfterBorrow[0], deployer).getStatus();
    const borrowTokenAsUser = IERC20__factory.connect(targetToken.address
      , await DeployerUtils.startImpersonate(userContract.address));
    await borrowTokenAsUser.transfer(userContract.address, status.amountToPay);
    console.log(`Borrow token, balance of user contract=${borrowTokenAsUser.balanceOf(userContract.address)}`);
    console.log(`Amount to pay=${(await status).amountToPay}`);

    // TODO: await userContract.requireReconversion(borrowsAfterBorrow[0]);

    // get address of PA where the new borrow was made
    const borrowsAfterReconversion = await userContract.getBorrows(sourceToken.address, targetToken.address);
    console.log("borrowsAfterReconversion", borrowsAfterReconversion);

    // get result balances
    const balancesAfterReconversion = await BalanceUtils.getBalancesObj(deployer
      , contractsToInvestigate
      , tokensToInvestigate
    );

    return {
      balancesInitial,
      balancesAfterBorrow,
      balancesAfterReconversion,
      poolAdapters,
      poolInstances,
      borrowsAfterBorrow,
      borrowsAfterReconversion,
    }
  }
//endregion Make reconversion

//region Predict conversion results
  interface IFindConversionStrategyResults {
    converter: string;
    maxTargetAmount: BigNumber;
    apr18: BigNumber;
  }

  interface IMakeFindConversionStrategyResults {
    init: ISetupResults;
    results: IFindConversionStrategyResults;
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
  ) : Promise<IFindConversionStrategyResults> {
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
      r.results.maxTargetAmount
    );
    const sourceAmount = getBigNumberFrom(sourceAmountNum, await r.init.sourceToken.decimals());
    const loss = sourceAmount.sub(returnAmount);
    const apr18 = loss.mul(APR_NUMERATOR).div(sourceAmount);

    return {
      maxTargetAmount,
      apr18,
      converter: r.init.core.swapManager.address
    }
  }

  async function getExpectedBorrowingResults(
    r: IMakeFindConversionStrategyResults,
    sourceAmountNum: number,
    period: number
  ) : Promise<IFindConversionStrategyResults> {
    const targetHealthFactor = await r.init.core.controller.targetHealthFactor2();

    const maxTargetAmount = getBigNumberFrom(
      r.init.borrowInputParams.collateralFactor
      * sourceAmountNum * r.init.borrowInputParams.priceSourceUSD
      / (r.init.borrowInputParams.priceTargetUSD)
      / targetHealthFactor * 100
      , await r.init.targetToken.decimals()
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
      maxTargetAmount,
      apr18
    }
  }
//endregion Predict conversion results

//region Unit tests
  describe("constructor", () => {
    interface IMakeConstructorTestParams {
      useZeroController?: boolean;
    }
    async function makeConstructorTest(
      params?: IMakeConstructorTestParams
    ) : Promise<TetuConverter> {
      const controller = await TetuConverterApp.createController(
        deployer,
        {
          tetuConverterFabric: async c => (await CoreContractsHelper.createTetuConverter(
            deployer,
            params?.useZeroController
              ? Misc.ZERO_ADDRESS
              : c.address
          )).address,
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
    });
    describe("Bad paths", () => {
      it("should revert if controller is zero", async () => {
        await expect(
          makeConstructorTest({useZeroController: true})
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
    });
  });

  describe("findBestConversionStrategy", () => {
//region Test impl
    interface IFindConversionStrategyBadParams {
      zeroSourceAmount?: boolean;
      zeroPeriod?: boolean;
    }

    /**
     * Set up test for findConversionStrategy
     * @param sourceAmount
     * @param periodInBlocks
     * @param conversionMode
     * @param borrowRateNum Borrow rate (as num, no decimals); undefined if there is no lending pool
     * @param swapConfig Swap manager config; undefined if there is no DEX
     */
    async function makeFindConversionStrategy(
      sourceAmount: number,
      periodInBlocks: number,
      conversionMode: number,
      borrowRateNum?: number,
      swapConfig?: IPrepareContractsSetupParams
    ) : Promise<IMakeFindConversionStrategyResults> {
      const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
      const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
        borrowRateNum ? 1: 0,
        swapConfig
      );

      if (borrowRateNum) {
        await PoolAdapterMock__factory.connect(
          init.poolAdapters[0],
          deployer
        ).changeBorrowRate(borrowRateNum);
        await LendingPlatformMock__factory.connect(
          init.poolInstances[0].platformAdapter,
          deployer
        ).changeBorrowRate(init.targetToken.address, borrowRateNum);
      }

      const gas = await init.core.tc.estimateGas.findConversionStrategy(
        init.sourceToken.address,
        getBigNumberFrom(sourceAmount, await init.sourceToken.decimals()),
        init.targetToken.address,
        periodInBlocks,
        conversionMode
      );
      const results = await init.core.tc.findConversionStrategy(
        init.sourceToken.address,
        getBigNumberFrom(sourceAmount, await init.sourceToken.decimals()),
        init.targetToken.address,
        periodInBlocks,
        conversionMode
      );

      const poolAdapterConverter = init.poolAdapters.length
        ? (await PoolAdapterMock__factory.connect(init.poolAdapters[0], deployer).getConfig()).origin
        : Misc.ZERO_ADDRESS;

      return {
        init,
        results,
        poolAdapterConverter,
        gas
      }
    }

    async function makeFindConversionStrategyTest(
      conversionMode: number,
      useLendingPool: boolean,
      useDexPool: boolean,
      badPathsParams?: IFindConversionStrategyBadParams
    ) : Promise<IMakeFindConversionStrategyResults> {
      return makeFindConversionStrategy(
        badPathsParams?.zeroSourceAmount ? 0 : 1000,
         badPathsParams?.zeroPeriod ? 0 : 100,
        conversionMode,
        useLendingPool ? 1000 : undefined,
        useDexPool
          ? {
            priceImpact: 1_000,
            setupTetuLiquidatorToSwapBorrowToCollateral: true
          }
          : undefined
      );
    }

    async function makeFindConversionStrategySwapAndBorrow(
      period: number,
      priceImpact: number,
      conversionMode: number
    ) : Promise<{
      results: IFindConversionStrategyResults,
      expectedSwap: IFindConversionStrategyResults,
      expectedBorrowing: IFindConversionStrategyResults
    }> {
      const sourceAmountNum = 100_000;
      const borrowRateNum = 1000;
      const r = await makeFindConversionStrategy(
        sourceAmountNum,
        period,
        conversionMode,
        borrowRateNum,
        {
          priceImpact,
          setupTetuLiquidatorToSwapBorrowToCollateral: true
        }
      )
      const expectedSwap = await getExpectedSwapResults(r, sourceAmountNum);
      const expectedBorrowing = await getExpectedBorrowingResults(r, sourceAmountNum, period);
      return {
        results: r.results,
        expectedSwap,
        expectedBorrowing
      }
    }
//endregion Test impl

    describe("Good paths", () => {
      describe("Check output converter value", () => {
        describe("Conversion mode is AUTO", () => {
          describe("Neither borrowing no swap are available", () => {
            it("should return zero converter", async () => {
              const r = await makeFindConversionStrategyTest(CONVERSION_MODE_AUTO, false, false);
              expect(r.results.converter).eq(Misc.ZERO_ADDRESS);
            });
          });
          describe("Only borrowing is available", () => {
            it("should return a converter for borrowing", async () => {
              const r = await makeFindConversionStrategyTest(CONVERSION_MODE_AUTO, true, false);
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
              const r = await makeFindConversionStrategyTest(CONVERSION_MODE_AUTO, true, false);
              controlGasLimitsEx(r.gas, GAS_FIND_CONVERSION_STRATEGY_ONLY_BORROW_AVAILABLE, (u, t) => {
                expect(u).to.be.below(t);
              });
            });
          });
          describe("Only swap is available", () => {
            it("should return a converter to swap", async () => {
              const r = await makeFindConversionStrategyTest(CONVERSION_MODE_AUTO, false, true);
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
                  CONVERSION_MODE_AUTO
                );
                console.log(r);
                const ret = [
                  r.results.converter,
                  r.results.maxTargetAmount,
                  r.results.apr18
                ].map(x => BalanceUtils.toString(x)).join("\r");
                const expected = [
                  r.expectedBorrowing.converter,
                  r.expectedBorrowing.maxTargetAmount,
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
                  CONVERSION_MODE_AUTO
                );
                const ret = [
                  r.results.converter,
                  r.results.maxTargetAmount,
                  r.results.apr18
                ].map(x => BalanceUtils.toString(x)).join("\r");
                const expected = [
                  r.expectedSwap.converter,
                  r.expectedSwap.maxTargetAmount,
                  r.expectedSwap.apr18
                ].map(x => BalanceUtils.toString(x)).join("\r");

                expect(ret).eq(expected);
              });
            });
          });
        });
        describe("Conversion mode is BORROW", () => {
          describe("Neither borrowing no swap are available", () => {
            it("should return zero converter", async () => {
              const r = await makeFindConversionStrategyTest(CONVERSION_MODE_BORROW, false, false);
              expect(r.results.converter).eq(Misc.ZERO_ADDRESS);
            });
          });
          describe("Only swap is available", () => {
            it("should return zero converter", async () => {
              const r = await makeFindConversionStrategyTest(CONVERSION_MODE_BORROW, false, true);
              expect(r.results.converter).eq(Misc.ZERO_ADDRESS);
            });
          });
          describe("Only borrowing is available", () => {
            it("should return borrow-converter", async () => {
              const r = await makeFindConversionStrategyTest(CONVERSION_MODE_BORROW, true, false);
              expect(r.results.converter).eq(r.poolAdapterConverter);
            });
          });
          describe("Both borrowing and swap are available", () => {
            describe("APR of borrowing is better", () => {
              it("should return borrow-converter", async () => {
                const r = await makeFindConversionStrategySwapAndBorrow(
                  1,
                  10_000,
                  CONVERSION_MODE_BORROW
                );
                expect(r.results.converter).eq(r.expectedBorrowing.converter);

              });
            });
            describe("APR of swapping is better", () => {
              it("should return borrow-converter", async () => {
                const r = await makeFindConversionStrategySwapAndBorrow(
                  10_000,
                  0,
                  CONVERSION_MODE_BORROW
                );
                expect(r.results.converter).eq(r.expectedBorrowing.converter);

              });
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
            CONVERSION_MODE_BORROW,
            borrowRateNum,
          )
          const expected = await getExpectedBorrowingResults(r, sourceAmount, period);

          const sret = [
            r.results.converter,
            r.results.maxTargetAmount,
            r.results.apr18
          ].join("\n");

          const sexpected = [
            expected.converter,
            expected.maxTargetAmount,
            expected.apr18
          ].join("\n");

          expect(sret).equal(sexpected);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Source amount is 0", () => {
        it("should revert", async () => {
          await expect(
            makeFindConversionStrategyTest(
              CONVERSION_MODE_AUTO,
              false,
              false,
              {
                zeroSourceAmount: true
              }
            )
          ).revertedWith("TC-43"); // ZERO_AMOUNT
        });
      });
      describe("Period is 0", () => {
        describe("Conversion mode is AUTO", () => {
          it("should revert", async () => {
            await expect(
              makeFindConversionStrategyTest(
                CONVERSION_MODE_AUTO,
                false,
                false,
                {
                  zeroPeriod: true
                }
              )
            ).revertedWith("TC-29"); // INCORRECT_VALUE
          });
        });
        describe("Conversion mode is BORROW", () => {
          it("should revert", async () => {
            await expect(
              makeFindConversionStrategyTest(
                CONVERSION_MODE_BORROW,
                false,
                false,
                {
                  zeroPeriod: true
                }
              )
            ).revertedWith("TC-29"); // INCORRECT_VALUE
          });
        });
      });
      // we don't need a test to check "incorrect conversion mode value"
      // because Solidity generates an exception like following
      // "value out-of-bounds (argument="conversionMode", value=777, code=INVALID_ARGUMENT, version=abi/5.6.4)"
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
        exactBorrowAmounts,
        receiver,
        params?.incorrectConverterAddress,
        params?.transferAmountMultiplier18
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
            (prev, cur) => prev = prev.add(cur.conversionResult.borrowedAmountOut),
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
              ).revertedWith("TC-46"); // REBALANCING_IS_REQUIRED
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
            lastSwapInputParams.targetAmount,
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
            getBigNumberFrom(amountToBorrowNum, await r.init.targetToken.decimals()),
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
            ).revertedWith("TC-1"); // ZERO_ADDRESS
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
            ).revertedWith("TC-6"); // PLATFORM_ADAPTER_NOT_FOUND
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
            ).revertedWith("TC-44"); // INCORRECT_CONVERTER_TO_SWAP
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
          ).revertedWith("TC-1"); // ZERO_ADDRESS
        });
      });
      describe("amount to borrow is 0", () => {
        it("should revert", async () => {
          await expect(
            makeConversionUsingBorrowing (
              [100_000],
              [0], // (!)
            )
          ).revertedWith("TC-43"); // ZERO_AMOUNT
        });
      });
      describe("Collateral amount is 0", () => {
        it("should revert", async () => {
          await expect(
            makeConversionUsingBorrowing (
              [0], // (!)
              [100],
            )
          ).revertedWith("TC-43"); // ZERO_AMOUNT
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
          ).revertedWith("TC-41"); // WRONG_AMOUNT_RECEIVED
        });
      });
      describe("Too much collateral amount on balance of TetuConverter", () => {
        it("should keep exceed amount on the balance of TetuConverter", async () => {
          const collateralAmountNum = 100_000;
          const transferAmountMultiplier18 = Misc.WEI.mul(2);
          const r = await makeConversionUsingBorrowing(
            [collateralAmountNum],
            [1_00],
            {
              transferAmountMultiplier18
            }
          );
          const balanceCollateralAssetOnTetuConverter = await r.init.sourceToken.balanceOf(r.init.core.tc.address);
          const expected = getBigNumberFrom(collateralAmountNum, await r.init.sourceToken.decimals());

          expect(balanceCollateralAssetOnTetuConverter).eq(expected);
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
        setupTetuLiquidatorToSwapBorrowToCollateral: boolean = false,
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
          exactBorrowAmounts,
          receiver
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

      describe("Swap", () => {
// TODO
      });
    });
  });

  describe("repay", () => {
    interface IRepayBadPathParams {
      receiverIsNull?: boolean,
      userSendsNotEnoughAmountToTetuConverter?: boolean
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
    }
    async function makeRepayTest(
      collateralAmounts: number[],
      exactBorrowAmounts: number[],
      amountToRepayNum: number,
      setupTetuLiquidatorToSwapBorrowToCollateral: boolean = false,
      repayBadPathParams?: IRepayBadPathParams,
      priceImpact?: number,
    ) : Promise<IRepayResults> {
      const core = await CoreContracts.build(await TetuConverterApp.createController(deployer));
      const init = await prepareTetuAppWithMultipleLendingPlatforms(core,
        collateralAmounts.length,
        {
          setupTetuLiquidatorToSwapBorrowToCollateral,
          priceImpact
        }
      );
      const targetTokenDecimals = await init.targetToken.decimals();

      if (collateralAmounts.length) {
        await makeBorrow(
          init,
          collateralAmounts,
          BigNumber.from(100),
          BigNumber.from(100_000),
          exactBorrowAmounts
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

      await tcAsUc.repay(
        init.sourceToken.address,
        init.targetToken.address,
        amountToRepay,
        receiver
      );

      const receiverCollateralBalanceAfterRepay = receiver === Misc.ZERO_ADDRESS
        ? BigNumber.from(0)
        : await init.sourceToken.balanceOf(receiver);
      const receiverBorrowAssetBalanceAfterRepay = receiver === Misc.ZERO_ADDRESS
        ? BigNumber.from(0)
        : await init.targetToken.balanceOf(receiver);

      const borrowsAfterRepay = await core.dm.getPositions(init.userContract.address, init.sourceToken.address, init.targetToken.address);
      const {totalDebtAmountOut, totalCollateralAmountOut} = await tcAsUc.getDebtAmountStored(
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
        receiverBorrowAssetBalanceAfterRepay
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
        describe("Full repay", () => {
          it("should return expected values", async () => {
            const amountToRepay = 1600;
            const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
            const exactBorrowAmounts = [200, 400, 1000]; // sum == 1600
            const r = await makeRepayTest(
              collateralAmounts,
              exactBorrowAmounts,
              amountToRepay
            );

            const ret = [
              r.countOpenedPositions,
              r.totalDebtAmountOut.toString()
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              0,
              getBigNumberFrom(0, await r.init.targetToken.decimals())
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Full repay with swap", () => {
          it("should return expected values", async () => {
            const collateralAmounts = [1_000_000, 2_000_000, 3_000_000];
            const exactBorrowAmounts = [200, 400, 1000];
            const totalBorrowAmount = exactBorrowAmounts.reduce((prev, cur) => prev += cur, 0);
            const totalCollateralAmount = collateralAmounts.reduce((prev, cur) => prev += cur, 0);
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
          ).revertedWith("TC-1");
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
          ).revertedWith("TC-41"); // WRONG_AMOUNT_RECEIVED
        });
      });
    });
  });

  describe("requireRepay", () => {

    interface IRequireRepayBadPathParams {
      notKeeper?: boolean;
      sendIncorrectAmountToTetuConverter?: boolean;
      wrongResultHealthFactor?: boolean;
      sendCollateralAssetInsteadBorrowAssetToTetuConverter?: boolean;
      sendBorrowAssetInsteadCollateralAssetToTetuConverter?: boolean;
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
      borrowerRepaysUsingCollateral: boolean,
      amountToRepayCollateralAsset: BigNumber,
      amountToRepayBorrowAsset: BigNumber,
      repayBadPathParams?: IRequireRepayBadPathParams,
    ) {
      const divider = repayBadPathParams?.sendIncorrectAmountToTetuConverter ? 2 : 1;
      const amountUserSendsToTetuConverter = borrowerRepaysUsingCollateral
        ? amountToRepayCollateralAsset.div(divider)
        : amountToRepayBorrowAsset.div(divider);

      let isCollateral = borrowerRepaysUsingCollateral;
      let sendCollateral = borrowerRepaysUsingCollateral;
      if (repayBadPathParams?.sendBorrowAssetInsteadCollateralAssetToTetuConverter) {
        isCollateral = true;
        sendCollateral = false;
      } else if (repayBadPathParams?.sendCollateralAssetInsteadBorrowAssetToTetuConverter) {
        isCollateral = false;
        sendCollateral = true;
      }

      if (sendCollateral) {
        // user pays using collateral asset
        await init.sourceToken.mint(init.userContract.address, amountUserSendsToTetuConverter);
      } else {
        await init.targetToken.mint(init.userContract.address, amountUserSendsToTetuConverter);
      }

      await init.userContract.setUpRequireAmountBack(
        amountUserSendsToTetuConverter,
        isCollateral,
        sendCollateral
      );
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
        exactBorrowAmounts
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

      await setupBorrowerRequireAmountBackBehavior(
        init,
        repayAmounts.useCollateral,
        amountToRepayCollateralAsset,
        amountToRepayBorrowAsset,
        repayBadPathParams
      );

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
      } = await tcAsUc.getDebtAmountStored(init.sourceToken.address, init.targetToken.address);

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

        const exactBorrowAmountsSum = exactBorrowAmounts.reduce((prev, cur) => prev += cur, 0);
        const exactCollateralAmountsSum = collateralAmounts.reduce((prev, cur) => prev += cur, 0);

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

        const r = await makeRequireRepay(
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
          ).revertedWith("TC-42"); // KEEPER_ONLY
        });
      });
      describe("Try to make full repay", () => {
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(selectedPoolAdapterBorrow) // full repay
          ).revertedWith("TC-40"); // REPAY_TO_REBALANCE_NOT_ALLOWED
        });
      });
      describe("Try to repay too much", () => {
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(2 * selectedPoolAdapterBorrow)
          ).revertedWith("TC-40"); // REPAY_TO_REBALANCE_NOT_ALLOWED
        });
      });
      describe("Try to require zero amount of borrow asset", () => {
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(0)
          ).revertedWith("TC-29"); // INCORRECT_VALUE
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
          ).revertedWith("TC-41"); // WRONG_AMOUNT_RECEIVED
        });
      });
      describe("Send incorrect type of amount-to-repay to TetuConverter", () => {
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(
              correctAmountToRepay,
              {
                sendCollateralAssetInsteadBorrowAssetToTetuConverter: true
              }
            )
          ).revertedWith("TC-41"); // WRONG_AMOUNT_RECEIVED
        });
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(
              correctAmountToRepay,
              {
                sendBorrowAssetInsteadCollateralAssetToTetuConverter: true
              }
            )
          ).revertedWith("TC-41"); // WRONG_AMOUNT_RECEIVED
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
        } =(await tcAsUc.getDebtAmountStored(pr.sourceToken.address, pr.targetToken.address));

        const sret = [
          totalDebtAmountOut,
          totalCollateralAmountOut,
          ...borrows.map(x => x.status?.collateralAmount || 0)
        ].map(x => BalanceUtils.toString(x)).join("\n");
        const sexpected = [
          borrows.reduce(
            (prev, cur) => prev = prev.add(cur.status?.amountToPay || 0),
            BigNumber.from(0)
          ),
          collateralAmounts.reduce(
            (prev, cur) => prev = prev.add(
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
        exactBorrowAmounts
      );

      const tcAsUser = ITetuConverter__factory.connect(
        init.core.tc.address,
        await DeployerUtils.startImpersonate(init.userContract.address)
      );

      const {borrowAssetAmount, unobtainableCollateralAssetAmount} = await tcAsUser.estimateRepay(
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
          it("should return expected values", async () => {
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
          it("should return expected values", async () => {
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
      describe("Two pool adapters have rewards", () => {
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

          // enable swap
          await TetuLiquidatorMock__factory.connect(await core.controller.tetuLiquidator(), deployer).changePrices(
            [init.sourceToken.address, init.targetToken.address],
            [parseUnits("1"), parseUnits("2")]
          );

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
          ).to.emit(core.tc, "OnSwap").withArgs(
            init.userContract.address,
            await core.controller.swapManager(),
            init.targetToken.address,
            parseUnits("400", await init.targetToken.decimals()),
            init.sourceToken.address,
            parseUnits("800", await init.sourceToken.decimals()),
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
            false,
            false
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
//         ).revertedWith("TC-3: wrong health factor");
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