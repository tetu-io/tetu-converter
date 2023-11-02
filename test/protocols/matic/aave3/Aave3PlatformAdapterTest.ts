import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {Aave3Helper, IAave3ReserveInfo} from "../../../../scripts/integration/aave3/Aave3Helper";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {AprUtils, COUNT_BLOCKS_PER_DAY} from "../../../baseUT/utils/aprUtils";
import {areAlmostEqual} from "../../../baseUT/utils/CommonUtils";
import {PredictBrUsesCase} from "../../../baseUT/uses-cases/shared/PredictBrUsesCase";
import {AprAave3, getAave3StateInfo, IAave3StateInfo, IAaveReserveData} from "../../../baseUT/protocols/aave3/aprAave3";
import {Misc} from "../../../../scripts/utils/Misc";
import {convertUnits} from "../../../baseUT/protocols/shared/aprUtils";
import {Aave3Utils} from "../../../baseUT/protocols/aave3/Aave3Utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {Aave3ChangePricesUtils} from "../../../baseUT/protocols/aave3/Aave3ChangePricesUtils";
import {
  BASE_NETWORK_ID,
  controlGasLimitsEx2,
  HardhatUtils,
  POLYGON_NETWORK_ID
} from "../../../../scripts/utils/HardhatUtils";
import {GAS_LIMIT, GAS_LIMIT_AAVE_3_GET_CONVERSION_PLAN} from "../../../baseUT/types/GasLimit";
import {AppConstants} from "../../../baseUT/types/AppConstants";
import {ICoreAave3} from "../../../baseUT/protocols/aave3/Aave3DataTypes";
import {IConversionPlan} from "../../../baseUT/types/AppDataTypes";
import {TetuConverterApp} from "../../../baseUT/app/TetuConverterApp";
import {AdaptersHelper} from "../../../baseUT/app/AdaptersHelper";
import {MaticCore} from "../../../baseUT/chains/polygon/maticCore";
import {MocksHelper} from "../../../baseUT/app/MocksHelper";
import {Aave3PlatformActor} from "../../../baseUT/protocols/aave3/Aave3PlatformActor";
import {
  Aave3PlatformAdapter,
  Aave3PlatformAdapter__factory,
  BorrowManager__factory,
  ConverterController,
  IAavePool, IERC20Metadata__factory
} from "../../../../typechain";
import {BaseCore} from "../../../baseUT/chains/base/baseCore";

describe("Aave3PlatformAdapterTest", () => {
//region Test setup
  interface IPairToBorrow {
    collateralAsset: string;
    borrowAsset: string;
    collateralAssetName: string;
    borrowAssetName: string;
    amount: string;
    tag?: string;
    highEfficientMode?: boolean; // false by default
  }

  interface ISinglePair {
    collateralAsset: string;
    borrowAsset: string;
    collateralAssetName: string;
    borrowAssetName: string;
    amount: string;
    smallAmount: string;
    hugeAmount: string;
    collateralHolders: string[];
    tag?: string;
  }

  interface ITestSetup {
    aavePool: string;
    pair: ISinglePair;
    pairStable?: ISinglePair;
    pairsToBorrowNormalMode: IPairToBorrow[];
    pairsToBorrowIsolationMode: IPairToBorrow[];
    pairsToBorrowEMode: IPairToBorrow[];
    pairsToBorrowNotUsable: IPairToBorrow[];
  }

  const NETWORKS = [POLYGON_NETWORK_ID, BASE_NETWORK_ID];
  const TEST_SETUPS: Record<number, ITestSetup> = {
    [POLYGON_NETWORK_ID]: {
      aavePool: MaticAddresses.AAVE_V3_POOL,
      pairsToBorrowNormalMode: [
        {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.WMATIC, amount: "1000", collateralAssetName: "DAI", borrowAssetName: "WMATIC"},
        {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.USDC, amount: "1000", collateralAssetName: "DAI", borrowAssetName: "USDC", highEfficientMode: true},
        {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.WBTC, amount: "1000", collateralAssetName: "USDC", borrowAssetName: "WBTC"},
        {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.USDT, amount: "1000", collateralAssetName: "USDC", borrowAssetName: "USDT", highEfficientMode: true},
      ],
      pairsToBorrowIsolationMode: [
        {collateralAsset: MaticAddresses.EURS, borrowAsset: MaticAddresses.USDT, amount: "1000", collateralAssetName: "EURS", borrowAssetName: "USDT", highEfficientMode: true}
      ],
      pairsToBorrowEMode: [
        {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.USDC, amount: "1000", collateralAssetName: "DAI", borrowAssetName: "USDC", highEfficientMode: true},
      ],
      pairsToBorrowNotUsable: [
        // AaveToken has borrowing = FALSE
        {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.AaveToken, amount: "1000", collateralAssetName: "DAI", borrowAssetName: "AaveToken", tag: "borrow asset is not borrowable"},
        // agEUR has liquidation threshold = 0, it means, it cannot be used as collateral
        {collateralAsset: MaticAddresses.agEUR, borrowAsset: MaticAddresses.USDC, amount: "1000", collateralAssetName: "agEUR", borrowAssetName: "USDC", tag: "collateral asset is not usable as collateral"},
        // EURS has not zero isolationModeTotalDebtm, SUSHI has "borrowable in isolation mode" = FALSE
        {collateralAsset: MaticAddresses.EURS, borrowAsset: MaticAddresses.SUSHI, amount: "1000", collateralAssetName: "EURS", borrowAssetName: "SUSHI", tag: "isolation mode is enabled for collateral, borrow token is not borrowable in isolation mode"},
      ],
      pair: {
        collateralAsset: MaticAddresses.DAI,
        borrowAsset: MaticAddresses.WMATIC,
        collateralAssetName: "DAI",
        borrowAssetName: "WMATIC",
        smallAmount: "1",
        amount: "100",
        hugeAmount: "100000000",
        collateralHolders: [
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.HOLDER_DAI_2,
          MaticAddresses.HOLDER_DAI_3,
          MaticAddresses.HOLDER_DAI_4,
          MaticAddresses.HOLDER_DAI_5,
          MaticAddresses.HOLDER_DAI_6,
        ]
      },
      pairStable: {
        collateralAsset: MaticAddresses.USDC,
        borrowAsset: MaticAddresses.USDT,
        collateralAssetName: "USDC",
        borrowAssetName: "USDT",
        smallAmount: "1",
        amount: "100",
        hugeAmount: "100000000",
        collateralHolders: [
          MaticAddresses.HOLDER_USDC,
          MaticAddresses.HOLDER_USDC_2,
          MaticAddresses.HOLDER_USDC_3,
        ]
      }
    }
  }

//endregion Test setup

//region Unit tests
  NETWORKS.forEach(function (networkId: number) {
    describe(`${networkId}`, function () {
      [TEST_SETUPS[networkId]].forEach(function (testSetup: ITestSetup) {
        if (testSetup) {
          let snapshot: string;
          let snapshotForEach: string;
          let deployer: SignerWithAddress;
          let controller: ConverterController;
          let templateAdapterNormal: string;
          let templateAdapterEMode: string;
          let aavePool: IAavePool;
          let aavePlatformAdapter: Aave3PlatformAdapter;
          let core: ICoreAave3;

          before(async function () {
            await HardhatUtils.setupBeforeTest(networkId);
            this.timeout(1200000);
            snapshot = await TimeUtils.snapshot();
            const signers = await ethers.getSigners();
            deployer = signers[0];

            controller = await TetuConverterApp.createController(deployer, {networkId,});

            templateAdapterNormal = ethers.Wallet.createRandom().address;
            templateAdapterEMode = ethers.Wallet.createRandom().address;
            aavePool = await Aave3Helper.getAavePool(deployer, testSetup.aavePool);

            aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
              deployer,
              controller.address,
              aavePool.address,
              templateAdapterNormal,
              templateAdapterEMode,
              await controller.borrowManager()
            );

            if (networkId === POLYGON_NETWORK_ID) {
              core = MaticCore.getCoreAave3();
            } else {
              core = BaseCore.getCoreAave3();
            }
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


          describe("constructor and converters()", () => {
            interface IContractsSet {
              controller: string;
              templateAdapterNormal: string;
              templateAdapterEMode: string;
              aavePool: string;
            }

            interface ICreateContractsSetBadParams {
              zeroController?: boolean;
              zeroTemplateAdapterNormal?: boolean;
              zeroTemplateAdapterEMode?: boolean;
              zeroAavePool?: boolean;
            }

            async function initializePlatformAdapter(
              badPaths?: ICreateContractsSetBadParams
            ): Promise<{ data: IContractsSet, platformAdapter: Aave3PlatformAdapter }> {
              const templateAdapterNormalStub = ethers.Wallet.createRandom();
              const templateAdapterEModeStub = ethers.Wallet.createRandom();

              const data: IContractsSet = {
                controller: badPaths?.zeroController ? Misc.ZERO_ADDRESS : controller.address,
                aavePool: badPaths?.zeroAavePool ? Misc.ZERO_ADDRESS : testSetup.aavePool,
                templateAdapterEMode: badPaths?.zeroTemplateAdapterEMode ? Misc.ZERO_ADDRESS : templateAdapterEModeStub.address,
                templateAdapterNormal: badPaths?.zeroTemplateAdapterNormal ? Misc.ZERO_ADDRESS : templateAdapterNormalStub.address
              }
              const platformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
                deployer,
                data.controller,
                data.aavePool,
                data.templateAdapterNormal,
                data.templateAdapterEMode,
                await controller.borrowManager()
              );
              return {data, platformAdapter};
            }

            describe("Good paths", () => {
              it("should return expected values", async () => {
                const r = await initializePlatformAdapter();

                const ret = [
                  await r.platformAdapter.controller(),
                  await r.platformAdapter.pool(),
                  await r.platformAdapter.converterNormal(),
                  await r.platformAdapter.converterEMode(),
                  (await r.platformAdapter.converters()).join()
                ].join();
                const expected = [
                  r.data.controller,
                  r.data.aavePool,
                  r.data.templateAdapterNormal,
                  r.data.templateAdapterEMode,
                  [r.data.templateAdapterNormal, r.data.templateAdapterEMode].join()
                ].join();

                expect(ret).eq(expected);
              });
            });
            describe("Bad paths", () => {
              it("should revert if aave-pool is zero", async () => {
                await expect(
                  initializePlatformAdapter({zeroAavePool: true})
                ).revertedWith("TC-1 zero address");
              });
              it("should revert if controller is zero", async () => {
                await expect(
                  initializePlatformAdapter({zeroController: true})
                ).revertedWith("TC-1 zero address");
              });
              it("should revert if template normal is zero", async () => {
                await expect(
                  initializePlatformAdapter({zeroTemplateAdapterNormal: true})
                ).revertedWith("TC-1 zero address");
              });
              it("should revert if template emode is zero", async () => {
                await expect(
                  initializePlatformAdapter({zeroTemplateAdapterEMode: true})
                ).revertedWith("TC-1 zero address");
              });
            });
          });

          describe("getConversionPlan", () => {
            let snapshotLocal: string;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });

            interface IGetConversionPlanBadPaths {
              zeroCollateralAsset?: boolean;
              zeroBorrowAsset?: boolean;
              zeroCountBlocks?: boolean;
              zeroAmountIn?: boolean;
              incorrectHealthFactor2?: number;
              makeCollateralAssetPaused?: boolean;
              makeBorrowAssetPaused?: boolean;
              makeCollateralAssetFrozen?: boolean;
              makeBorrowAssetFrozen?: boolean;
              /* Set supply cap equal almost to current total supply value */
              setMinSupplyCap?: boolean;
              /* Set borrow cap equal almost to current total borrow value */
              setMinBorrowCap?: boolean;
              setZeroSupplyCap?: boolean;
              setZeroBorrowCap?: boolean;
              frozen?: boolean;
            }

            interface IPreparePlanResults {
              plan: IConversionPlan;
              healthFactor2: number;
              priceCollateral: BigNumber;
              priceBorrow: BigNumber;
              aavePool: IAavePool;
              borrowReserveData: IAaveReserveData;
              collateralReserveData: IAaveReserveData;
              collateralAssetData: IAave3ReserveInfo;
              borrowAssetData: IAave3ReserveInfo;
              before: IAave3StateInfo;
              blockTimeStamp: number;
            }

            async function preparePlan(
              collateralAsset: string,
              amountIn: BigNumber,
              borrowAsset: string,
              countBlocks: number = 10,
              badPathsParams?: IGetConversionPlanBadPaths,
              entryData?: string
            ): Promise<IPreparePlanResults> {
              const h = new Aave3Helper(deployer, testSetup.aavePool);
              const healthFactor2 = badPathsParams?.incorrectHealthFactor2 || 200;

              const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer, testSetup.aavePool);
              const block = await hre.ethers.provider.getBlock("latest");
              const before = await getAave3StateInfo(deployer, aavePool, dp, collateralAsset, borrowAsset);

              if (badPathsParams?.makeBorrowAssetPaused) {
                await Aave3ChangePricesUtils.setReservePaused(deployer, core, borrowAsset);
              }
              if (badPathsParams?.makeCollateralAssetPaused) {
                await Aave3ChangePricesUtils.setReservePaused(deployer, core, collateralAsset);
              }
              if (badPathsParams?.makeBorrowAssetFrozen) {
                await Aave3ChangePricesUtils.setReserveFreeze(deployer, core, borrowAsset);
              }
              if (badPathsParams?.makeCollateralAssetFrozen) {
                await Aave3ChangePricesUtils.setReserveFreeze(deployer, core, collateralAsset);
              }
              if (badPathsParams?.setMinSupplyCap) {
                await Aave3ChangePricesUtils.setSupplyCap(deployer, core, collateralAsset);
              }
              if (badPathsParams?.setMinBorrowCap) {
                await Aave3ChangePricesUtils.setBorrowCap(deployer, core, borrowAsset);
              }
              if (badPathsParams?.setZeroSupplyCap) {
                await Aave3ChangePricesUtils.setSupplyCap(deployer, core, collateralAsset, BigNumber.from(0));
              }
              if (badPathsParams?.setZeroBorrowCap) {
                await Aave3ChangePricesUtils.setBorrowCap(deployer, core, borrowAsset, BigNumber.from(0));
              }
              if (badPathsParams?.frozen) {
                await aavePlatformAdapter.setFrozen(true);
              }
              // get conversion plan
              const plan: IConversionPlan = await aavePlatformAdapter.getConversionPlan(
                {
                  collateralAsset: badPathsParams?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
                  amountIn: badPathsParams?.zeroAmountIn ? 0 : amountIn,
                  borrowAsset: badPathsParams?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
                  countBlocks: badPathsParams?.zeroCountBlocks ? 0 : countBlocks,
                  entryData: entryData || "0x",
                },
                healthFactor2,
                {gasLimit: GAS_LIMIT}
              );

              const prices = await (await Aave3Helper.getAavePriceOracle(deployer, testSetup.aavePool)).getAssetsPrices([collateralAsset, borrowAsset]);
              return {
                plan,
                aavePool,
                borrowAssetData: await h.getReserveInfo(deployer, aavePool, dp, borrowAsset),
                collateralAssetData: await h.getReserveInfo(deployer, aavePool, dp, collateralAsset),
                borrowReserveData: await dp.getReserveData(borrowAsset),
                collateralReserveData: await dp.getReserveData(collateralAsset),
                healthFactor2,
                priceCollateral: prices[0],
                priceBorrow: prices[1],
                before,
                blockTimeStamp: block.timestamp
              }
            }

            async function makeGetConversionPlanTest(
              collateralAsset: string,
              collateralAmount: BigNumber,
              borrowAsset: string,
              highEfficientModeEnabled: boolean,
              countBlocks: number = 10,
              badPathsParams?: IGetConversionPlanBadPaths,
              entryData?: string,
              expectEmptyPlan: boolean = false
            ): Promise<{ sret: string, sexpected: string }> {
              const d = await preparePlan(
                collateralAsset,
                collateralAmount,
                borrowAsset,
                countBlocks,
                badPathsParams,
                entryData
              );
              console.log("Plan", d.plan);

              let borrowAmount = AprUtils.getBorrowAmount(
                collateralAmount,
                d.healthFactor2,
                d.plan.liquidationThreshold18,
                d.priceCollateral,
                d.priceBorrow,
                d.collateralAssetData.data.decimals,
                d.borrowAssetData.data.decimals
              );

              if (borrowAmount.gt(d.plan.maxAmountToBorrow)) {
                borrowAmount = d.plan.maxAmountToBorrow;
              }

              const amountCollateralInBorrowAsset36 = convertUnits(collateralAmount,
                d.priceCollateral,
                d.collateralAssetData.data.decimals,
                d.priceBorrow,
                36
              );

              // calculate expected supply and borrow values
              const predictedSupplyIncomeInBorrowAssetRay = await AprAave3.predictSupplyIncomeRays(
                deployer,
                core,
                d.aavePool,
                collateralAsset,
                collateralAmount,
                borrowAsset,
                countBlocks,
                COUNT_BLOCKS_PER_DAY,
                d.collateralReserveData,
                d.before,
                d.blockTimeStamp,
              );

              const predictedBorrowCostInBorrowAssetRay = await AprAave3.predictBorrowAprRays(
                deployer,
                core,
                d.aavePool,
                collateralAsset,
                borrowAsset,
                borrowAmount,
                countBlocks,
                COUNT_BLOCKS_PER_DAY,
                d.borrowReserveData,
                d.before,
                d.blockTimeStamp,
              );

              const sret = [
                d.plan.borrowCost36,
                d.plan.supplyIncomeInBorrowAsset36,
                d.plan.rewardsAmountInBorrowAsset36,
                d.plan.ltv18,
                d.plan.liquidationThreshold18,

                d.plan.maxAmountToBorrow,
                d.plan.maxAmountToSupply,

                !d.plan.borrowCost36.eq(0),
                !d.plan.supplyIncomeInBorrowAsset36.eq(0),

                d.plan.amountToBorrow,
                d.plan.collateralAmount,

                // we lost precision a bit in USDC : WBTC, so almost equal only
                areAlmostEqual(d.plan.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36),

                // ensure that high efficiency mode is not available
                highEfficientModeEnabled
                  ? d.collateralAssetData.data.emodeCategory !== 0
                  && d.borrowAssetData.data.emodeCategory === d.collateralAssetData.data.emodeCategory
                  : d.collateralAssetData.data.emodeCategory !== d.borrowAssetData.data.emodeCategory,
              ].map(x => BalanceUtils.toString(x)).join("\n");

              const expectedMaxAmountToBorrow = await Aave3Utils.getMaxAmountToBorrow(d.borrowAssetData, d.collateralAssetData);
              const expectedMaxAmountToSupply = await Aave3Utils.getMaxAmountToSupply(deployer, d.collateralAssetData);

              const emptyPlan = expectEmptyPlan
                && !d.collateralAssetData.data.debtCeiling.eq(0)
                && d.collateralAssetData.data.debtCeiling.lt(d.collateralAssetData.data.isolationModeTotalDebt);

              // if vars.rcDebtCeiling < vars.rc.isolationModeTotalDebt in isolation mode,
              // the borrow is not possible. Currently, there is such situation with EURO. It can be changed later.
              // The test handles both cases (it's not good, we need two different tests, but it's too hard to reproduce
              // required situations in test)
              const sexpected = (emptyPlan
                  ? [0, 0, 0, 0, 0, 0, 0, false, false, 0, 0, false, true]
                  : [
                    predictedBorrowCostInBorrowAssetRay,
                    predictedSupplyIncomeInBorrowAssetRay,
                    0,

                    // ltv18
                    BigNumber.from(
                      highEfficientModeEnabled
                        ? d.collateralAssetData.category?.ltv
                        : d.collateralAssetData.data.ltv
                    ).mul(Misc.WEI).div(getBigNumberFrom(1, 4)),

                    // liquidationThreshold18
                    BigNumber.from(
                      highEfficientModeEnabled
                        ? d.collateralAssetData.category?.liquidationThreshold
                        : d.collateralAssetData.data.liquidationThreshold
                    ).mul(Misc.WEI).div(getBigNumberFrom(1, 4)),

                    expectedMaxAmountToBorrow,
                    expectedMaxAmountToSupply,

                    true, // borrow APR is not 0
                    true, // supply APR is not 0

                    borrowAmount,
                    collateralAmount,

                    true,
                    true,
                  ]
              ).map(x => BalanceUtils.toString(x)).join("\n");

              return {sret, sexpected};
            }

            describe("Good paths", () => {
              describe("Normal mode", () => {
                testSetup.pairsToBorrowNormalMode.forEach(function (pair: IPairToBorrow) {
                  it(`should return expected values for ${pair.collateralAssetName}:${pair.borrowAssetName}`, async () => {
                    const r = await makeGetConversionPlanTest(
                      pair.collateralAsset,
                      parseUnits(pair.amount, await IERC20Metadata__factory.connect(pair.collateralAsset, deployer).decimals()),
                      pair.borrowAsset,
                      pair.highEfficientMode ?? false,
                    );

                    expect(r.sret).eq(r.sexpected);
                  });
                });
              });
              describe("Isolation mode is enabled for collateral, borrow token is borrowable in isolation mode", () => {
                testSetup.pairsToBorrowIsolationMode.forEach(function (pair: IPairToBorrow) {
                  /** Currently vars.rcDebtCeiling < vars.rc.isolationModeTotalDebt, so new borrows are not possible */
                  it(`should return expected values for ${pair.collateralAssetName}:${pair.borrowAssetName}`, async () => {
                    const r = await makeGetConversionPlanTest(
                      pair.collateralAsset,
                      parseUnits(pair.amount, await IERC20Metadata__factory.connect(pair.collateralAsset, deployer).decimals()),
                      pair.borrowAsset,
                      pair.highEfficientMode ?? false,
                      10,
                      undefined,
                      "0x",

                      // Currently vars.rcDebtCeiling < vars.rc.isolationModeTotalDebt, so new borrows are not possible
                      // we expect to receive empty plan. It depends on block. The situation can change in the future
                      // and it will be necessary to reproduce the situation {vars.rcDebtCeiling < vars.rc.isolationModeTotalDebt}
                      // manually. SO this is potentially blinking test. But we need this test to improve the coverage.
                      true
                    );

                    expect(r.sret).eq(r.sexpected);
                  });
                });
              });

              describe("Two assets from same category", () => {
                testSetup.pairsToBorrowEMode.forEach(function (pair: IPairToBorrow) {
                  it(`should return expected values for ${pair.collateralAssetName}:${pair.borrowAssetName}`, async () => {
                    const r = await makeGetConversionPlanTest(
                      pair.collateralAsset,
                      parseUnits(pair.amount, await IERC20Metadata__factory.connect(pair.collateralAsset, deployer).decimals()),
                      pair.borrowAsset,
                      true,
                    );

                    expect(r.sret).eq(r.sexpected);
                  });
                });
              });
              describe("Frozen", () => {
                it("should return no plan", async () => {
                  const r = await preparePlan(
                    testSetup.pair.collateralAsset,
                    parseUnits(testSetup.pair.amount, await IERC20Metadata__factory.connect(testSetup.pair.collateralAsset, deployer).decimals()),
                    testSetup.pair.borrowAsset,
                    10,
                    {
                      frozen: true
                    }
                  );
                  expect(r.plan.converter).eq(Misc.ZERO_ADDRESS);
                });
              });
              describe("Entry kinds", () => {
                describe("Use ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0", () => {
                  it("should return expected collateral and borrow amounts", async () => {
                    const collateralAmount = parseUnits(testSetup.pair.amount, await IERC20Metadata__factory.connect(testSetup.pair.collateralAsset, deployer).decimals());
                    const r = await preparePlan(
                      testSetup.pair.collateralAsset,
                      collateralAmount,
                      testSetup.pair.borrowAsset,
                      10,
                      undefined,
                      defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
                    );

                    const borrowAmount = AprUtils.getBorrowAmount(
                      collateralAmount,
                      r.healthFactor2,
                      r.plan.liquidationThreshold18,
                      r.priceCollateral,
                      r.priceBorrow,
                      r.collateralAssetData.data.decimals,
                      r.borrowAssetData.data.decimals
                    );

                    const amountCollateralInBorrowAsset36 = convertUnits(r.plan.collateralAmount,
                      r.priceCollateral,
                      r.collateralAssetData.data.decimals,
                      r.priceBorrow,
                      36
                    );

                    const ret = [
                      r.plan.collateralAmount,
                      r.plan.amountToBorrow,
                      areAlmostEqual(r.plan.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36)
                    ].map(x => BalanceUtils.toString(x)).join("\n");
                    const expected = [collateralAmount, borrowAmount, true].map(x => BalanceUtils.toString(x)).join("\n");

                    expect(ret).eq(expected);
                  });
                });
                describe("Use ENTRY_KIND_EXACT_PROPORTION_1", () => {
                  it("should split source amount on the parts with almost same cost", async () => {
                    const collateralAmount = parseUnits(testSetup.pair.amount, await IERC20Metadata__factory.connect(testSetup.pair.collateralAsset, deployer).decimals());

                    const r = await preparePlan(
                      testSetup.pair.collateralAsset,
                      collateralAmount,
                      testSetup.pair.borrowAsset,
                      10,
                      undefined,
                      defaultAbiCoder.encode(
                        ["uint256", "uint256", "uint256"],
                        [AppConstants.ENTRY_KIND_1, 1, 1]
                      )
                    );

                    const sourceAssetUSD = +formatUnits(
                      collateralAmount.sub(r.plan.collateralAmount).mul(r.priceCollateral),
                      r.collateralAssetData.data.decimals
                    );
                    const targetAssetUSD = +formatUnits(
                      r.plan.amountToBorrow.mul(r.priceBorrow),
                      r.borrowAssetData.data.decimals
                    );
                    const amountCollateralInBorrowAsset36 = convertUnits(r.plan.collateralAmount,
                      r.priceCollateral,
                      r.collateralAssetData.data.decimals,
                      r.priceBorrow,
                      36
                    );

                    const ret = [
                      sourceAssetUSD === targetAssetUSD,
                      r.plan.collateralAmount.lt(collateralAmount),
                      areAlmostEqual(r.plan.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36)
                    ].join();
                    const expected = [true, true, true].join();

                    console.log("plan", r.plan);
                    console.log("sourceAssetUSD", sourceAssetUSD);
                    console.log("targetAssetUSD", targetAssetUSD);
                    console.log("amountCollateralInBorrowAsset36", amountCollateralInBorrowAsset36);

                    expect(ret).eq(expected);
                  });
                });
                describe("Use ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2", () => {
                  it("should return expected collateral and borrow amounts", async () => {
                    // let's calculate borrow amount by known collateral amount
                    const collateralAmount = parseUnits(testSetup.pair.amount, await IERC20Metadata__factory.connect(testSetup.pair.collateralAsset, deployer).decimals());
                    const countBlocks = 10;
                    const d = await preparePlan(
                      testSetup.pair.collateralAsset,
                      collateralAmount,
                      testSetup.pair.borrowAsset,
                      countBlocks
                    );
                    const borrowAmount = AprUtils.getBorrowAmount(
                      collateralAmount,
                      d.healthFactor2,
                      d.plan.liquidationThreshold18,
                      d.priceCollateral,
                      d.priceBorrow,
                      d.collateralAssetData.data.decimals,
                      d.borrowAssetData.data.decimals
                    );
                    const expectedCollateralAmount = AprUtils.getCollateralAmount(
                      borrowAmount,
                      d.healthFactor2,
                      d.plan.liquidationThreshold18,
                      d.priceCollateral,
                      d.priceBorrow,
                      d.collateralAssetData.data.decimals,
                      d.borrowAssetData.data.decimals
                    );

                    const r = await preparePlan(
                      testSetup.pair.collateralAsset,
                      borrowAmount,
                      testSetup.pair.borrowAsset,
                      countBlocks,
                      undefined,
                      defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2])
                    );

                    const amountCollateralInBorrowAsset36 = convertUnits(r.plan.collateralAmount,
                      r.priceCollateral,
                      r.collateralAssetData.data.decimals,
                      r.priceBorrow,
                      36
                    );
                    const ret = [
                      r.plan.amountToBorrow,
                      areAlmostEqual(r.plan.collateralAmount, collateralAmount),
                      areAlmostEqual(r.plan.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36),
                      areAlmostEqual(expectedCollateralAmount, collateralAmount) // let's ensure that expectedCollateralAmount is correct
                    ].map(x => BalanceUtils.toString(x)).join("\n");

                    const expected = [borrowAmount, true, true, true].map(x => BalanceUtils.toString(x)).join("\n");

                    expect(ret).eq(expected);
                  });
                });
              });
              describe("Collateral and borrow amounts fit to limits", () => {
                describe("Allowed collateral exceeds available collateral", () => {
                  it("should return expected borrow and collateral amounts", async () => {
                    // let's get max available supply amount
                    const collateralAmount = parseUnits(testSetup.pair.amount, await IERC20Metadata__factory.connect(testSetup.pair.collateralAsset, deployer).decimals());
                    const sample = await preparePlan(testSetup.pair.collateralAsset, collateralAmount, testSetup.pair.borrowAsset);

                    // let's try to borrow amount using collateral that exceeds max supply amount
                    const r = await preparePlan(testSetup.pair.collateralAsset, sample.plan.maxAmountToSupply.add(1000), testSetup.pair.borrowAsset);
                    console.log(r.plan);

                    const expectedCollateralAmount = AprUtils.getCollateralAmount(
                      r.plan.amountToBorrow,
                      r.healthFactor2,
                      r.plan.liquidationThreshold18,
                      r.priceCollateral,
                      r.priceBorrow,
                      r.collateralAssetData.data.decimals,
                      r.borrowAssetData.data.decimals
                    );

                    const ret = [
                      r.plan.amountToBorrow.lte(r.plan.maxAmountToBorrow),
                      areAlmostEqual(r.plan.collateralAmount, expectedCollateralAmount)
                    ].map(x => BalanceUtils.toString(x)).join("\n");
                    const expected = [
                      true,
                      true
                    ].map(x => BalanceUtils.toString(x)).join("\n");

                    expect(ret).eq(expected);
                  });
                });
                describe("Allowed borrow amounts exceeds available borrow amount", () => {
                  it("should return expected borrow and collateral amounts", async () => {
                    // let's get max available borrow amount
                    const collateralAmount = parseUnits(testSetup.pair.amount, await IERC20Metadata__factory.connect(testSetup.pair.collateralAsset, deployer).decimals());
                    const sample = await preparePlan(testSetup.pair.collateralAsset, collateralAmount, testSetup.pair.borrowAsset);

                    // let's try to borrow amount using collateral that exceeds max supply amount
                    const r = await preparePlan(
                      testSetup.pair.collateralAsset,
                      sample.plan.maxAmountToBorrow.add(1000),
                      testSetup.pair.borrowAsset,
                      10,
                      undefined,
                      defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2])
                    );
                    console.log(r.plan);

                    const expectedCollateralAmount = AprUtils.getCollateralAmount(
                      sample.plan.maxAmountToBorrow,
                      r.healthFactor2,
                      r.plan.liquidationThreshold18,
                      r.priceCollateral,
                      r.priceBorrow,
                      r.collateralAssetData.data.decimals,
                      r.borrowAssetData.data.decimals
                    );
                    const expectedBorrowAmount = AprUtils.getBorrowAmount(
                      sample.plan.maxAmountToSupply,
                      r.healthFactor2,
                      r.plan.liquidationThreshold18,
                      r.priceCollateral,
                      r.priceBorrow,
                      r.collateralAssetData.data.decimals,
                      r.borrowAssetData.data.decimals
                    );
                    console.log("expectedBorrowAmount", expectedBorrowAmount);

                    const ret = [
                      r.plan.amountToBorrow.eq(r.plan.maxAmountToBorrow)
                      || r.plan.collateralAmount.eq(r.plan.maxAmountToSupply),
                      areAlmostEqual(r.plan.collateralAmount, expectedCollateralAmount)
                      || areAlmostEqual(r.plan.amountToBorrow, expectedBorrowAmount)
                    ].map(x => BalanceUtils.toString(x)).join("\n");
                    const expected = [true, true].map(x => BalanceUtils.toString(x)).join("\n");

                    expect(ret).eq(expected);
                  });
                });
              });
            });
            describe("Bad paths", () => {
              async function tryGetConversionPlan(
                badPathsParams: IGetConversionPlanBadPaths,
                collateralAsset: string = testSetup.pair.collateralAsset,
                borrowAsset: string = testSetup.pair.borrowAsset,
                collateralAmount: string = testSetup.pair.amount
              ): Promise<IConversionPlan> {
                return (await preparePlan(
                  collateralAsset,
                  parseUnits(collateralAmount),
                  borrowAsset,
                  10,
                  badPathsParams
                )).plan;
              }

              describe("incorrect input params", () => {
                describe("collateral token is zero", () => {
                  it("should revert", async () => {
                    await expect(
                      tryGetConversionPlan({zeroCollateralAsset: true})
                    ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
                  });
                });
                describe("borrow token is zero", () => {
                  it("should revert", async () => {
                    await expect(
                      tryGetConversionPlan({zeroBorrowAsset: true})
                    ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
                  });
                });
                describe("healthFactor2_ is less than min allowed", () => {
                  it("should revert", async () => {
                    await expect(
                      tryGetConversionPlan({incorrectHealthFactor2: 100})
                    ).revertedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
                  });
                });
                describe("countBlocks_ is zero", () => {
                  it("should revert", async () => {
                    await expect(
                      tryGetConversionPlan({zeroCountBlocks: true})
                    ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
                  });
                });
                describe("collateralAmount_ is zero", () => {
                  it("should revert", async () => {
                    await expect(
                      tryGetConversionPlan({zeroAmountIn: true})
                    ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
                  });
                });
              });

              /* We cannot make a reserve inactive if it has active suppliers */
              describe.skip("inactive", () => {
                describe("collateral token is inactive", () => {
                  it("should revert", async () => {
                    expect.fail("TODO");
                  });
                });
                describe("borrow token is inactive", () => {
                  it("should revert", async () => {
                    expect.fail("TODO");
                  });
                });
              });

              describe("paused", () => {
                it("should fail if collateral token is paused", async () => {
                  expect((await tryGetConversionPlan({makeCollateralAssetPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
                });
                it("should fail if borrow token is paused", async () => {
                  expect((await tryGetConversionPlan({makeBorrowAssetPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
                });
              });

              describe("frozen", () => {
                it("should fail if collateral token is frozen", async () => {
                  expect((await tryGetConversionPlan({makeCollateralAssetFrozen: true})).converter).eq(Misc.ZERO_ADDRESS);
                });
                it("should fail if borrow token is frozen", async () => {
                  expect((await tryGetConversionPlan({makeBorrowAssetFrozen: true})).converter).eq(Misc.ZERO_ADDRESS);
                });
              });

              describe("Not usable", () => {
                describe("Two assets from same category", () => {
                  testSetup.pairsToBorrowNotUsable.forEach(function (pair: IPairToBorrow) {
                    it(`should return expected values for ${pair.collateralAssetName}:${pair.borrowAssetName} ${pair.tag || ""}`, async () => {
                      expect((await tryGetConversionPlan({}, pair.collateralAsset, pair.borrowAsset,)).converter).eq(Misc.ZERO_ADDRESS);
                    });
                  });
                });
              });

              describe("Caps", () => {
                it("should return expected maxAmountToSupply when try to supply more than allowed by supply cap", async () => {
                  const plan = await tryGetConversionPlan(
                    {setMinSupplyCap: true},
                    testSetup.pair.collateralAsset,
                    testSetup.pair.borrowAsset,
                    "12345"
                  );
                  expect(plan.maxAmountToSupply.lt(parseUnits("12345"))).eq(true);
                });
                it("should return expected maxAmountToSupply=max(uint) if supply cap is zero (supplyCap == 0 => no cap)", async () => {
                  const plan = await tryGetConversionPlan(
                    {setZeroSupplyCap: true},
                    testSetup.pair.collateralAsset,
                    testSetup.pair.borrowAsset,
                    "12345"
                  );
                  console.log(plan.maxAmountToSupply);
                  expect(plan.maxAmountToSupply.eq(Misc.MAX_UINT)).eq(true);
                });
                it("should return expected borrowAmount when try to borrow more than allowed by borrow cap", async () => {
                  const planNoBorrowCap = await tryGetConversionPlan(
                    {},
                    testSetup.pair.collateralAsset,
                    testSetup.pair.borrowAsset,
                    "12345"
                  );
                  const plan = await tryGetConversionPlan(
                    {setMinBorrowCap: true},
                    testSetup.pair.collateralAsset,
                    testSetup.pair.borrowAsset,
                    "12345"
                  );
                  const ret = [
                    plan.amountToBorrow.eq(plan.maxAmountToBorrow),
                    plan.amountToBorrow.lt(planNoBorrowCap.maxAmountToBorrow),
                    planNoBorrowCap.amountToBorrow.lt(planNoBorrowCap.maxAmountToBorrow)
                  ].join("\n");
                  const expected = [true, true, true].join("\n");
                  expect(ret).eq(expected);
                });
                it("should return expected borrowAmount when borrow cap is zero", async () => {
                  const plan = await tryGetConversionPlan(
                    {setZeroBorrowCap: true},
                    testSetup.pair.collateralAsset,
                    testSetup.pair.borrowAsset,
                    "12345"
                  );
                  const dataProvider = await Aave3Helper.getAaveProtocolDataProvider(deployer, testSetup.aavePool);
                  const borrowData = await dataProvider.getReserveData(testSetup.pair.borrowAsset);
                  // by default, maxAmountToBorrow = totalAToken - totalStableDebt - totalVariableDebt;
                  const expectedMaxAmountToBorrow = borrowData.totalAToken
                    .sub(borrowData.totalStableDebt)
                    .sub(borrowData.totalVariableDebt);
                  console.log(plan.maxAmountToBorrow.toString(), expectedMaxAmountToBorrow.toString());
                  expect(plan.maxAmountToBorrow.eq(expectedMaxAmountToBorrow)).eq(true);
                });
              });

              describe("Use unsupported entry kind 999", () => {
                it("should return zero plan", async () => {

                  const collateralAmount = parseUnits(
                    testSetup.pair.amount,
                    await IERC20Metadata__factory.connect(testSetup.pair.collateralAsset, deployer).decimals()
                  );

                  const r = await preparePlan(
                    testSetup.pair.collateralAsset,
                    collateralAmount,
                    testSetup.pair.borrowAsset,
                    10,
                    undefined,
                    defaultAbiCoder.encode(["uint256"], [999]) // (!) unknown entry kind
                  );
                  expect(r.plan.converter).eq(Misc.ZERO_ADDRESS);
                  expect(r.plan.collateralAmount.eq(0)).eq(true);
                  expect(r.plan.amountToBorrow.eq(0)).eq(true);
                });
              });

              describe("Result collateralAmount == 0, amountToBorrow != 0 (edge case, improve coverage)", () => {
                it("should return zero plan", async () => {
                  const pair = testSetup.pairStable ?? testSetup.pair;
                  const collateralAmount = parseUnits(
                    pair.smallAmount,
                    await IERC20Metadata__factory.connect(pair.collateralAsset, deployer).decimals()
                  );

                  const r0 = await preparePlan(
                    pair.collateralAsset,
                    collateralAmount,
                    pair.borrowAsset,
                    10,
                    undefined,
                    defaultAbiCoder.encode(["uint256"], [2])
                  );

                  // change prices: make priceCollateral very high, priceBorrow very low
                  // as result, exactBorrowOutForMinCollateralIn will return amountToCollateralOut = 0,
                  // and we should hit second condition in borrow-validation section:
                  //    plan.amountToBorrow == 0 || plan.collateralAmount == 0

                  const priceOracle = await Aave3ChangePricesUtils.setupPriceOracleMock(deployer, core);
                  await priceOracle.setPrices(
                    [pair.collateralAsset, pair.borrowAsset],
                    [parseUnits("1", 15), parseUnits("1", 5)]
                  );

                  const r1 = await preparePlan(
                    pair.collateralAsset,
                    collateralAmount,
                    pair.borrowAsset,
                    10,
                    undefined,
                    defaultAbiCoder.encode(["uint256"], [2])
                  );

                  // first plan is successful
                  expect(r0.plan.converter).not.eq(Misc.ZERO_ADDRESS);
                  expect(r0.plan.collateralAmount.eq(0)).not.eq(true);
                  expect(r0.plan.amountToBorrow.eq(0)).not.eq(true);

                  // the plan created after changing the prices is not successful
                  expect(r1.plan.converter).eq(Misc.ZERO_ADDRESS);
                  expect(r1.plan.collateralAmount.eq(0)).eq(true);
                  expect(r1.plan.amountToBorrow.eq(0)).eq(true);
                });
              });

              describe("supplyCap < totalSupply (edge case, improve coverage)", () => {
                it("should return zero plan", async () => {
                  const pair = testSetup.pairStable ?? testSetup.pair;

                  const collateralDecimals = await IERC20Metadata__factory.connect(pair.collateralAsset, deployer).decimals();
                  const collateralAmount = parseUnits(pair.amount, collateralDecimals);

                  const r0 = await preparePlan(
                    pair.collateralAsset,
                    collateralAmount,
                    pair.borrowAsset,
                    10,
                    undefined,
                    defaultAbiCoder.encode(["uint256"], [2])
                  );

                  // set very small supplyCap
                  await Aave3ChangePricesUtils.setSupplyCap(deployer, core, pair.collateralAsset, parseUnits("1", collateralDecimals));

                  const r1 = await preparePlan(
                    pair.collateralAsset,
                    collateralAmount,
                    pair.borrowAsset,
                    10,
                    undefined,
                    defaultAbiCoder.encode(["uint256"], [2])
                  );

                  // first plan is successful
                  expect(r0.plan.converter).not.eq(Misc.ZERO_ADDRESS);
                  expect(r0.plan.collateralAmount.eq(0)).not.eq(true);
                  expect(r0.plan.amountToBorrow.eq(0)).not.eq(true);

                  // the plan created after changing the prices is not successful
                  expect(r1.plan.converter).eq(Misc.ZERO_ADDRESS);
                  expect(r1.plan.collateralAmount.eq(0)).eq(true);
                  expect(r1.plan.amountToBorrow.eq(0)).eq(true);
                });
              });
            });
            describe("Check gas limit @skip-on-coverage", () => {
              it("should not exceed gas limits", async () => {
                const collateralDecimals = await IERC20Metadata__factory.connect(testSetup.pair.collateralAsset, deployer).decimals();
                const gasUsed = await aavePlatformAdapter.estimateGas.getConversionPlan(
                  {
                    collateralAsset: testSetup.pair.collateralAsset,
                    amountIn: parseUnits(testSetup.pair.amount, collateralDecimals),
                    borrowAsset: testSetup.pair.borrowAsset,
                    countBlocks: 1,
                    entryData: "0x",
                  },
                  200,
                  {gasLimit: GAS_LIMIT}
                );
                controlGasLimitsEx2(gasUsed, GAS_LIMIT_AAVE_3_GET_CONVERSION_PLAN, (u, t) => {
                  expect(u).to.be.below(t);
                });
              });
            });
          });

          describe("getBorrowRateAfterBorrow", () => {
            describe("Good paths", () => {
              async function makeGetBorrowRateAfterBorrowTest(
                collateralAsset: string,
                borrowAsset: string,
                collateralHolders: string[],
                part10000: number
              ): Promise<{ br: BigNumber, brPredicted: BigNumber }> {
                const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer, testSetup.aavePool);

                return PredictBrUsesCase.predictBrTest(
                  deployer,
                  new Aave3PlatformActor(dp, aavePool, collateralAsset, borrowAsset, deployer),
                  {
                    collateralAsset,
                    borrowAsset,
                    collateralHolders,
                    part10000
                  }
                );
              }

              describe("small amount", () => {
                it("Predicted borrow rate should be same to real rate after the borrow", async () => {
                  const part10000 = 1;

                  const r = await makeGetBorrowRateAfterBorrowTest(
                    testSetup.pair.collateralAsset,
                    testSetup.pair.borrowAsset,
                    testSetup.pair.collateralHolders,
                    part10000
                  );

                  const ret = areAlmostEqual(r.br, r.brPredicted, 5);
                  expect(ret).eq(true);
                });
              });

              describe("Huge amount", () => {
                it("Predicted borrow rate should be same to real rate after the borrow", async () => {
                  const part10000 = 1000;

                  const r = await makeGetBorrowRateAfterBorrowTest(
                    testSetup.pair.collateralAsset,
                    testSetup.pair.borrowAsset,
                    testSetup.pair.collateralHolders,
                    part10000
                  );

                  const ret = areAlmostEqual(r.br, r.brPredicted, 5);
                  expect(ret).eq(true);
                });
              });
            });

          });

          describe("initializePoolAdapter", () => {
            let snapshotLocal: string;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });

            interface IInitializePoolAdapterBadPaths {
              useWrongConverter?: boolean;
              wrongCallerOfInitializePoolAdapter?: boolean;
            }

            async function makeInitializePoolAdapterTest(
              useEMode: boolean,
              badParams?: IInitializePoolAdapterBadPaths
            ): Promise<{ ret: string, expected: string }> {
              const user = ethers.Wallet.createRandom().address;
              const collateralAsset = (await MocksHelper.createMockedCToken(deployer)).address;
              const borrowAsset = (await MocksHelper.createMockedCToken(deployer)).address;

              const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);

              const poolAdapter = useEMode
                ? await AdaptersHelper.createAave3PoolAdapterEMode(deployer)
                : await AdaptersHelper.createAave3PoolAdapter(deployer);
              const aavePlatformAdapterAsBorrowManager = aavePlatformAdapter.connect(
                badParams?.wrongCallerOfInitializePoolAdapter
                  ? await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
                  : await DeployerUtils.startImpersonate(borrowManager.address)
              );

              await aavePlatformAdapterAsBorrowManager.initializePoolAdapter(
                badParams?.useWrongConverter
                  ? ethers.Wallet.createRandom().address
                  : useEMode
                    ? templateAdapterEMode
                    : templateAdapterNormal,
                poolAdapter.address,
                user,
                collateralAsset,
                borrowAsset
              );

              const poolAdapterConfigAfter = await poolAdapter.getConfig();
              const ret = [
                poolAdapterConfigAfter.origin,
                poolAdapterConfigAfter.outUser,
                poolAdapterConfigAfter.outCollateralAsset,
                poolAdapterConfigAfter.outBorrowAsset
              ].join();
              const expected = [
                useEMode ? templateAdapterEMode : templateAdapterNormal,
                user,
                collateralAsset,
                borrowAsset
              ].join();
              return {ret, expected};
            }

            describe("Good paths", () => {
              it("Normal mode: initialized pool adapter should has expected values", async () => {
                const r = await makeInitializePoolAdapterTest(false);
                expect(r.ret).eq(r.expected);
              });
              it("EMode mode: initialized pool adapter should has expected values", async () => {
                const r = await makeInitializePoolAdapterTest(false);
                expect(r.ret).eq(r.expected);
              });
            });
            describe("Bad paths", () => {
              it("should revert if converter address is not registered", async () => {
                await expect(
                  makeInitializePoolAdapterTest(
                    false,
                    {useWrongConverter: true}
                  )
                ).revertedWith("TC-25 converter not found"); // CONVERTER_NOT_FOUND
              });
              it("should revert if it's called by not borrow-manager", async () => {
                await expect(
                  makeInitializePoolAdapterTest(
                    false,
                    {wrongCallerOfInitializePoolAdapter: true}
                  )
                ).revertedWith("TC-45 borrow manager only"); // BORROW_MANAGER_ONLY
              });
            });
          });

          describe("events", () => {
            it("should emit expected values", async () => {

              const user = ethers.Wallet.createRandom().address;
              const collateralAsset = (await MocksHelper.createMockedCToken(deployer)).address;
              const borrowAsset = (await MocksHelper.createMockedCToken(deployer)).address;

              const poolAdapter = await AdaptersHelper.createAave3PoolAdapter(deployer);
              const aavePlatformAdapterAsBorrowManager = Aave3PlatformAdapter__factory.connect(
                aavePlatformAdapter.address,
                await DeployerUtils.startImpersonate(await controller.borrowManager())
              );

              await expect(
                aavePlatformAdapterAsBorrowManager.initializePoolAdapter(
                  templateAdapterNormal,
                  poolAdapter.address,
                  user,
                  collateralAsset,
                  borrowAsset
                )
              ).to.emit(aavePlatformAdapter, "OnPoolAdapterInitialized").withArgs(
                templateAdapterNormal,
                poolAdapter.address,
                user,
                collateralAsset,
                borrowAsset
              );
            });
          });

          describe("setFrozen", () => {
            describe("Good paths", () => {
              it("should assign expected value to frozen", async () => {
                const before = await aavePlatformAdapter.frozen();
                await aavePlatformAdapter.setFrozen(true);
                const middle = await aavePlatformAdapter.frozen();
                await aavePlatformAdapter.setFrozen(false);
                const after = await aavePlatformAdapter.frozen();

                const ret = [before, middle, after].join();
                const expected = [false, true, false].join();

                expect(ret).eq(expected);
              });
            });
            describe("Bad paths", () => {
              it("should assign expected value to frozen", async () => {
                await expect(
                  aavePlatformAdapter.connect(await Misc.impersonate(ethers.Wallet.createRandom().address)).setFrozen(true)
                ).revertedWith("TC-9 governance only"); // AppErrors.GOVERNANCE_ONLY
              });
            })
          });

          describe("platformKind", () => {
            it("should return expected values", async () => {
              expect((await aavePlatformAdapter.platformKind())).eq(3); // LendingPlatformKinds.AAVE3_3
            });
          });
        }
      });
    });
  });
//endregion Unit tests

});
