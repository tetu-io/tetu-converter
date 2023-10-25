import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  Aave3PlatformAdapter,
  BorrowManager,
  BorrowManager__factory,
  ConverterController, HfPlatformAdapter,
  IPlatformAdapter, ITetuConverter__factory, MoonwellPlatformAdapter,
  UserEmulator
} from "../../../typechain";
import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {TetuConverterApp} from "../../baseUT/app/TetuConverterApp";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {AdaptersHelper} from "../../baseUT/app/AdaptersHelper";
import {Misc} from "../../../scripts/utils/Misc";
import {generateAssetPairs} from "../../baseUT/utils/AssetPairUtils";
import {
  BorrowRepayCases,
  IAssetsPair,
  IBorrowRepayPairResults,
  IHealthFactorsPair,
} from "../../baseUT/uses-cases/shared/BorrowRepayCases";
import {IPlatformUtilsProvider} from "../../baseUT/types/IPlatformUtilsProvider";
import {BaseAddresses} from "../../../scripts/addresses/BaseAddresses";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {AppConstants} from "../../baseUT/types/AppConstants";
import {expect} from "chai";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {Aave3Utils} from "../../baseUT/protocols/aave3/Aave3Utils";
import {Aave3UtilsProviderMatic} from "../../baseUT/protocols/aave3/utils-providers/Aave3UtilsProviderMatic";
import {plusDebtGap} from "../../baseUT/utils/DebtGapUtils";
import {MoonwellUtils} from "../../baseUT/protocols/moonwell/MoonwellUtils";
import {MoonwellHelper} from "../../../scripts/integration/moonwell/MoonwellHelper";
import {MoonwellUtilsProvider} from "../../baseUT/protocols/moonwell/MoonwellUtilsProvider";
import {Aave3UtilsProviderBase} from "../../baseUT/protocols/aave3/utils-providers/Aave3UtilsProviderBase";
import {HundredFinanceUtilsProvider} from "../../baseUT/protocols/hundred-finance/HundredFinanceUtilsProvider";
import {HundredFinanceUtils} from "../../baseUT/protocols/hundred-finance/HundredFinanceUtils";

describe("BorrowRepayCaseTest", () => {
  interface IChainParams {
    networkId: number;
    platforms: IPlatformParams[];
  }
  interface IPlatformParams {
    platformAdapterBuilder: (signer: SignerWithAddress, converterController: string, borrowManagerAsGov: BorrowManager) => Promise<IPlatformAdapter>;
    platformUtilsProviderBuilder: () => IPlatformUtilsProvider,
    assetPairs: IAssetsPair[];
  }

//region Constants
  const RECEIVER = ethers.Wallet.createRandom().address;
  const PERIOD_IN_BLOCKS = 1000;

  const NETWORKS: IChainParams[] = [
    { // Polygon
      networkId: POLYGON_NETWORK_ID,
      platforms: [
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
            {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.USDT, collateralAssetName: "USDC", borrowAssetName: "USDT"},
            {collateralAsset: MaticAddresses.USDT, borrowAsset: MaticAddresses.USDC, collateralAssetName: "USDT", borrowAssetName: "USDC"},

            {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.DAI, collateralAssetName: "USDC", borrowAssetName: "DAI"},
            {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.USDC, collateralAssetName: "DAI", borrowAssetName: "USDC"},

            {collateralAsset: MaticAddresses.WMATIC, borrowAsset: MaticAddresses.MaticX, collateralAssetName: "WMATIC", borrowAssetName: "MaticX"},
          ]
        },
        // { // Hundred finance on Polygon: todo check on manually deployed protocol
        //   platformUtilsProviderBuilder() {
        //     return new HundredFinanceUtilsProvider();
        //   },
        //   async platformAdapterBuilder(signer0: SignerWithAddress, converterController0: string, borrowManagerAsGov0: BorrowManager): Promise<IPlatformAdapter> {
        //     const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
        //       signer0,
        //       converterController0,
        //       MaticAddresses.HUNDRED_FINANCE_COMPTROLLER,
        //       (await AdaptersHelper.createHundredFinancePoolAdapter(signer0)).address,
        //       HundredFinanceUtils.getAllCTokens(),
        //       borrowManagerAsGov0.address,
        //     ) as HfPlatformAdapter;
        //
        //     // register the platform adapter in TetuConverter app
        //     const pairs = generateAssetPairs(HundredFinanceUtils.getAllAssets());
        //     await borrowManagerAsGov0.addAssetPairs(
        //       platformAdapter.address,
        //       pairs.map(x => x.smallerAddress),
        //       pairs.map(x => x.biggerAddress)
        //     );
        //
        //     return platformAdapter;
        //   },
        //   assetPairs: [
        //     {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.USDT, collateralAssetName: "USDC", borrowAssetName: "USDT"},
        //     {collateralAsset: MaticAddresses.USDT, borrowAsset: MaticAddresses.USDC, collateralAssetName: "USDT", borrowAssetName: "USDC"},
        //
        //     {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.DAI, collateralAssetName: "USDC", borrowAssetName: "DAI"},
        //     {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.USDC, collateralAssetName: "DAI", borrowAssetName: "USDC"},
        //   ]
        // },
      ]
    },

    { // Base chain
      networkId: BASE_NETWORK_ID,
      platforms: [
        // { // AAVE3 on Base chain: todo uncomment when AAVE will have 2 stablecoins on Base chain
        //   platformUtilsProviderBuilder() {
        //     return new Aave3UtilsProviderBase();
        //   },
        //   async platformAdapterBuilder(signer0: SignerWithAddress, converterController0: string, borrowManagerAsGov0: BorrowManager): Promise<IPlatformAdapter> {
        //     const platformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
        //       signer0,
        //       converterController0,
        //       BaseAddresses.AAVE_V3_POOL,
        //       (await AdaptersHelper.createAave3PoolAdapter(signer0)).address,
        //       (await AdaptersHelper.createAave3PoolAdapterEMode(signer0)).address,
        //       borrowManagerAsGov0.address,
        //     ) as Aave3PlatformAdapter;
        //
        //     // register the platform adapter in TetuConverter app
        //     const pairs = generateAssetPairs(Aave3Utils.getAllAssetsBase());
        //     await borrowManagerAsGov0.addAssetPairs(
        //       platformAdapter.address,
        //       pairs.map(x => x.smallerAddress),
        //       pairs.map(x => x.biggerAddress)
        //     );
        //
        //     return platformAdapter;
        //   },
        //   assetPairs: [
        //     {collateralAsset: BaseAddresses.USDbC, borrowAsset: BaseAddresses.WETH, collateralAssetName: "USDbC", borrowAssetName: "WETH"},
        //   ]
        // },
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
            {collateralAsset: BaseAddresses.USDC, borrowAsset: BaseAddresses.USDbC, collateralAssetName: "USDC", borrowAssetName: "USDbC"},
            {collateralAsset: BaseAddresses.USDbC, borrowAsset: BaseAddresses.USDC, collateralAssetName: "USDbC", borrowAssetName: "USDC"},

            {collateralAsset: BaseAddresses.DAI, borrowAsset: BaseAddresses.USDbC, collateralAssetName: "DAI", borrowAssetName: "USDbC"},
            {collateralAsset: BaseAddresses.USDbC, borrowAsset: BaseAddresses.DAI, collateralAssetName: "USDbC", borrowAssetName: "DAI"},

            {collateralAsset: BaseAddresses.USDC, borrowAsset: BaseAddresses.DAI, collateralAssetName: "USDC", borrowAssetName: "DAI"},
            {collateralAsset: BaseAddresses.DAI, borrowAsset: BaseAddresses.USDC, collateralAssetName: "DAI", borrowAssetName: "USDC"},
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
        await HardhatUtils.setupBeforeTest(network.networkId);
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
              {minValue: "1.01", targetValue: "1.03"},
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

                platform.assetPairs.forEach(function (assetPair: IAssetsPair) {
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
                          console.log("borrowResults", borrowResults);
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
                              borrowAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.borrowAsset),
                              collateralAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.collateralAsset),
                              userBorrowAssetBalance: "1000",
                              userCollateralAssetBalance: "1500",
                              receiver: RECEIVER
                            },
                            [{borrow: {amountIn: "1000",}}]
                          );
                        }

                        it("should borrow not zero amount", async () => {
                          expect(borrowResults.borrow[0].borrowedAmount).gt(0); // stablecoin : stablecoin
                        });
                        it("should modify user balance in expected way", async () => {
                          expect(borrowResults.userCollateralAssetBalance).eq(500);
                        });
                        it("should put borrowed amount on receiver balance", async () => {
                          expect(borrowResults.receiverBorrowAssetBalance).eq(borrowResults.borrow[0].borrowedAmount);
                        });
                        it("the debt should have health factor near to the target value", async () => {
                          expect(borrowResults.status.healthFactor).approximately(Number(healthFactorsPair.targetValue), 1e-3);
                        });

                        describe("partial repay", function () {
                          const REPAY_PARTS = [1000, 25_000, 98_900];

                          REPAY_PARTS.forEach(repayPart => {
                            describe(`repay part ${repayPart/100_000}`, function () {
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
                                    borrowAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.borrowAsset),
                                    collateralAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.collateralAsset),
                                    userBorrowAssetBalance: "0",
                                    userCollateralAssetBalance: "0",
                                    receiver: RECEIVER
                                  },
                                  [{repay: {repayPart}}]
                                );
                                console.log("repayResults", repayResults);
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
                                  plusDebtGap(1000, borrowResults.status.debtGapRequired, repayPart),
                                  1e-3
                                );
                              });
                              it("the debt should have health factor >= target value", async () => {
                                expect(repayResults.status.healthFactor).approximately(
                                  Number(healthFactorsPair.targetValue),
                                  repayPart > 99_000 ? 0.01 : 1e-4
                                );
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
                                borrowAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.borrowAsset),
                                collateralAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.collateralAsset),
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
                            expect(results.receiverCollateralAssetBalance).approximately(1000, 1e-3);
                          });
                          it("should reduce user balance on repaid-amount", async () => {
                            expect(results.userBorrowAssetBalance).approximately(
                              1000 - plusDebtGap(borrowResults.borrow[0].borrowedAmount, borrowResults.status.debtGapRequired),
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
                            console.log("secondBorrowResults", secondBorrowResults);
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
                                borrowAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.borrowAsset),
                                collateralAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.collateralAsset),
                                receiver: RECEIVER
                              },
                              [{borrow: {amountIn: "100",}}]
                            );
                          }

                          it("should borrow not zero amount", async () => {
                            expect(secondBorrowResults.borrow[0].borrowedAmount).gt(0); // stablecoin : stablecoin
                          });
                          it("should modify user balance in expected way", async () => {
                            expect(secondBorrowResults.userCollateralAssetBalance).eq(500 - 100);
                          });
                          it("should put borrowed amount on receiver balance", async () => {
                            expect(secondBorrowResults.receiverBorrowAssetBalance).approximately(borrowResults.borrow[0].borrowedAmount + secondBorrowResults.borrow[0].borrowedAmount, 1e-5);
                          });
                          it("the debt should have health factor near to the target value", async () => {
                            expect(secondBorrowResults.status.healthFactor).approximately(Number(healthFactorsPair.targetValue), 1e-3);
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
                          console.log("borrowResults", borrowResults);
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
                              borrowAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.borrowAsset),
                              collateralAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.collateralAsset),
                              userBorrowAssetBalance: "1000",
                              userCollateralAssetBalance: "1500",
                              receiver: RECEIVER,
                            },
                            [{
                              borrow: {
                                amountIn: "1000",
                                entryData: defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [AppConstants.ENTRY_KIND_1, 1, 1])
                              }
                            }]
                          );
                        }

                        it("should borrow not zero amount", async () => {
                          expect(borrowResults.borrow[0].borrowedAmount).gt(0);
                        });
                        it("should modify user balance in expected way", async () => {
                          expect(borrowResults.userCollateralAssetBalance).approximately(1500 - borrowResults.status.collateralAmount, 1e-5);
                        });
                        it("should put borrowed amount on receiver balance", async () => {
                          expect(borrowResults.receiverBorrowAssetBalance).eq(borrowResults.borrow[0].borrowedAmount);
                        });
                        it("the debt should have health factor near to the target value", async () => {
                          expect(borrowResults.status.healthFactor).approximately(Number(healthFactorsPair.targetValue), 1e-3);
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
                          console.log("borrowResults", borrowResults);
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
                              borrowAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.borrowAsset),
                              collateralAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.collateralAsset),
                              userBorrowAssetBalance: "1",
                              userCollateralAssetBalance: "1.5",
                              receiver: RECEIVER
                            },
                            [{borrow: {amountIn: "1",}}]
                          );
                        }

                        it("should borrow not zero amount", async () => {
                          expect(borrowResults.borrow[0].borrowedAmount).gt(0.3); // stablecoin : stablecoin
                        });
                        it("should modify user balance in expected way", async () => {
                          expect(borrowResults.userCollateralAssetBalance).eq(0.5);
                        });
                        it("should put borrowed amount on receiver balance", async () => {
                          expect(borrowResults.receiverBorrowAssetBalance).eq(borrowResults.borrow[0].borrowedAmount);
                        });
                        it("the debt should have health factor near to the target value", async () => {
                          expect(borrowResults.status.healthFactor).approximately(Number(healthFactorsPair.targetValue), 1e-3);
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
                                borrowAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.borrowAsset),
                                collateralAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.collateralAsset),
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
                            expect(results.receiverCollateralAssetBalance).approximately(1, 1e-3);
                          });
                          it("should reduce user balance on repaid-amount", async () => {
                            expect(results.userBorrowAssetBalance).approximately(1 - borrowResults.borrow[0].borrowedAmount, 0.01);
                          });
                        });
                      });
                    });
                  });
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

            platform.assetPairs.forEach((assetPair: IAssetsPair) => {
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
                    console.log("borrowResults", borrowResults);
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
                        borrowAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.borrowAsset),
                        collateralAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.collateralAsset),
                        userBorrowAssetBalance: "2000",
                        userCollateralAssetBalance: "1500",
                        receiver: RECEIVER
                      },
                      [
                        {borrow: {amountIn: "1000",}},
                        {borrow: {amountIn: "400",}}
                      ]
                    );
                  }

                  it("should borrow not zero amount", async () => {
                    expect(borrowResults.borrow[0].borrowedAmount).gt(300); // stablecoin : stablecoin
                    expect(borrowResults.borrow[1].borrowedAmount).gt(100); // stablecoin : stablecoin
                  });
                  it("should modify user balance in expected way", async () => {
                    expect(borrowResults.userCollateralAssetBalance).eq(100);
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
                          borrowAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.borrowAsset),
                          collateralAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.collateralAsset),
                          userBorrowAssetBalance: "0",
                          userCollateralAssetBalance: "1000",
                          receiver: RECEIVER
                        },
                        [
                          {repay: {repayPart: 100_000}},
                          {borrow: {amountIn: "800"}},
                        ] // full repay
                      );
                    });
                    after(async function () {
                      await TimeUtils.rollback(snapshotLevel4);
                    });
                    it("should borrow not zero amount", async () => {
                      expect(results.borrow[0].borrowedAmount).gt(200); // stablecoin : stablecoin
                    });
                    it("should have debt with expected parameters", async () => {
                      expect(results.status.amountToPay).approximately(results.borrow[0].borrowedAmount, 1e-5);
                      expect(results.status.collateralAmount).approximately(800, 1e-3);
                      expect(results.status.healthFactor).approximately(Number(HEALTH_FACTOR_TARGET), 1e-6);
                      expect(results.status.opened).eq(true);
                    });
                    it("should modify user balance in expected way", async () => {
                      expect(results.userCollateralAssetBalance).eq(2500 - 1400 - 800);
                      expect(results.userBorrowAssetBalance).approximately(2000 - plusDebtGap(borrowResults.status.amountToPay, borrowResults.status.debtGapRequired), 1e-3);
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
                          borrowAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.borrowAsset),
                          collateralAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.collateralAsset),
                          userBorrowAssetBalance: "0",
                          userCollateralAssetBalance: "0",
                          receiver: RECEIVER
                        },
                        [
                          {repay: {repayPart: 25_000}},
                          {repay: {repayPart: 100_000}},
                        ] // pay 25%, pay 100%
                      );
                      console.log("borrowResults", borrowResults);
                      console.log("repayResults", repayResults);
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
                      const totalBorrowedAmount = borrowResults.borrow[0].borrowedAmount + borrowResults.borrow[1].borrowedAmount;
                      expect(repayResults.receiverBorrowAssetBalance).gt(totalBorrowedAmount);
                      expect(repayResults.userBorrowAssetBalance + repayResults.receiverBorrowAssetBalance).approximately(2000,0.1);
                    });
                    it("should set expected receiver and user collateral balances", async () => {
                      expect(repayResults.receiverCollateralAssetBalance).approximately(1000 + 400, 1e-3);
                      expect(repayResults.userCollateralAssetBalance).approximately(1500 - 1000 - 400, 1e-3);
                    });
                    it("should not leave any tokens the balance of TetuConverter", async () => {
                      expect(repayResults.tetuConverterBorrowAssetBalance + repayResults.tetuConverterCollateralAssetBalance).eq(0);
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});