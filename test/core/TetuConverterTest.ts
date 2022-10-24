import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {
  BorrowManager,
  IERC20__factory,
  MockERC20,
  MockERC20__factory,
  TetuConverter,
  Borrower,
  PoolAdapterMock__factory,
  LendingPlatformMock__factory,
  BorrowManager__factory,
  IPoolAdapter__factory,
  IPoolAdapter,
  PoolAdapterMock,
  ITetuConverter__factory,
  TetuConverter__factory,
  SwapManager__factory, TetuLiquidatorMock__factory
} from "../../typechain";
import {
  IBorrowInputParams,
  BorrowManagerHelper,
  IPoolInstanceInfo,
  ITetuLiquidatorMockParams, ISwapManagerConfig
} from "../baseUT/helpers/BorrowManagerHelper";
import {CoreContracts} from "../baseUT/types/CoreContracts";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BalanceUtils, IContractToInvestigate} from "../baseUT/utils/BalanceUtils";
import {BigNumber} from "ethers";
import {Misc} from "../../scripts/utils/Misc";
import {IPoolAdapterStatus} from "../baseUT/types/BorrowRepayDataTypes";
import {tetu} from "../../typechain/contracts/integrations";
import exp from "constants";

describe("TetuConverterTest", () => {
//region Constants
  const BLOCKS_PER_DAY = 6456;
  const CONVERSION_MODE_AUTO = 0;
  const CONVERSION_MODE_SWAP = 1;
  const CONVERSION_MODE_BORROW = 2;
//endregion Constants

//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;
  let user5: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user1 = signers[2];
    user2 = signers[3];
    user3 = signers[4];
    user4 = signers[5];
    user5 = signers[6];
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
  /**
   * Create TetuConverter, register a pair of assets and N platform adapters to convert the asset pair.
   */
  async function createTetuConverter(
    tt: IBorrowInputParams
  ) : Promise<{
    tetuConveter: TetuConverter,
    sourceToken: MockERC20,
    targetToken: MockERC20,
    borrowManager: BorrowManager,
    pools: IPoolInstanceInfo[]
  }> {
    const {core, sourceToken, targetToken, pools} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(deployer, tt);

    const tetuConveter = await DeployUtils.deployContract(deployer
      , "TetuConverter", core.controller.address) as TetuConverter;

    return {tetuConveter, sourceToken, targetToken, borrowManager: core.bm, pools};
  }

  interface IPrepareResults {
    core: CoreContracts;
    pools: string[];
    cToken: string;
    userContract: Borrower;
    sourceToken: MockERC20;
    targetToken: MockERC20;
    poolAdapters: string[];
    platformAdapters: string[];
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
   */
  async function prepareContracts(
    tt: IBorrowInputParams,
    tetuAppSetupParams?: ISwapManagerConfig
  ) : Promise<IPrepareResults>{
    const periodInBlocks = 117;

    const {core, sourceToken, targetToken, pools} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(
      deployer,
      tt,
      async () => (await MocksHelper.createPoolAdapterMock(deployer)).address,
      tetuAppSetupParams
    );
    const userContract = await MocksHelper.deployBorrower(deployer.address, core.controller, periodInBlocks);
    const bmAsTc = BorrowManager__factory.connect(core.bm.address,
      await DeployerUtils.startImpersonate(core.tc.address)
    );

    let cToken: string | undefined;
    const poolAdapters: string[] = [];
    for (const pi of pools) {
      if (! cToken) {
        cToken = pi.asset2cTokens.get(sourceToken.address) || "";
      }

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
      poolAdapters.push(poolAdapter);
      console.log("poolAdapter-mock is configured:", poolAdapter, targetToken.address);
    }

    return {
      core,
      pools: pools.map(x => x.pool),
      cToken: cToken || "",
      userContract,
      sourceToken,
      targetToken,
      poolAdapters,
      platformAdapters: pools.map(x => x.platformAdapter)
    };
  }

  /** prepareContracts with sample assets settings and huge amounts of collateral and borrow assets */
  async function prepareTetuAppWithMultipleLendingPlatforms(
    countPlatforms: number,
    tetuAppSetupParams?: ISwapManagerConfig
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

    const r = await prepareContracts(tt, tetuAppSetupParams);

    // put a lot of collateral asset on user's balance
    await MockERC20__factory.connect(r.sourceToken.address, deployer).mint(
      r.userContract.address,
      initialCollateralAmount
    );

    // put a lot of borrow assets to pool-stubs
    for (const poolAddress of r.pools) {
      await MockERC20__factory.connect(r.targetToken.address, deployer)
        .mint(poolAddress, availableBorrowLiquidityPerPool);
    }

    return {
      core: r.core,
      sourceToken: r.sourceToken,
      targetToken: r.targetToken,
      pools: r.pools,
      initialCollateralAmount,
      availableBorrowLiquidityPerPool,
      poolAdapters: r.poolAdapters,
      userContract: r.userContract,
      borrowInputParams: tt,
      cToken: r.cToken,
      platformAdapters: r.platformAdapters
    }
  }
//endregion Initialization

//region Prepare borrows
  interface IBorrowStatus {
    poolAdapter: PoolAdapterMock;
    collateralAmount: BigNumber;
    amountToPay: BigNumber;
    healthFactor18: BigNumber;
  }

  /**
   *    Make a borrow in each pool adapter using provided collateral amount.
   * @param pp
   * @param collateralAmounts
   * @param bestBorrowRateInBorrowAsset
   * @param ordinalBorrowRateInBorrowAsset
   * @param exactBorrowAmounts
   * @param receiver
   */
  async function makeBorrows(
    pp: ISetupResults,
    collateralAmounts: number[],
    bestBorrowRateInBorrowAsset: BigNumber,
    ordinalBorrowRateInBorrowAsset: BigNumber,
    exactBorrowAmounts?: number[],
    receiver?: string
  ) : Promise<IBorrowStatus[]> {
    const dest: IBorrowStatus[] = [];
    const sourceTokenDecimals = await pp.sourceToken.decimals();
    const targetTokenDecimals = await pp.targetToken.decimals();

    // enumerate all pool adapters and make a borrow in each one
    for (let i = 0; i < pp.poolAdapters.length; ++i) {
      const selectedPoolAdapterAddress = pp.poolAdapters[i];
      const collateralAmount = getBigNumberFrom(collateralAmounts[i], sourceTokenDecimals);

      // set best borrow rate to the selected pool adapter
      // set ordinal borrow rate to others
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

      // ask TetuConverter to make a borrow
      // the pool adapter with best borrow rate will be selected
      if (exactBorrowAmounts) {
        await pp.userContract.borrowExactAmount(
          pp.sourceToken.address,
          collateralAmount,
          pp.targetToken.address,
          receiver || pp.userContract.address,
          getBigNumberFrom(exactBorrowAmounts[i], targetTokenDecimals)
        );
      } else {
        await pp.userContract.borrowMaxAmount(
          pp.sourceToken.address,
          collateralAmount,
          pp.targetToken.address,
          receiver || pp.userContract.address
        );
      }
    }

    // get final pool adapter statuses
    for (const poolAdapterAddress of pp.poolAdapters) {
      // check the borrow status
      const selectedPoolAdapter = PoolAdapterMock__factory.connect(poolAdapterAddress, deployer);
      const status = await selectedPoolAdapter.getStatus();

      dest.push({
        collateralAmount: status.collateralAmount,
        amountToPay: status.amountToPay,
        poolAdapter: selectedPoolAdapter,
        healthFactor18: status.healthFactor18
      });
    }

    return dest;
  }
//endregion Prepare borrows

//region Test impl
  interface IMakeReconversionResults {
    balancesInitial: Map<string, (BigNumber | string)[]>;
    balancesAfterBorrow: Map<string, (BigNumber | string)[]>;
    balancesAfterReconversion: Map<string, (BigNumber | string)[]>;
    pools: string[];
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

    const {core, pools, cToken, userContract, sourceToken, targetToken, poolAdapters, platformAdapters} =
      await prepareContracts(tt);

    console.log("cToken is", cToken);
    console.log("Pool adapters:", poolAdapters.join("\n"));
    console.log("Pools:", pools.join("\n"));

    const contractsToInvestigate: IContractToInvestigate[] = [
      {name: "userContract", contract: userContract.address},
      {name: "tc", contract: core.tc.address},
      ...pools.map((x, index) => ({name: `pool ${index}`, contract: x})),
      ...poolAdapters.map((x, index) => ({name: `PA ${index}`, contract: x})),
    ];
    const tokensToInvestigate = [sourceToken.address, targetToken.address, cToken];

    // initialize balances
    await MockERC20__factory.connect(sourceToken.address, deployer).mint(userContract.address, sourceAmount);
    for (const pool of pools) {
      await MockERC20__factory.connect(targetToken.address, deployer).mint(pool, availableBorrowLiquidity);
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
      const platformAdapter = await LendingPlatformMock__factory.connect(platformAdapters[i], deployer);
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
      pools,
      borrowsAfterBorrow,
      borrowsAfterReconversion,
    }
  }

//endregion Test impl

//region Unit tests
  describe("findBestConversionStrategy", () => {
    interface IFindConversionStrategyResults {
      converter: string;
      maxTargetAmount: BigNumber;
      aprForPeriod36: BigNumber;
    }
    interface IMakeFindConversionStrategyResults {
      init: ISetupResults;
      results: IFindConversionStrategyResults;
      /* Converter of the lending pool adapter */
      poolAdapterConverter: string;
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
      swapConfig?: ISwapManagerConfig
    ) : Promise<IMakeFindConversionStrategyResults> {
      const init = await prepareTetuAppWithMultipleLendingPlatforms(
        borrowRateNum ? 1: 0,
        swapConfig
      );

      if (borrowRateNum) {
        await PoolAdapterMock__factory.connect(
          init.poolAdapters[0],
          deployer
        ).changeBorrowRate(borrowRateNum);
        await LendingPlatformMock__factory.connect(
          init.platformAdapters[0],
          deployer
        ).changeBorrowRate(init.targetToken.address, borrowRateNum);
      }

      const results: IFindConversionStrategyResults = await init.core.tc.findConversionStrategy(
        init.sourceToken.address,
        getBigNumberFrom(sourceAmount, await init.sourceToken.decimals()),
        init.targetToken.address,
        periodInBlocks,
        conversionMode
      );

      const poolAdapterConverter = init.poolAdapters.length
        ? (await PoolAdapterMock__factory.connect(
          init.poolAdapters[0],
          deployer
        ).getConfig()).origin
        : Misc.ZERO_ADDRESS;

      return {
        init,
        results,
        poolAdapterConverter
      }
    }

    async function makeFindConversionStrategyTest(
      conversionMode: number,
      useLendingPool: boolean,
      useDexPool: boolean
    ) : Promise<IMakeFindConversionStrategyResults> {
      return makeFindConversionStrategy(
        1000,
        100,
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
            describe("APR of borrowing is lower", () => {
              it("should return borrowing-converter", async () => {
                expect.fail("TODO");
              });
            });
            describe("APR of swapping is lower", () => {
              it("should return swap-converter", async () => {
                expect.fail("TODO");
              });
            });
          });
        });
        describe("Conversion mode is SWAP", () => {
          describe("Neither borrowing no swap are available", () => {
            it("should return zero converter", async () => {
              expect.fail("TODO");
            });
          });
          describe("Only swap is available", () => {
            it("should return swap-converter", async () => {
              expect.fail("TODO");
            });
          });
          describe("Only borrowing is available", () => {
            it("should return zero converter", async () => {
              expect.fail("TODO");
            });
          });
          describe("Both borrowing and swap are available", () => {
            describe("APR of borrowing is lower", () => {
              it("should return swap-converter", async () => {
                expect.fail("TODO");
              });
            });
            describe("APR of swapping is lower", () => {
              it("should return swap-converter", async () => {
                expect.fail("TODO");
              });
            });
          });
        });
        describe("Conversion mode is BORROW", () => {
          describe("Neither borrowing no swap are available", () => {
            it("should return zero converter", async () => {
              expect.fail("TODO");
            });
          });
          describe("Only swap is available", () => {
            it("should return zero converter", async () => {
              expect.fail("TODO");
            });
          });
          describe("Only borrowing is available", () => {
            it("should return borrow-converter", async () => {
              expect.fail("TODO");
            });
          });
          describe("Both borrowing and swap are available", () => {
            describe("APR of borrowing is lower", () => {
              it("should return borrow-converter", async () => {
                expect.fail("TODO");
              });
            });
            describe("APR of swapping is lower", () => {
              it("should return borrow-converter", async () => {
                expect.fail("TODO");
              });
            });
          });
        });
      });

      describe("Single swap-converter", () => {
        it("should return expected values", async () => {
          const period = BLOCKS_PER_DAY * 31;
          const sourceAmountNum = 100_000;
          const priceImpact = 1_000; // 1%
          const r = await makeFindConversionStrategy(
            sourceAmountNum,
            period,
            CONVERSION_MODE_SWAP,
            undefined, // no lending platforms are available
            {
              priceImpact,
              setupTetuLiquidatorToSwapBorrowToCollateral: true
            }
          )
          const PRICE_IMPACT_NUMERATOR = (await r.init.core.swapManager.PRICE_IMPACT_NUMERATOR()).toNumber();
          const APR_NUMERATOR = (await r.init.core.swapManager.APR_NUMERATOR());

          const expectedTargetAmount =
            sourceAmountNum
            * r.init.borrowInputParams.priceSourceUSD
            / (r.init.borrowInputParams.priceTargetUSD)
            * (PRICE_IMPACT_NUMERATOR - priceImpact) / PRICE_IMPACT_NUMERATOR
          ;

          // The code from SwapManager.getConverter to calculate expectedApr36
          const tetuLiquidator = TetuLiquidatorMock__factory.connect(
            await r.init.core.controller.tetuLiquidator(),
            deployer
          );
          const returnAmount = await tetuLiquidator.getPrice(
            r.init.targetToken.address,
            r.init.sourceToken.address,
            r.results.maxTargetAmount
          );
          const sourceAmount = getBigNumberFrom(sourceAmountNum, await r.init.sourceToken.decimals());
          const loss = sourceAmount.sub(returnAmount);
          const expectedApr36 = loss.mul(APR_NUMERATOR).div(sourceAmount);

          const sret = [
            r.results.converter,
            r.results.maxTargetAmount,
            r.results.aprForPeriod36
          ].join("\n");

          const sexpected = [
            r.init.core.swapManager.address,
            getBigNumberFrom(expectedTargetAmount, await r.init.targetToken.decimals()),
            expectedApr36
          ].join("\n");

          expect(sret).equal(sexpected);
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
          const targetHealthFactor = await r.init.core.controller.targetHealthFactor2();

          const expectedTargetAmount =
            r.init.borrowInputParams.collateralFactor
            * sourceAmount * r.init.borrowInputParams.priceSourceUSD
            / (r.init.borrowInputParams.priceTargetUSD)
            / targetHealthFactor * 100;

          const sret = [
            r.results.converter,
            r.results.maxTargetAmount,
            r.results.aprForPeriod36
          ].join("\n");

          const sexpected = [
            r.poolAdapterConverter,
            getBigNumberFrom(expectedTargetAmount, await r.init.targetToken.decimals()),
            BigNumber.from(borrowRateNum)
              .mul(period)
              .mul(Misc.WEI_DOUBLE)
              .div(getBigNumberFrom(1, await r.init.targetToken.decimals()))
          ].join("\n");

          expect(sret).equal(sexpected);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Unsupported asset's pair", () => {
        it("should return 0", async () => {
          expect.fail();
        });
      });
      describe("Source amount is 0", () => {
        it("should return 0", async () => {
          expect.fail();
        });
      });
      describe("Period is 0", () => {
        it("should return 0", async () => {
          expect.fail();
        });
      });
      describe("Incorrect conversion mode", () => {
        it("should return 0", async () => {
          expect.fail();
        });
      });
    });
  });

  describe("borrow", () => {
    describe("Good paths", () => {
      describe("Convert using borrowing", () => {
        it("should return expected values", async () => {
          expect.fail("TODO");
        });
      });
      describe("Convert using swapping", () => {
        it("should return expected values", async () => {
          expect.fail("TODO");
        });
      });
    });
    describe("Bad paths", () => {
      describe("Converter is null", () => {
        it("should revert", async () => {
          expect.fail();
        });
      });
      describe("Converter is incorrect", () => {
        it("should revert", async () => {
          expect.fail();
        });
      });
      describe("Receiver is null", () => {
        it("should revert", async () => {
          expect.fail();
        });
      });
      describe("amount to borrow is 0", () => {
        it("should revert", async () => {
          expect.fail();
        });
      });
      describe("Collateral amount is 0", () => {
        it("should revert", async () => {
          expect.fail();
        });
      });
      describe("Converter returns incorrect conversion kind", () => {
        it("should return UNSUPPORTED_CONVERSION_KIND", async () => {
          expect.fail();
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

        const init = await prepareTetuAppWithMultipleLendingPlatforms(
          collateralAmounts.length,
          {
            setupTetuLiquidatorToSwapBorrowToCollateral
          }
        );

        const contractsToInvestigate: IContractToInvestigate[] = [
          {name: "userContract", contract: init.userContract.address},
          {name: "receiver", contract: receiver},
          {name: "pool", contract: init.pools[0]},
          {name: "tc", contract: init.core.tc.address},
          {name: "poolAdapter", contract: init.poolAdapters[0]},
        ];
        const tokensToInvestigate: string[] = [init.sourceToken.address, init.targetToken.address, init.cToken];

        // get balances before start
        const balancesBeforeBorrow = await BalanceUtils.getBalances(deployer, contractsToInvestigate, tokensToInvestigate);
        console.log("before", before);

        await makeBorrows(
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

              const {core, pools, cToken, userContract, sourceToken, targetToken, poolAdapters} =
                await prepareContracts(tt);
              const pool = pools[0];
              const poolAdapter = poolAdapters[0];

              const contractsToInvestigate: IContractToInvestigate[] = [
                {name: "userContract", contract: userContract.address},
                {name: "user", contract: user},
                {name: "pool", contract: pool},
                {name: "tc", contract: core.tc.address},
                {name: "poolAdapter", contract: poolAdapter},
              ];
              const tokensToInvestigate = [sourceToken.address, targetToken.address, cToken];

              // initialize balances
              await MockERC20__factory.connect(sourceToken.address, deployer)
                .mint(userContract.address, sourceAmount);
              await MockERC20__factory.connect(targetToken.address, deployer)
                .mint(pool, availableBorrowLiquidity);

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
      repayBadPathParams?: IRepayBadPathParams
    ) : Promise<IRepayResults> {
      const init = await prepareTetuAppWithMultipleLendingPlatforms(
        collateralAmounts.length,
        {
          setupTetuLiquidatorToSwapBorrowToCollateral
        }
      );
      const targetTokenDecimals = await init.targetToken.decimals();

      if (collateralAmounts.length) {
        await makeBorrows(
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

      const borrowsAfterRepay = await tcAsUc.findBorrows(init.sourceToken.address, init.targetToken.address);
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
            const amountToRepay = exactBorrowAmount + amountBorrowAssetToSwap;
            const r = await makeRepayTest(
              [initialCollateralAmount],
              [exactBorrowAmount],
              amountToRepay,
              true
            );

            const expectedCollateralAmountToReceive = getBigNumberFrom(
              initialCollateralAmount + amountBorrowAssetToSwap, // the prices are equal
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
            const amountToSwap = 170;
            const expectedCollateralAfterSwap = amountToSwap; // prices 1:1
            const amountToRepay = totalBorrowAmount + amountToSwap;
            const r = await makeRepayTest(
              collateralAmounts,
              exactBorrowAmounts,
              amountToRepay,
              true
            );

            const ret = [
              r.countOpenedPositions,
              r.totalDebtAmountOut.toString(),
              r.receiverCollateralBalanceAfterRepay.sub(r.receiverCollateralBalanceBeforeRepay),
              r.receiverBorrowAssetBalanceAfterRepay.sub(r.receiverBorrowAssetBalanceBeforeRepay)
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              0,
              getBigNumberFrom(0, await r.init.targetToken.decimals()),
              getBigNumberFrom(
                totalCollateralAmount + expectedCollateralAfterSwap,
                await r.init.sourceToken.decimals()
              ),
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
      notKeeper?: boolean,
      sendIncorrectAmountToTetuConverter?: boolean,
      wrongResultHealthFactor?: boolean
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
    async function makeRequireRepayTest(
      collateralAmounts: number[],
      exactBorrowAmounts: number[],
      amountToRepayNum: number,
      indexPoolAdapter: number,
      repayBadPathParams?: IRequireRepayBadPathParams,
      healthFactorsBeforeBorrow?: IHealthFactorParams,
      healthFactorsBeforeRepay?: IHealthFactorParams,
    ) : Promise<IRequireRepayResults> {
      const init = await prepareTetuAppWithMultipleLendingPlatforms(collateralAmounts.length);
      const targetTokenDecimals = await init.targetToken.decimals();

      if (healthFactorsBeforeBorrow) {
        await init.core.controller.setMaxHealthFactor2(healthFactorsBeforeBorrow.maxHealthFactor2);
        await init.core.controller.setTargetHealthFactor2(healthFactorsBeforeBorrow.targetHealthFactor2);
        await init.core.controller.setMinHealthFactor2(healthFactorsBeforeBorrow.minHealthFactor2);
      }

      // make borrows
      await makeBorrows(
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
      const amountToRepay = await getBigNumberFrom(amountToRepayNum, targetTokenDecimals);
      const amountUserSendsToTetuConverter = repayBadPathParams?.sendIncorrectAmountToTetuConverter
        ? amountToRepay.div(2)
        : amountToRepay;
      await init.targetToken.mint(init.userContract.address, amountUserSendsToTetuConverter);

      if (repayBadPathParams?.sendIncorrectAmountToTetuConverter) {
        // user will send less amount than required to TetuConverter
        await init.userContract.setAmountToSendOnRequireBorrowedAmountBack(amountUserSendsToTetuConverter);
      }
      const poolAdapterStatusBefore: IPoolAdapterStatus = await paAsUc.getStatus();
      console.log("poolAdapterStatusBefore", poolAdapterStatusBefore);
      await tcAsKeeper.requireRepay(
        amountToRepay,
        poolAdapter
      );

      const tcAsUc = ITetuConverter__factory.connect(
        init.core.tc.address,
        await DeployerUtils.startImpersonate(init.userContract.address)
      );

      const poolAdapterStatusAfter: IPoolAdapterStatus = await paAsUc.getStatus();
      console.log("poolAdapterStatusAfter", poolAdapterStatusAfter);

      const openedPositions = await tcAsUc.findBorrows(init.sourceToken.address, init.targetToken.address);
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
      it("should return expected values", async () => {
        const selectedPoolAdapterCollateral = 2_000_000;
        const selectedPoolAdapterBorrow = 250_000; // 2_000_000 * 0.5 / 4
        const collateralAmounts = [1_000_000, 1_500_000, selectedPoolAdapterCollateral];
        const exactBorrowAmounts = [100, 200, selectedPoolAdapterBorrow];
        const amountToRepay = 150_000;
        const poolAdapterIndex = 2;
        const exactBorrowAmountsSum = exactBorrowAmounts.reduce((prev, cur) => prev += cur, 0);
        const exactCollateralAmountsSum = collateralAmounts.reduce((prev, cur) => prev += cur, 0);

        const minHealthFactor2 = 400;
        const targetHealthFactor2 = 500;
        const maxHealthFactor2 = 1000;

        const r = await makeRequireRepayTest(
          collateralAmounts,
          exactBorrowAmounts,
          amountToRepay,
          poolAdapterIndex,
          undefined,
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
          getBigNumberFrom(exactBorrowAmountsSum-amountToRepay, targetDecimals),
          getBigNumberFrom(exactCollateralAmountsSum, sourceDecimals),

          getBigNumberFrom(selectedPoolAdapterBorrow, targetDecimals),
          getBigNumberFrom(selectedPoolAdapterCollateral, sourceDecimals),
          true,

          getBigNumberFrom(selectedPoolAdapterBorrow - amountToRepay, targetDecimals),
          getBigNumberFrom(selectedPoolAdapterCollateral, sourceDecimals),
          true,
        ].map(x => BalanceUtils.toString(x)).join("\n");

        expect(ret).eq(expected);
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

        const r = await makeRequireRepayTest(
          collateralAmounts,
          exactBorrowAmounts,
          amountToRepay,
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
      describe("Try to repay zero", () => {
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
      describe("Result health factor is too big", () => {
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(
              180_000
            )
          ).revertedWith("TC-39"); // WRONG_REBALANCING
        });
      });
      describe("Result health factor is too small", () => {
        it("should revert", async () => {
          await expect(
            tryToRepayWrongAmount(
              100_000
            )
          ).revertedWith("TC-39"); // WRONG_REBALANCING
        });
      });
    });
  });

  describe("requireAdditionalBorrow", () => {
    interface ITestResults {
      userContract: Borrower;
      borrowedAmount: BigNumber;
      expectedBorrowAmount: BigNumber;
      poolAdapter: string;
      targetHealthFactor2: number;
      userContractBalanceBorrowAssetAfterBorrow: BigNumber;
      userContractFinalBalanceBorrowAsset: BigNumber;
    }
    /**
     * Make borrow, reduce all health factors twice, make additional borrow of the same amount
     */
    async function makeTest(amountTestCorrectionFactor: number = 1) : Promise<ITestResults> {
      // prepare app
      const targetDecimals = 6;

      const collateralFactor = 0.5;
      const sourceAmountNumber = 100_000;
      const minHealthFactorInitial2 = 1000;
      const targetHealthFactorInitial2 = 2000;
      const maxHealthFactorInitial2 = 4000;
      const minHealthFactorUpdated2 = 500;
      const targetHealthFactorUpdated2 = 1000;
      const maxHealthFactorUpdated2 = 2000;

      const expectedBorrowAmount = getBigNumberFrom(
        sourceAmountNumber * collateralFactor * 100 / targetHealthFactorInitial2, // == 2500
        targetDecimals
      );

      const availableBorrowLiquidityNumber = 200_000_000;
      const tt: IBorrowInputParams = {
        collateralFactor,
        priceSourceUSD: 1,
        priceTargetUSD: 1,
        sourceDecimals: 18,
        targetDecimals,
        availablePools: [{   // source, target
          borrowRateInTokens: [BigNumber.from(0), BigNumber.from(0)],
          availableLiquidityInTokens: [0, availableBorrowLiquidityNumber]
        }]
      };
      const collateralAmount = getBigNumberFrom(sourceAmountNumber, tt.sourceDecimals);
      const availableBorrowLiquidity = getBigNumberFrom(availableBorrowLiquidityNumber, targetDecimals);

      const {core, pools, userContract, sourceToken, targetToken, poolAdapters} = await prepareContracts(tt);
      const pool = pools[0];
      const poolAdapter = poolAdapters[0];

      // initialize balances
      await MockERC20__factory.connect(sourceToken.address, deployer).mint(userContract.address, collateralAmount);
      await MockERC20__factory.connect(targetToken.address, deployer).mint(pool, availableBorrowLiquidity);

      // setup high values for all health factors
      await core.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
      await core.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
      await core.controller.setMinHealthFactor2(minHealthFactorInitial2);

      // make borrow
      await userContract.borrowMaxAmount(
        sourceToken.address,
        collateralAmount,
        targetToken.address,
        userContract.address // receiver
      );
      const borrowedAmount = await userContract.totalBorrowedAmount();
      const userContractBalanceBorrowAssetAfterBorrow = await targetToken.balanceOf(userContract.address);

      // reduce all health factors down on 2 times to have possibility for additional borrow
      await core.controller.setMinHealthFactor2(minHealthFactorUpdated2);
      await core.controller.setTargetHealthFactor2(targetHealthFactorUpdated2);
      await core.controller.setMaxHealthFactor2(maxHealthFactorUpdated2);

      // make additional borrow
      // health factors were reduced twice, so we should be able to borrow same amount as before
      const tcAsKeeper = TetuConverter__factory.connect(
        core.tc.address,
        await DeployerUtils.startImpersonate(await core.controller.keeper())
      );
      await tcAsKeeper.requireAdditionalBorrow(
        borrowedAmount.mul(100 * amountTestCorrectionFactor).div(100),
        poolAdapter
      );

      return {
        poolAdapter,
        borrowedAmount,
        expectedBorrowAmount,
        userContract,
        targetHealthFactor2: targetHealthFactorUpdated2,
        userContractBalanceBorrowAssetAfterBorrow,
        userContractFinalBalanceBorrowAsset: await targetToken.balanceOf(userContract.address)
      }
    }
    describe("Good paths", () => {
      describe("Borrow exact expected amount", () => {
        let testResults: ITestResults;
        before(async function () {
          testResults = await makeTest();
        })
        describe("Make borrow, change health factors, make additional borrow", async () => {
          it("should return expected borrowed amount", async () => {
            const ret = testResults.borrowedAmount.eq(testResults.expectedBorrowAmount);
            expect(ret).eq(true);
          });
          it("pool adapter should have expected health factor", async () => {
            const poolAdapter = IPoolAdapter__factory.connect(testResults.poolAdapter, deployer);
            const poolAdapterStatus = await poolAdapter.getStatus();
            const ret = poolAdapterStatus.healthFactor18.div(getBigNumberFrom(1, 16)).toNumber();
            const expected = testResults.targetHealthFactor2;
            expect(ret).eq(expected);
          });
          it("should send notification to user-contract", async () => {
            const config = await IPoolAdapter__factory.connect(testResults.poolAdapter, deployer).getConfig();
            const ret = [
              (await testResults.userContract.onTransferBorrowedAmountLastResultBorrowAsset()).toString(),
              (await testResults.userContract.onTransferBorrowedAmountLastResultCollateralAsset()).toString(),
              (await testResults.userContract.onTransferBorrowedAmountLastResultAmountBorrowAssetSentToBorrower()).toString(),
            ].join();
            const expected = [
              config.borrowAsset,
              config.collateralAsset,
              testResults.expectedBorrowAmount.toString()
            ].join();
            expect(ret).eq(expected);
          });
          it("should send expected amount on balance of the user-contract", async () => {
            const ret = [
              (await testResults.userContractBalanceBorrowAssetAfterBorrow).toString(),
              (await testResults.userContractFinalBalanceBorrowAsset).toString(),
            ].join();
            const expected = [
              testResults.expectedBorrowAmount.toString(),
              testResults.expectedBorrowAmount.mul(2).toString()
            ].join();
            expect(ret).eq(expected);
          });
        });
      });
      describe('Borrow approx amount, difference is allowed', function () {
        it('should not revert', async () => {
          await makeTest(0.99);
          expect(true).eq(true); // no exception above
        });
        it('should not revert', async () => {
          await makeTest(1.01);
          expect(true).eq(true); // no exception above
        });
      });
    });
    describe("Bad paths", () => {
      describe("Rebalancing put health factor down too much", () => {
        it("should revert", async () => {
          await expect(
            makeTest(
            5 // we try to borrow too big additional amount = 5 * borrowedAmount (!)
            )
          ).revertedWith("TC-3: wrong health factor");
        });
      });
      describe("Rebalancing put health factor down not enough", () => {
        it("should revert", async () => {
          await expect(
            makeTest(
              0.1 // we try to borrow too small additional amount = 0.1 * borrowedAmount (!)
            )
          ).revertedWith("");
        });
      });
    });
  });

  describe("getDebtAmountStored", () => {
    describe("Good paths", () => {
      async function makeGetDebtAmountTest(collateralAmounts: number[]) : Promise<{sret: string, sexpected: string}> {
        const pr = await prepareTetuAppWithMultipleLendingPlatforms(collateralAmounts.length);
        const sourceTokenDecimals = await pr.sourceToken.decimals();
        const borrows: IBorrowStatus[] = await makeBorrows(
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
          ...borrows.map(x => x.collateralAmount)
        ].map(x => BalanceUtils.toString(x)).join("\n");
        const sexpected = [
          borrows.reduce(
            (prev, cur) => prev = prev.add(cur.amountToPay),
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
      const init = await prepareTetuAppWithMultipleLendingPlatforms(collateralAmounts.length);
      const collateralTokenDecimals = await init.sourceToken.decimals();

      await makeBorrows(
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

  describe("TODO:claimRewards", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      it("should revert", async () => {
        expect.fail("TODO");
      });
    });
  });

  describe("TODO:findBorrows", () => {
    describe("Good paths", () => {
      describe("TODO", () => {
        it("should update balance in proper way", async () => {
          expect.fail();
        });
      });
    });

    describe("Bad paths", () => {
      describe("TODO", () => {
        it("TODO", async () => {
          expect.fail();
        });
      });
    });
  });

  describe("TODO:requireReconversion", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      it("should revert", async () => {
        expect.fail("TODO");
      });
    });
  });
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

//endregion Unit tests
});