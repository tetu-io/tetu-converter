import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  Aave3PlatformAdapter, AaveTwoPlatformAdapter,
  BorrowManager,
  BorrowManager__factory,
  ConverterController, HfPlatformAdapter,
  IPlatformAdapter, ITetuConverter__factory, MoonwellPlatformAdapter,
  UserEmulator
} from "../../typechain";
import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID} from "../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {TetuConverterApp} from "../baseUT/app/TetuConverterApp";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {AdaptersHelper} from "../baseUT/app/AdaptersHelper";
import {Misc} from "../../scripts/utils/Misc";
import {generateAssetPairs} from "../baseUT/utils/AssetPairUtils";
import {
  BorrowRepayCases,
  IAssetsPairConfig, IBorrowRepayMultipleActionParams,
  IBorrowRepayPairResults, IBorrowRepaySingleActionParams,
  IHealthFactorsPair,
} from "../baseUT/uses-cases/shared/BorrowRepayCases";
import {IPlatformUtilsProvider} from "../baseUT/types/IPlatformUtilsProvider";
import {BaseAddresses} from "../../scripts/addresses/BaseAddresses";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {AppConstants} from "../baseUT/types/AppConstants";
import {expect} from "chai";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3Utils} from "../baseUT/protocols/aave3/Aave3Utils";
import {Aave3UtilsProviderMatic} from "../baseUT/protocols/aave3/utils-providers/Aave3UtilsProviderMatic";
import {plusDebtGap, withDebtGap} from "../baseUT/utils/DebtGapUtils";
import {MoonwellUtils} from "../baseUT/protocols/moonwell/MoonwellUtils";
import {MoonwellHelper} from "../../scripts/integration/moonwell/MoonwellHelper";
import {MoonwellUtilsProvider} from "../baseUT/protocols/moonwell/MoonwellUtilsProvider";
import {Aave3UtilsProviderBase} from "../baseUT/protocols/aave3/utils-providers/Aave3UtilsProviderBase";
import {HundredFinanceUtilsProvider} from "../baseUT/protocols/hundred-finance/HundredFinanceUtilsProvider";
import {HundredFinanceUtils} from "../baseUT/protocols/hundred-finance/HundredFinanceUtils";
import {AaveTwoUtils} from "../baseUT/protocols/aaveTwo/AaveTwoUtils";
import {AaveTwoUtilsProvider} from "../baseUT/protocols/aaveTwo/AaveTwoUtilsProvider";

describe("BorrowRepayCaseTest", () => {
//region Data types
  interface IChainParams {
    networkId: number;
    platforms: IPlatformParams[];
    block?: number; // undefined by default (=== use block from env)
  }
  interface IPlatformParams {
    platformAdapterBuilder: (signer: SignerWithAddress, converterController: string, borrowManagerAsGov: BorrowManager) => Promise<IPlatformAdapter>;
    platformUtilsProviderBuilder: () => IPlatformUtilsProvider,
    assetPairs: IAssetsPairConfig[];

  }
//endregion Data types

//region Constants
  const RECEIVER = ethers.Wallet.createRandom().address;
  const PERIOD_IN_BLOCKS = 1000;

  const PARAMS_SINGLE_STABLE: IBorrowRepaySingleActionParams = {
    userBorrowAssetBalance: "1000",
    userCollateralAssetBalance: "1500",
    collateralAmount: "1000",
    collateralAmountSecond: "100",

    userBorrowAssetBalanceTinyAmount: "1",
    userCollateralAssetBalanceTinyAmount: "1.5",
    collateralAmountTiny: "1",

    userBorrowAssetBalanceHugeAmount: "100000",
  }
  const PARAMS_MULTIPLE_STABLE: IBorrowRepayMultipleActionParams = {
    userBorrowAssetBalance: "2000",
    userCollateralAssetBalance: "1500",
    userCollateralAssetBalanceSecond: "1000",
    collateralAmount1: "1000",
    collateralAmount2: "400",
    collateralAmountSecond: "800",
  }

  const PARAMS_SINGLE_WETH: IBorrowRepaySingleActionParams = {
    userBorrowAssetBalance: "2",
    userCollateralAssetBalance: "1.5",
    collateralAmount: "1",
    collateralAmountSecond: "0.1",

    userBorrowAssetBalanceTinyAmount: "0.0001",
    userCollateralAssetBalanceTinyAmount: "0.00015",
    collateralAmountTiny: "0.0001",

    userBorrowAssetBalanceHugeAmount: "100",
  }
  const PARAMS_MULTIPLE_WETH: IBorrowRepayMultipleActionParams = {
    userBorrowAssetBalance: "2",
    userCollateralAssetBalance: "1.5",
    userCollateralAssetBalanceSecond: "1",
    collateralAmount1: "1",
    collateralAmount2: "0.4",
    collateralAmountSecond: "0.8",
  }

  const PARAMS_SINGLE_STABLE_WMATIC: IBorrowRepaySingleActionParams = {
    userBorrowAssetBalance: "1000",
    userCollateralAssetBalance: "1000",
    collateralAmount: "100",
    collateralAmountSecond: "1",

    userBorrowAssetBalanceTinyAmount: "5",
    userCollateralAssetBalanceTinyAmount: "1",
    collateralAmountTiny: "1",

    userBorrowAssetBalanceHugeAmount: "1000",
  }

  const NETWORKS: IChainParams[] = [
    { // Base chain
      networkId: BASE_NETWORK_ID,
      platforms: [
        { // AAVE3 on Base chain
          platformUtilsProviderBuilder() {
            return new Aave3UtilsProviderBase();
          },
          async platformAdapterBuilder(signer0: SignerWithAddress, converterController0: string, borrowManagerAsGov0: BorrowManager): Promise<IPlatformAdapter> {
            const platformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
              signer0,
              converterController0,
              BaseAddresses.AAVE_V3_POOL,
              (await AdaptersHelper.createAave3PoolAdapter(signer0)).address,
              (await AdaptersHelper.createAave3PoolAdapterEMode(signer0)).address,
              borrowManagerAsGov0.address,
            ) as Aave3PlatformAdapter;

            // register the platform adapter in TetuConverter app
            const pairs = generateAssetPairs(Aave3Utils.getAllAssetsBase());
            await borrowManagerAsGov0.addAssetPairs(
              platformAdapter.address,
              pairs.map(x => x.smallerAddress),
              pairs.map(x => x.biggerAddress)
            );

            return platformAdapter;
          },
          assetPairs: [
            {collateralAsset: BaseAddresses.WETH, borrowAsset: BaseAddresses.cbETH, collateralAssetName: "WETH", borrowAssetName: "cbETH", singleParams: PARAMS_SINGLE_WETH, multipleParams: PARAMS_MULTIPLE_WETH, minTargetHealthFactor: "0", hugeCollateralAmount: "100"},
            {collateralAsset: BaseAddresses.cbETH, borrowAsset: BaseAddresses.WETH, collateralAssetName: "cbETH", borrowAssetName: "WETH", singleParams: PARAMS_SINGLE_WETH, multipleParams: PARAMS_MULTIPLE_WETH, minTargetHealthFactor: "0", hugeCollateralAmount: "100"},
          ]
        },
        { // Moonwell  on Base chain
          platformUtilsProviderBuilder() {
            return new MoonwellUtilsProvider();
          },
          async platformAdapterBuilder(signer0: SignerWithAddress, converterController0: string, borrowManagerAsGov0: BorrowManager): Promise<IPlatformAdapter> {
            const platformAdapter = await DeployUtils.deployContract(
              signer0,
              "MoonwellPlatformAdapter",
              converterController0,
              (await MoonwellHelper.getComptroller(signer0)).address,
              (await AdaptersHelper.createMoonwellPoolAdapter(signer0)).address,
              MoonwellUtils.getAllCTokens()
            ) as MoonwellPlatformAdapter;

            // register the platform adapter in TetuConverter app
            const pairs = generateAssetPairs(MoonwellUtils.getAllAssets());
            await borrowManagerAsGov0.addAssetPairs(
              platformAdapter.address,
              pairs.map(x => x.smallerAddress),
              pairs.map(x => x.biggerAddress)
            );

            return platformAdapter;
          },
          assetPairs: [
            {collateralAsset: BaseAddresses.USDC, borrowAsset: BaseAddresses.USDbC, collateralAssetName: "USDC", borrowAssetName: "USDbC", singleParams: PARAMS_SINGLE_STABLE, multipleParams: PARAMS_MULTIPLE_STABLE},
            {collateralAsset: BaseAddresses.USDbC, borrowAsset: BaseAddresses.USDC, collateralAssetName: "USDbC", borrowAssetName: "USDC", singleParams: PARAMS_SINGLE_STABLE, multipleParams: PARAMS_MULTIPLE_STABLE},

            {collateralAsset: BaseAddresses.DAI, borrowAsset: BaseAddresses.USDbC, collateralAssetName: "DAI", borrowAssetName: "USDbC", singleParams: PARAMS_SINGLE_STABLE, multipleParams: PARAMS_MULTIPLE_STABLE},
            {collateralAsset: BaseAddresses.USDbC, borrowAsset: BaseAddresses.DAI, collateralAssetName: "USDbC", borrowAssetName: "DAI", singleParams: PARAMS_SINGLE_STABLE, multipleParams: PARAMS_MULTIPLE_STABLE},

            {collateralAsset: BaseAddresses.USDC, borrowAsset: BaseAddresses.DAI, collateralAssetName: "USDC", borrowAssetName: "DAI", singleParams: PARAMS_SINGLE_STABLE},
            {collateralAsset: BaseAddresses.DAI, borrowAsset: BaseAddresses.USDC, collateralAssetName: "DAI", borrowAssetName: "USDC", singleParams: PARAMS_SINGLE_STABLE},
          ]
        },
      ]
    },

    { // Polygon
      networkId: POLYGON_NETWORK_ID,
      platforms: [
        { // AAVETwo on Polygon
          async platformAdapterBuilder(signer0: SignerWithAddress, converterController0: string, borrowManagerAsGov0: BorrowManager): Promise<IPlatformAdapter> {
            const platformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
              signer0,
              converterController0,
              MaticAddresses.AAVE_TWO_POOL,
              (await AdaptersHelper.createAaveTwoPoolAdapter(signer0)).address,
              borrowManagerAsGov0.address,
            ) as AaveTwoPlatformAdapter;

            // register the platform adapter in TetuConverter app
            const pairs = generateAssetPairs(AaveTwoUtils.getAllAssets());
            await borrowManagerAsGov0.addAssetPairs(
              platformAdapter.address,
              pairs.map(x => x.smallerAddress),
              pairs.map(x => x.biggerAddress)
            );

            return platformAdapter;
          },
          platformUtilsProviderBuilder() {
            return new AaveTwoUtilsProvider();
          },
          assetPairs: [
            {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.USDT, collateralAssetName: "USDC", borrowAssetName: "USDT", minTargetHealthFactor: "1.0625", singleParams: PARAMS_SINGLE_STABLE, multipleParams: PARAMS_MULTIPLE_STABLE},

            // AAVE 2 doesn't allow to use USDT as a collateral
            // {collateralAsset: MaticAddresses.USDT, borrowAsset: MaticAddresses.USDC, collateralAssetName: "USDT", borrowAssetName: "USDC"},

            {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.DAI, collateralAssetName: "USDC", borrowAssetName: "DAI", minTargetHealthFactor: "1.0625", singleParams: PARAMS_SINGLE_STABLE},
            {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.USDC, collateralAssetName: "DAI", borrowAssetName: "USDC", minTargetHealthFactor: "1.0625", singleParams: PARAMS_SINGLE_STABLE},
          ]
        },
        { // AAVE3 on Polygon
          async platformAdapterBuilder(signer0: SignerWithAddress, converterController0: string, borrowManagerAsGov0: BorrowManager): Promise<IPlatformAdapter> {
            const platformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
              signer0,
              converterController0,
              MaticAddresses.AAVE_V3_POOL,
              (await AdaptersHelper.createAave3PoolAdapter(signer0)).address,
              (await AdaptersHelper.createAave3PoolAdapterEMode(signer0)).address,
              borrowManagerAsGov0.address,
            ) as Aave3PlatformAdapter;

            // register the platform adapter in TetuConverter app
            const pairs = generateAssetPairs(Aave3Utils.getAllAssetsMatic());
            await borrowManagerAsGov0.addAssetPairs(
              platformAdapter.address,
              pairs.map(x => x.smallerAddress),
              pairs.map(x => x.biggerAddress)
            );

            return platformAdapter;
          },
          platformUtilsProviderBuilder() {
            return new Aave3UtilsProviderMatic();
          },
          assetPairs: [
            {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.USDT, collateralAssetName: "USDC", borrowAssetName: "USDT", singleParams: PARAMS_SINGLE_STABLE, multipleParams: PARAMS_MULTIPLE_STABLE},
            {collateralAsset: MaticAddresses.USDT, borrowAsset: MaticAddresses.USDC, collateralAssetName: "USDT", borrowAssetName: "USDC", singleParams: PARAMS_SINGLE_STABLE, multipleParams: PARAMS_MULTIPLE_STABLE},

            {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.DAI, collateralAssetName: "USDC", borrowAssetName: "DAI", singleParams: PARAMS_SINGLE_STABLE},
            {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.USDC, collateralAssetName: "DAI", borrowAssetName: "USDC", singleParams: PARAMS_SINGLE_STABLE},

            {collateralAsset: MaticAddresses.WMATIC, borrowAsset: MaticAddresses.MaticX, collateralAssetName: "WMATIC", borrowAssetName: "MaticX", singleParams: PARAMS_SINGLE_STABLE, multipleParams: PARAMS_MULTIPLE_STABLE},
          ]
        },

        // { // DForce on Polygon
        //   async platformAdapterBuilder(signer0: SignerWithAddress, converterController0: string, borrowManagerAsGov0: BorrowManager): Promise<IPlatformAdapter> {
        //     const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
        //       signer0,
        //       converterController0,
        //       MaticAddresses.DFORCE_CONTROLLER,
        //       (await AdaptersHelper.createDForcePoolAdapter(signer0)).address,
        //       DForceUtils.getAllCTokens(),
        //       borrowManagerAsGov0.address,
        //     ) as DForcePlatformAdapter;
        //
        //     // register the platform adapter in TetuConverter app
        //     const pairs = generateAssetPairs(DForceUtils.getAllAssets());
        //     await borrowManagerAsGov0.addAssetPairs(
        //       platformAdapter.address,
        //       pairs.map(x => x.smallerAddress),
        //       pairs.map(x => x.biggerAddress)
        //     );
        //
        //     return platformAdapter;
        //   },
        //   platformUtilsProviderBuilder() {
        //     return new DForceUtilsProvider();
        //   },
        //   assetPairs: [
        //     {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.USDT, collateralAssetName: "USDC", borrowAssetName: "USDT", singleParams: PARAMS_SINGLE_STABLE, multipleParams: PARAMS_MULTIPLE_STABLE},
        //     {collateralAsset: MaticAddresses.USDT, borrowAsset: MaticAddresses.USDC, collateralAssetName: "USDT", borrowAssetName: "USDC", singleParams: PARAMS_SINGLE_STABLE, multipleParams: PARAMS_MULTIPLE_STABLE},
        //
        //     {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.DAI, collateralAssetName: "USDC", borrowAssetName: "DAI", singleParams: PARAMS_SINGLE_STABLE, multipleParams: PARAMS_MULTIPLE_STABLE},
        //     {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.USDC, collateralAssetName: "DAI", borrowAssetName: "USDC", singleParams: PARAMS_SINGLE_STABLE, multipleParams: PARAMS_MULTIPLE_STABLE},
        //   ]
        // },
      ]
    },

    { // Polygon
      networkId: POLYGON_NETWORK_ID,
      // any block ~2022 (when HundredFinance had good TVL)
      block: 29439975,
      platforms: [
        { // HundredFinance on Polygon
          platformUtilsProviderBuilder() {
            return new HundredFinanceUtilsProvider();
          },
          async platformAdapterBuilder(signer0: SignerWithAddress, converterController0: string, borrowManagerAsGov0: BorrowManager): Promise<IPlatformAdapter> {
            const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
              signer0,
              converterController0,
              MaticAddresses.HUNDRED_FINANCE_COMPTROLLER,
              (await AdaptersHelper.createHundredFinancePoolAdapter(signer0)).address,
              HundredFinanceUtils.getAllCTokens(),
            ) as HfPlatformAdapter;

            // register the platform adapter in TetuConverter app
            const pairs = generateAssetPairs(HundredFinanceUtils.getAllAssets());
            await borrowManagerAsGov0.addAssetPairs(
              platformAdapter.address,
              pairs.map(x => x.smallerAddress),
              pairs.map(x => x.biggerAddress)
            );

            return platformAdapter;
          },
          assetPairs: [
            {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.WMATIC, collateralAssetName: "DAI", borrowAssetName: "WMATIC", singleParams: PARAMS_SINGLE_STABLE_WMATIC},
            {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.USDT, collateralAssetName: "USDC", borrowAssetName: "USDT", singleParams: PARAMS_SINGLE_STABLE, multipleParams: PARAMS_MULTIPLE_STABLE},
            {collateralAsset: MaticAddresses.WMATIC, borrowAsset: MaticAddresses.DAI, collateralAssetName: "WMATIC", borrowAssetName: "DAI", singleParams: PARAMS_SINGLE_STABLE},
          ]
        },
      ]
    },
  ]
//endregion Constants

//region Global vars for all tests
  /** receive all borrowed amounts and collaterals after any repays */
  let snapshot: string;
  let signer: SignerWithAddress;

  let converterController: ConverterController;
  let converterGovernance: SignerWithAddress;
  let borrowManagerAsGov: BorrowManager;
//endregion Global vars for all tests

  NETWORKS.forEach(network => {
    describe(`${network.networkId}`, function () {
      before(async function () {
        await HardhatUtils.setupBeforeTest(network.networkId, network.block);
        this.timeout(1200000);

        snapshot = await TimeUtils.snapshot();
        const signers = await ethers.getSigners();
        signer = signers[0];

        converterController = await TetuConverterApp.createController(signer, {networkId: network.networkId});
        converterGovernance = await Misc.impersonate(await converterController.governance());
        borrowManagerAsGov = await BorrowManager__factory.connect(await converterController.borrowManager(), converterGovernance);
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      network.platforms.forEach(platform => {
        describe(`${platform.platformUtilsProviderBuilder().getPlatformName()}`, function () {
          let platformUtilsProvider: IPlatformUtilsProvider;
          let snapshotLevel0: string;
          before(async function () {
            snapshotLevel0 = await TimeUtils.snapshot();

            await platform.platformAdapterBuilder(signer, converterController.address, borrowManagerAsGov);
            platformUtilsProvider = platform.platformUtilsProviderBuilder();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLevel0);
          });

          describe("Borrow/repay single action per block", function () {
            const HEALTH_FACTOR_PAIRS: IHealthFactorsPair[] = [
              {minValue: "1.05", targetValue: "1.15"},
              {minValue: "1.01", targetValue: "1.03", singleAssetPairOnly: true, tooSmallTargetHealthFactorCase: true},
              {minValue: "1.01", targetValue: "1.08", singleAssetPairOnly: true},
            ];

            HEALTH_FACTOR_PAIRS.forEach(function (healthFactorsPair: IHealthFactorsPair) {
              describe(`hf ${healthFactorsPair.minValue}, ${healthFactorsPair.targetValue}`, function () {
                /** receive all borrowed amounts and collaterals after any repays */
                let snapshotLevel1: string;
                before(async function () {
                  snapshotLevel1 = await TimeUtils.snapshot();
                  // set up health factors
                  await converterController.connect(converterGovernance).setMinHealthFactor2(parseUnits(healthFactorsPair.minValue, 2));
                  await converterController.connect(converterGovernance).setTargetHealthFactor2(parseUnits(healthFactorsPair.targetValue, 2));
                });
                after(async function () {
                  await TimeUtils.rollback(snapshotLevel1);
                });

                platform.assetPairs.forEach(function (assetPair: IAssetsPairConfig) {
                  if (assetPair.singleParams) {
                    if (!healthFactorsPair.singleAssetPairOnly || assetPair === platform.assetPairs[0]) {
                      if (!healthFactorsPair.tooSmallTargetHealthFactorCase || assetPair.minTargetHealthFactor !== "0") {
                        describe(`${assetPair.collateralAssetName} : ${assetPair.borrowAssetName}`, function () {
                          let snapshotLevel2: string;
                          let userEmulator: UserEmulator;
                          before(async function () {
                            snapshotLevel2 = await TimeUtils.snapshot();
                            userEmulator = await DeployUtils.deployContract(
                              signer,
                              "UserEmulator",
                              converterController.address,
                              assetPair.collateralAsset,
                              assetPair.borrowAsset,
                              PERIOD_IN_BLOCKS
                            ) as UserEmulator;
                            await converterController.connect(converterGovernance).setWhitelistValues([userEmulator.address], true);
                          });
                          after(async function () {
                            await TimeUtils.rollback(snapshotLevel2);
                          });

                          describe("entry kind 0", function () {
                            describe("borrow", function () {
                              let snapshotLevel3: string;
                              let borrowResults: IBorrowRepayPairResults;
                              before(async function () {
                                snapshotLevel3 = await TimeUtils.snapshot();
                                borrowResults = await loadFixture(makeBorrowTest);
                                // console.log("borrowResults", borrowResults);
                              });
                              after(async function () {
                                await TimeUtils.rollback(snapshotLevel3);
                              });

                              async function makeBorrowTest(): Promise<IBorrowRepayPairResults> {
                                return BorrowRepayCases.borrowRepayPairsSingleBlock(
                                  signer,
                                  {
                                    tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                                    user: userEmulator,
                                    borrowAsset: assetPair.borrowAsset,
                                    collateralAsset: assetPair.collateralAsset,
                                    userBorrowAssetBalance: assetPair.singleParams?.userBorrowAssetBalance,
                                    userCollateralAssetBalance: assetPair.singleParams?.userCollateralAssetBalance,
                                    receiver: RECEIVER
                                  },
                                  [{borrow: {amountIn: assetPair.singleParams?.collateralAmount || "0",}}]
                                );
                              }

                              it("should borrow not zero amount", async () => {
                                expect(borrowResults.borrow[0].borrowedAmount).gt(0); // stablecoin : stablecoin
                              });
                              it("should modify user balance in expected way", async () => {
                                // console.log("borrowResults", borrowResults);
                                expect(borrowResults.userCollateralAssetBalance).eq(Number(assetPair.singleParams?.userCollateralAssetBalance) - Number(assetPair.singleParams?.collateralAmount));
                              });
                              it("should put borrowed amount on receiver balance", async () => {
                                expect(borrowResults.receiverBorrowAssetBalance).eq(borrowResults.borrow[0].borrowedAmount);
                              });
                              it("the debt should have health factor near to the target value", async () => {

                                expect(borrowResults.status.healthFactor).approximately(BorrowRepayCases.getTargetHealthFactor(assetPair, healthFactorsPair), 0.005);
                              });

                              describe("partial repay", function () {
                                const REPAY_PARTS = [1000, 25_000, 98_900];

                                REPAY_PARTS.forEach(repayPart => {
                                  describe(`repay part ${repayPart / 100_000}`, function () {
                                    let snapshotLevel4: string;
                                    let repayResults: IBorrowRepayPairResults;
                                    before(async function () {
                                      snapshotLevel4 = await TimeUtils.snapshot();
                                      repayResults = await BorrowRepayCases.borrowRepayPairsSingleBlock(
                                        signer,
                                        {
                                          tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                                          user: userEmulator,
                                          borrowAsset: assetPair.borrowAsset,
                                          collateralAsset: assetPair.collateralAsset,
                                          userBorrowAssetBalance: "0",
                                          userCollateralAssetBalance: "0",
                                          receiver: RECEIVER
                                        },
                                        [{repay: {repayPart}}]
                                      );
                                      // console.log("repayResults", repayResults);
                                    });
                                    after(async function () {
                                      await TimeUtils.rollback(snapshotLevel4);
                                    });

                                    it("should reduce debt on expected value", async () => {
                                      expect(repayResults.status.amountToPay).approximately(
                                        borrowResults.borrow[0].borrowedAmount
                                        - plusDebtGap(
                                          borrowResults.borrow[0].borrowedAmount,
                                          borrowResults.status.debtGapRequired,
                                          repayPart
                                        ),
                                        1e-3);
                                    });
                                    it("should receive expected amount of collateral on receiver's balance", async () => {
                                      expect(repayResults.receiverCollateralAssetBalance).approximately(
                                        plusDebtGap(Number(assetPair.singleParams?.collateralAmount), borrowResults.status.debtGapRequired, repayPart),
                                        1e-3
                                      );
                                    });
                                    it("the debt should have health factor >= target value", async () => {
                                      expect(repayResults.status.healthFactor).approximately(BorrowRepayCases.getTargetHealthFactor(assetPair, healthFactorsPair), 0.005);
                                    });
                                  });
                                });
                              });
                              describe("full repay", function () {
                                let snapshotLevel4: string;
                                let results: IBorrowRepayPairResults;
                                before(async function () {
                                  snapshotLevel4 = await TimeUtils.snapshot();
                                  results = await BorrowRepayCases.borrowRepayPairsSingleBlock(
                                    signer,
                                    {
                                      tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                                      user: userEmulator,
                                      borrowAsset: assetPair.borrowAsset,
                                      collateralAsset: assetPair.collateralAsset,
                                      userBorrowAssetBalance: "0",
                                      userCollateralAssetBalance: "0",
                                      receiver: RECEIVER
                                    },
                                    [{repay: {repayPart: 100_000}}] // full repay
                                  );
                                });
                                after(async function () {
                                  await TimeUtils.rollback(snapshotLevel4);
                                });
                                it("should repay debt completely", async () => {
                                  expect(results.status.amountToPay).eq(0);
                                  expect(results.status.opened).eq(false);
                                  expect(results.status.collateralAmount).eq(0);
                                });
                                it("should return full collateral to the receiver", async () => {
                                  expect(results.receiverCollateralAssetBalance).approximately(
                                    Number(assetPair.singleParams?.collateralAmount),
                                    1e-3
                                  );
                                });
                                it("should reduce user balance on repaid-amount", async () => {
                                  expect(results.userBorrowAssetBalance).approximately(
                                    borrowResults.userBorrowAssetBalance
                                    - plusDebtGap(borrowResults.borrow[0].borrowedAmount, borrowResults.status.debtGapRequired),
                                    0.1
                                  );
                                });
                              });
                              describe("second borrow", function () {
                                let snapshotLevel4: string;
                                let secondBorrowResults: IBorrowRepayPairResults;
                                before(async function () {
                                  snapshotLevel4 = await TimeUtils.snapshot();
                                  secondBorrowResults = await loadFixture(makeSecondBorrowTest);
                                  // console.log("secondBorrowResults", secondBorrowResults);
                                });
                                after(async function () {
                                  await TimeUtils.rollback(snapshotLevel4);
                                });

                                async function makeSecondBorrowTest(): Promise<IBorrowRepayPairResults> {
                                  return BorrowRepayCases.borrowRepayPairsSingleBlock(
                                    signer,
                                    {
                                      tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                                      user: userEmulator,
                                      borrowAsset: assetPair.borrowAsset,
                                      collateralAsset: assetPair.collateralAsset,
                                      receiver: RECEIVER,
                                    },
                                    [{borrow: {amountIn: assetPair.singleParams?.collateralAmountSecond || "0",}}]
                                  );
                                }

                                it("should borrow not zero amount", async () => {
                                  expect(secondBorrowResults.borrow[0].borrowedAmount).gt(0); // stablecoin : stablecoin
                                });
                                it("should modify user balance in expected way", async () => {
                                  expect(secondBorrowResults.userCollateralAssetBalance).eq(
                                    Number(assetPair.singleParams?.userCollateralAssetBalance) - Number(assetPair.singleParams?.collateralAmount) - Number(assetPair.singleParams?.collateralAmountSecond)
                                  );
                                });
                                it("should put borrowed amount on receiver balance", async () => {
                                  expect(secondBorrowResults.receiverBorrowAssetBalance).approximately(borrowResults.borrow[0].borrowedAmount + secondBorrowResults.borrow[0].borrowedAmount, 1e-5);
                                });
                                it("the debt should have health factor near to the target value", async () => {
                                  expect(secondBorrowResults.status.healthFactor).approximately(BorrowRepayCases.getTargetHealthFactor(assetPair, healthFactorsPair), 0.005);
                                });
                              });

                            });
                          });
                          describe("entry kind 1", function () {
                            describe("borrow", function () {
                              let snapshotLevel3: string;
                              let borrowResults: IBorrowRepayPairResults;
                              before(async function () {
                                snapshotLevel3 = await TimeUtils.snapshot();
                                borrowResults = await loadFixture(makeBorrowTest);
                                // console.log("borrowResults", borrowResults);
                              });
                              after(async function () {
                                await TimeUtils.rollback(snapshotLevel3);
                              });

                              async function makeBorrowTest(): Promise<IBorrowRepayPairResults> {
                                return BorrowRepayCases.borrowRepayPairsSingleBlock(
                                  signer,
                                  {
                                    tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                                    user: userEmulator,
                                    borrowAsset: assetPair.borrowAsset,
                                    collateralAsset: assetPair.collateralAsset,
                                    userBorrowAssetBalance: assetPair.singleParams?.userBorrowAssetBalance,
                                    userCollateralAssetBalance: assetPair.singleParams?.userCollateralAssetBalance,
                                    receiver: RECEIVER,
                                  },
                                  [{
                                    borrow: {
                                      amountIn: assetPair.singleParams?.collateralAmount || "0",
                                      entryData: defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [AppConstants.ENTRY_KIND_1, 1, 1])
                                    }
                                  }]
                                );
                              }

                              it("should borrow not zero amount", async () => {
                                expect(borrowResults.borrow[0].borrowedAmount).gt(0);
                              });
                              it("should modify user balance in expected way", async () => {
                                expect(borrowResults.userCollateralAssetBalance).approximately(Number(assetPair.singleParams?.userCollateralAssetBalance) - borrowResults.status.collateralAmount, 1e-5);
                              });
                              it("should put borrowed amount on receiver balance", async () => {
                                expect(borrowResults.receiverBorrowAssetBalance).eq(borrowResults.borrow[0].borrowedAmount);
                              });
                              it("the debt should have health factor near to the target value", async () => {
                                expect(borrowResults.status.healthFactor).approximately(BorrowRepayCases.getTargetHealthFactor(assetPair, healthFactorsPair), 0.005);
                              });
                            });
                          });
                          describe("use 1 token as collateral", function () {
                            describe("borrow", function () {
                              let snapshotLevel3: string;
                              let borrowResults: IBorrowRepayPairResults;
                              before(async function () {
                                snapshotLevel3 = await TimeUtils.snapshot();
                                borrowResults = await loadFixture(makeBorrowTest);
                                // console.log("borrowResults", borrowResults);
                              });
                              after(async function () {
                                await TimeUtils.rollback(snapshotLevel3);
                              });

                              async function makeBorrowTest(): Promise<IBorrowRepayPairResults> {
                                return BorrowRepayCases.borrowRepayPairsSingleBlock(
                                  signer,
                                  {
                                    tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                                    user: userEmulator,
                                    borrowAsset: assetPair.borrowAsset,
                                    collateralAsset: assetPair.collateralAsset,
                                    userBorrowAssetBalance: assetPair.singleParams?.userBorrowAssetBalanceTinyAmount,
                                    userCollateralAssetBalance: assetPair.singleParams?.userCollateralAssetBalanceTinyAmount,
                                    receiver: RECEIVER
                                  },
                                  [{borrow: {amountIn: assetPair.singleParams?.collateralAmountTiny || "0",}}]
                                );
                              }

                              it("should borrow not zero amount", async () => {
                                expect(borrowResults.borrow[0].borrowedAmount).gt(0); // stablecoin : stablecoin
                              });
                              it("should modify user balance in expected way", async () => {
                                expect(borrowResults.userCollateralAssetBalance).approximately(
                                  Number(assetPair.singleParams?.userCollateralAssetBalanceTinyAmount)
                                  - Number(assetPair.singleParams?.collateralAmountTiny),
                                  1e-5
                                );
                              });
                              it("should put borrowed amount on receiver balance", async () => {
                                expect(borrowResults.receiverBorrowAssetBalance).eq(borrowResults.borrow[0].borrowedAmount);
                              });
                              it("the debt should have health factor near to the target value", async () => {
                                expect(borrowResults.status.healthFactor).approximately(BorrowRepayCases.getTargetHealthFactor(assetPair, healthFactorsPair), 0.005);
                              });

                              describe("full repay", function () {
                                let snapshotLevel4: string;
                                let results: IBorrowRepayPairResults;
                                before(async function () {
                                  snapshotLevel4 = await TimeUtils.snapshot();
                                  results = await BorrowRepayCases.borrowRepayPairsSingleBlock(
                                    signer,
                                    {
                                      tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                                      user: userEmulator,
                                      borrowAsset: assetPair.borrowAsset,
                                      collateralAsset: assetPair.collateralAsset,
                                      userBorrowAssetBalance: "0",
                                      userCollateralAssetBalance: "0",
                                      receiver: RECEIVER
                                    },
                                    [{repay: {repayPart: 100_000}}] // full repay
                                  );
                                });
                                after(async function () {
                                  await TimeUtils.rollback(snapshotLevel4);
                                });
                                it("should repay debt completely", async () => {
                                  expect(results.status.amountToPay).eq(0);
                                  expect(results.status.opened).eq(false);
                                  expect(results.status.collateralAmount).eq(0);
                                });
                                it("should return full collateral to the receiver", async () => {
                                  expect(results.receiverCollateralAssetBalance).approximately(
                                    Number(assetPair.singleParams?.collateralAmountTiny),
                                    1e-3
                                  );
                                });
                                it("should reduce user balance on repaid-amount", async () => {
                                  // console.log("borrowResults", borrowResults);
                                  // console.log("results", results);
                                  expect(results.userBorrowAssetBalance).approximately(
                                    Number(assetPair.singleParams?.userBorrowAssetBalanceTinyAmount)
                                    - borrowResults.status.amountToPay,
                                    0.01
                                  );
                                });
                              });
                            });
                          });
                          describe("use max available amount as collateral", function () {
                            describe("borrow", function () {
                              let snapshotLevel3: string;
                              let borrowResults: IBorrowRepayPairResults;
                              before(async function () {
                                snapshotLevel3 = await TimeUtils.snapshot();
                                borrowResults = await loadFixture(makeBorrowTest);
                              });
                              after(async function () {
                                await TimeUtils.rollback(snapshotLevel3);
                              });

                              async function makeBorrowTest(): Promise<IBorrowRepayPairResults> {
                                return BorrowRepayCases.borrowRepayPairsSingleBlock(
                                  signer,
                                  {
                                    tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                                    user: userEmulator,
                                    borrowAsset: assetPair.borrowAsset,
                                    collateralAsset: assetPair.collateralAsset,

                                    // Borrowed amount is put on user's balance
                                    // we assume, that borrowed amount + 100_000  is enough for full repay
                                    userBorrowAssetBalance: assetPair.singleParams?.userBorrowAssetBalanceHugeAmount,
                                    userCollateralAssetBalance: assetPair.hugeCollateralAmount ?? "1000000",
                                  },
                                  [{borrow: {amountIn: "0",}}]
                                );
                              }

                              it("should borrow not zero amount", async () => {
                                expect(borrowResults.borrow[0].borrowedAmount).gt(0);
                              });
                              it("should put borrowed amount on user's balance", async () => {
                                // console.log("borrowResults", borrowResults);
                                expect(borrowResults.userBorrowAssetBalance).approximately(
                                  borrowResults.borrow[0].borrowedAmount + Number(assetPair.singleParams?.userBorrowAssetBalanceHugeAmount),
                                  0.1
                                );
                              });
                              it("the debt should have health factor near to the target value", async () => {
                                expect(borrowResults.status.healthFactor).approximately(
                                  BorrowRepayCases.getTargetHealthFactor(assetPair, healthFactorsPair),
                                  0.005
                                );
                              });

                              describe("full repay", function () {
                                let snapshotLevel4: string;
                                let results: IBorrowRepayPairResults;
                                before(async function () {
                                  snapshotLevel4 = await TimeUtils.snapshot();
                                  results = await BorrowRepayCases.borrowRepayPairsSingleBlock(
                                    signer,
                                    {
                                      tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                                      user: userEmulator,
                                      borrowAsset: assetPair.borrowAsset,
                                      collateralAsset: assetPair.collateralAsset,
                                      userBorrowAssetBalance: "0",
                                      userCollateralAssetBalance: "0",
                                      receiver: RECEIVER
                                    },
                                    [{repay: {repayPart: 100_000}}] // full repay
                                  );
                                });
                                after(async function () {
                                  await TimeUtils.rollback(snapshotLevel4);
                                });
                                it("should repay debt completely", async () => {
                                  expect(results.status.amountToPay).eq(0);
                                  expect(results.status.opened).eq(false);
                                  expect(results.status.collateralAmount).eq(0);
                                });
                                it("should return full collateral to the receiver", async () => {
                                  expect(results.receiverCollateralAssetBalance).approximately(borrowResults.status.collateralAmount, 1);
                                });
                              });
                            });
                          });
                        });
                      }
                    }
                  }
                });
              });
            });
          });

          describe("Borrow/repay multiple actions per block", () => {
            const HEALTH_FACTOR_MIN = "1.03";
            const HEALTH_FACTOR_TARGET = "1.15";

            let snapshotLevel1: string;
            before(async function () {
              snapshotLevel1 = await TimeUtils.snapshot();
              // set up health factors
              await converterController.connect(converterGovernance).setMinHealthFactor2(parseUnits(HEALTH_FACTOR_MIN, 2));
              await converterController.connect(converterGovernance).setTargetHealthFactor2(parseUnits(HEALTH_FACTOR_TARGET, 2));
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLevel1);
            });

            platform.assetPairs.forEach((assetPair: IAssetsPairConfig) => {
              if (assetPair.multipleParams) {
                describe(`${assetPair.collateralAssetName} : ${assetPair.borrowAssetName}`, () => {
                  let snapshotLevel2: string;
                  let userEmulator: UserEmulator;
                  before(async function () {
                    snapshotLevel2 = await TimeUtils.snapshot();
                    userEmulator = await DeployUtils.deployContract(
                      signer,
                      "UserEmulator",
                      converterController.address,
                      assetPair.collateralAsset,
                      assetPair.borrowAsset,
                      PERIOD_IN_BLOCKS
                    ) as UserEmulator;
                    await converterController.connect(converterGovernance).setWhitelistValues([userEmulator.address], true);
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshotLevel2);
                  });

                  describe("borrow, borrow", () => {
                    let snapshotLevel3: string;
                    let borrowResults: IBorrowRepayPairResults;
                    before(async function () {
                      snapshotLevel3 = await TimeUtils.snapshot();
                      borrowResults = await loadFixture(makeBorrowTest);
                      // console.log("borrowResults", borrowResults);
                    });
                    after(async function () {
                      await TimeUtils.rollback(snapshotLevel3);
                    });

                    async function makeBorrowTest(): Promise<IBorrowRepayPairResults> {
                      return BorrowRepayCases.borrowRepayPairsSingleBlock(
                        signer,
                        {
                          tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                          user: userEmulator,
                          borrowAsset: assetPair.borrowAsset,
                          collateralAsset: assetPair.collateralAsset,
                          userBorrowAssetBalance: assetPair.multipleParams?.userBorrowAssetBalance,
                          userCollateralAssetBalance: assetPair.multipleParams?.userCollateralAssetBalance,
                          receiver: RECEIVER
                        },
                        [
                          {borrow: {amountIn: assetPair.multipleParams?.collateralAmount1 || "0",}},
                          {borrow: {amountIn: assetPair.multipleParams?.collateralAmount2 || "0",}}
                        ]
                      );
                    }

                    it("should borrow not zero amount", async () => {
                      expect(borrowResults.borrow[0].borrowedAmount).gt(0);
                      expect(borrowResults.borrow[1].borrowedAmount).gt(0);
                    });
                    it("should modify user balance in expected way", async () => {
                      expect(borrowResults.userCollateralAssetBalance).approximately(
                        Number(assetPair.multipleParams?.userCollateralAssetBalance)
                        - Number(assetPair.multipleParams?.collateralAmount1)
                        - Number(assetPair.multipleParams?.collateralAmount2),
                        1e-5
                      );
                    });
                    it("should put borrowed amount on receiver balance", async () => {
                      expect(borrowResults.receiverBorrowAssetBalance).approximately(
                        borrowResults.borrow[0].borrowedAmount + borrowResults.borrow[1].borrowedAmount,
                        1e-5
                      );
                    });
                    it("the debt should have health factor near to the target value", async () => {
                      expect(borrowResults.status.healthFactor).approximately(Number(HEALTH_FACTOR_TARGET), 1e-3);
                    });

                    describe("full repay, borrow", () => {
                      let snapshotLevel4: string;
                      let results: IBorrowRepayPairResults;
                      before(async function () {
                        snapshotLevel4 = await TimeUtils.snapshot();
                        results = await BorrowRepayCases.borrowRepayPairsSingleBlock(
                          signer,
                          {
                            tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                            user: userEmulator,
                            borrowAsset: assetPair.borrowAsset,
                            collateralAsset: assetPair.collateralAsset,
                            userBorrowAssetBalance: "0",
                            userCollateralAssetBalance: assetPair.multipleParams?.userCollateralAssetBalanceSecond,
                            receiver: RECEIVER
                          },
                          [
                            {repay: {repayPart: 100_000}},
                            {borrow: {amountIn: assetPair.multipleParams?.collateralAmountSecond || "0"}},
                          ] // full repay
                        );
                      });
                      after(async function () {
                        await TimeUtils.rollback(snapshotLevel4);
                      });
                      it("should borrow not zero amount", async () => {
                        expect(results.borrow[0].borrowedAmount).gt(0); // stablecoin : stablecoin
                      });
                      it("should have debt with expected parameters", async () => {
                        expect(results.status.amountToPay).approximately(results.borrow[0].borrowedAmount, 1e-5);
                        expect(results.status.collateralAmount).approximately(Number(assetPair.multipleParams?.collateralAmountSecond), 1e-3);
                        expect(results.status.healthFactor).approximately(Number(HEALTH_FACTOR_TARGET), 1e-6);
                        expect(results.status.opened).eq(true);
                      });
                      it("should modify user balance in expected way", async () => {
                        expect(results.userCollateralAssetBalance).approximately(
                          Number(assetPair.multipleParams?.userCollateralAssetBalance)
                          + Number(assetPair.multipleParams?.userCollateralAssetBalanceSecond)
                          - Number(assetPair.multipleParams?.collateralAmount1)
                          - Number(assetPair.multipleParams?.collateralAmount2)
                          - Number(assetPair.multipleParams?.collateralAmountSecond),
                          1e-5
                        );
                        expect(results.userBorrowAssetBalance).approximately(
                          Number(assetPair.multipleParams?.userBorrowAssetBalance)
                          - plusDebtGap(borrowResults.status.amountToPay, borrowResults.status.debtGapRequired),
                          1e-3
                        );
                      });
                      it("should not leave any tokens the balance of TetuConverter", async () => {
                        expect(results.tetuConverterBorrowAssetBalance + results.tetuConverterCollateralAssetBalance).eq(0);
                      });
                      it("should put borrowed amount on receiver balance", async () => {
                        expect(borrowResults.receiverBorrowAssetBalance).approximately(
                          borrowResults.borrow[0].borrowedAmount
                          + borrowResults.borrow[1].borrowedAmount,
                          1e-5
                        );
                      });
                      it("the debt should have health factor near to the target value", async () => {
                        expect(borrowResults.status.healthFactor).approximately(Number(HEALTH_FACTOR_TARGET), 1e-3);
                      });
                    });
                    describe("repay, full repay", () => {
                      let snapshotLevel4: string;
                      let repayResults: IBorrowRepayPairResults;
                      before(async function () {
                        snapshotLevel4 = await TimeUtils.snapshot();
                        repayResults = await BorrowRepayCases.borrowRepayPairsSingleBlock(
                          signer,
                          {
                            tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                            user: userEmulator,
                            borrowAsset: assetPair.borrowAsset,
                            collateralAsset: assetPair.collateralAsset,
                            userBorrowAssetBalance: "0",
                            userCollateralAssetBalance: "0",
                            receiver: RECEIVER
                          },
                          [
                            {repay: {repayPart: 25_000}},
                            {repay: {repayPart: 100_000}},
                          ] // pay 25%, pay 100%
                        );
                        // console.log("borrowResults", borrowResults);
                        // console.log("repayResults", repayResults);
                      });
                      after(async function () {
                        await TimeUtils.rollback(snapshotLevel4);
                      });

                      it("should repay the debt completely", async () => {
                        expect(repayResults.status.amountToPay).eq(0);
                        expect(repayResults.status.opened).eq(false);
                        expect(repayResults.status.collateralAmount).eq(0);
                      });
                      it("should set expected receiver and user borrow balances", async () => {
                        // console.log("borrowResults", borrowResults);
                        // console.log("results", repayResults);
                        // console.log("assetPair", assetPair);
                        const totalBorrowedAmount = borrowResults.borrow[0].borrowedAmount + borrowResults.borrow[1].borrowedAmount;
                        expect(repayResults.receiverBorrowAssetBalance).approximately(
                          withDebtGap(totalBorrowedAmount, borrowResults.status.debtGapRequired),
                          5 // some part of debt gap can be taken to pay debts
                        );
                        expect(repayResults.userBorrowAssetBalance + repayResults.receiverBorrowAssetBalance).approximately(
                          Number(assetPair.multipleParams?.userBorrowAssetBalance),
                          0.1
                        );
                      });
                      it("should set expected receiver and user collateral balances", async () => {
                        expect(repayResults.receiverCollateralAssetBalance).approximately(
                          Number(assetPair.multipleParams?.collateralAmount1)
                          + Number(assetPair.multipleParams?.collateralAmount2),
                          1e-3
                        );
                        expect(repayResults.userCollateralAssetBalance).approximately(
                          Number(assetPair.multipleParams?.userCollateralAssetBalance)
                          - Number(assetPair.multipleParams?.collateralAmount1)
                          - Number(assetPair.multipleParams?.collateralAmount2),
                          1e-3
                        );
                      });
                      it("should not leave any tokens the balance of TetuConverter", async () => {
                        expect(repayResults.tetuConverterBorrowAssetBalance + repayResults.tetuConverterCollateralAssetBalance).eq(0);
                      });
                    });
                  });
                });
              }
            });
          });
        });
      });
    });
  });
});