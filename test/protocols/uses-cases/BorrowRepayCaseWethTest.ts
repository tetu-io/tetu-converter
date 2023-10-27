import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  Aave3PlatformAdapter, AaveTwoPlatformAdapter,
  BorrowManager,
  BorrowManager__factory,
  ConverterController, DForcePlatformAdapter, HfPlatformAdapter,
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
  IAssetsPairConfig,
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
import {plusDebtGap, withDebtGap} from "../../baseUT/utils/DebtGapUtils";
import {MoonwellUtils} from "../../baseUT/protocols/moonwell/MoonwellUtils";
import {MoonwellHelper} from "../../../scripts/integration/moonwell/MoonwellHelper";
import {MoonwellUtilsProvider} from "../../baseUT/protocols/moonwell/MoonwellUtilsProvider";
import {Aave3UtilsProviderBase} from "../../baseUT/protocols/aave3/utils-providers/Aave3UtilsProviderBase";
import {HundredFinanceUtilsProvider} from "../../baseUT/protocols/hundred-finance/HundredFinanceUtilsProvider";
import {HundredFinanceUtils} from "../../baseUT/protocols/hundred-finance/HundredFinanceUtils";
import {AaveTwoUtils} from "../../baseUT/protocols/aaveTwo/AaveTwoUtils";
import {AaveTwoUtilsProvider} from "../../baseUT/protocols/aaveTwo/AaveTwoUtilsProvider";
import {DForceUtils} from "../../baseUT/protocols/dforce/DForceUtils";
import {DForceUtilsProvider} from "../../baseUT/protocols/dforce/DForceUtilsProvider";
import {InjectUtils} from "../../baseUT/chains/base/InjectUtils";

describe("BorrowRepayCaseTest (WETH)", () => {
  interface IChainParams {
    networkId: number;
    platforms: IPlatformParams[];
  }
  interface IPlatformParams {
    platformAdapterBuilder: (signer: SignerWithAddress, converterController: string, borrowManagerAsGov: BorrowManager) => Promise<IPlatformAdapter>;
    platformUtilsProviderBuilder: () => IPlatformUtilsProvider,
    assetPairs: IAssetsPairConfig[];
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
            {collateralAsset: MaticAddresses.WETH, borrowAsset: MaticAddresses.wstETH, collateralAssetName: "WETH", borrowAssetName: "wstETH"},
              // currently AAVE3 has very low supply cap ~0.001, we need to set supply cap manually for this test
            // {collateralAsset: MaticAddresses.wstETH, borrowAsset: MaticAddresses.WETH, collateralAssetName: "wstETH", borrowAssetName: "WETH"},
          ]
        },
      ]
    },

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
            {collateralAsset: BaseAddresses.cbETH, borrowAsset: BaseAddresses.WETH, collateralAssetName: "cbETH", borrowAssetName: "WETH"},
            {collateralAsset: BaseAddresses.WETH, borrowAsset: BaseAddresses.cbETH, collateralAssetName: "WETH", borrowAssetName: "cbETH"},
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
              // {minValue: "1.01", targetValue: "1.03"},  // 1.03 is not correct value for AAVE, 1.05 is min
              {minValue: "1.05", targetValue: "1.15"},
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
                  if (!healthFactorsPair.singleAssetPairOnly || assetPair === platform.assetPairs[0]) {
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
                                userBorrowAssetBalance: "10",
                                userCollateralAssetBalance: "15",
                                receiver: RECEIVER
                              },
                              [{borrow: {amountIn: "10",}}]
                            );
                          }

                          it("should borrow not zero amount", async () => {
                            expect(borrowResults.borrow[0].borrowedAmount).gt(0); // stablecoin : stablecoin
                          });
                          it("should modify user balance in expected way", async () => {
                            expect(borrowResults.userCollateralAssetBalance).eq(5);
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
                                    plusDebtGap(10, borrowResults.status.debtGapRequired, repayPart),
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
                              expect(results.receiverCollateralAssetBalance).approximately(10, 1e-3);
                            });
                            it("should reduce user balance on repaid-amount", async () => {
                              expect(results.userBorrowAssetBalance).approximately(
                                10 - plusDebtGap(borrowResults.borrow[0].borrowedAmount, borrowResults.status.debtGapRequired),
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
                                  receiver: RECEIVER,
                                },
                                [{borrow: {amountIn: "0.1",}}]
                              );
                            }

                            it("should borrow not zero amount", async () => {
                              expect(secondBorrowResults.borrow[0].borrowedAmount).gt(0); // stablecoin : stablecoin
                            });
                            it("should modify user balance in expected way", async () => {
                              expect(secondBorrowResults.userCollateralAssetBalance).eq(5 - 0.1);
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
                                userBorrowAssetBalance: "10",
                                userCollateralAssetBalance: "15",
                                receiver: RECEIVER,
                              },
                              [{
                                borrow: {
                                  amountIn: "10",
                                  entryData: defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [AppConstants.ENTRY_KIND_1, 1, 1])
                                }
                              }]
                            );
                          }

                          it("should borrow not zero amount", async () => {
                            expect(borrowResults.borrow[0].borrowedAmount).gt(0);
                          });
                          it("should modify user balance in expected way", async () => {
                            expect(borrowResults.userCollateralAssetBalance).approximately(15 - borrowResults.status.collateralAmount, 1e-5);
                          });
                          it("should put borrowed amount on receiver balance", async () => {
                            expect(borrowResults.receiverBorrowAssetBalance).eq(borrowResults.borrow[0].borrowedAmount);
                          });
                          it("the debt should have health factor near to the target value", async () => {
                            expect(borrowResults.status.healthFactor).approximately(BorrowRepayCases.getTargetHealthFactor(assetPair, healthFactorsPair), 0.005);
                          });
                        });
                      });
                      describe("use small amount as collateral", function () {
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
                                userBorrowAssetBalance: "0.001",
                                userCollateralAssetBalance: "0.0015",
                                receiver: RECEIVER
                              },
                              [{borrow: {amountIn: "0.001",}}]
                            );
                          }

                          it("should borrow not zero amount", async () => {
                            expect(borrowResults.borrow[0].borrowedAmount).gt(0);
                          });
                          it("should modify user balance in expected way", async () => {
                            expect(borrowResults.userCollateralAssetBalance).eq(0.0005);
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
                              expect(results.receiverCollateralAssetBalance).approximately(borrowResults.status.collateralAmount, 1e-3);
                            });
                            it("should reduce user balance on repaid-amount", async () => {
                              expect(results.userBorrowAssetBalance).approximately(0.001 - borrowResults.borrow[0].borrowedAmount, 0.01);
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

                                  // Borrowed amount is put on user's balance
                                  // we assume, that borrowed amount + 10  is enough for full repay
                                userBorrowAssetBalance: "10",
                                userCollateralAssetBalance: Number.MAX_SAFE_INTEGER.toString(),
                                additionalCollateralAssetHolders: platformUtilsProvider.getAdditionalAssetHolders(assetPair.borrowAsset),
                              },
                              [{borrow: {amountIn: "0",}}]
                            );
                          }

                          it("should borrow not zero amount", async () => {
                            expect(borrowResults.borrow[0].borrowedAmount).gt(0);
                          });
                          it("should put borrowed amount on user's balance", async () => {
                            expect(borrowResults.userBorrowAssetBalance).approximately(borrowResults.borrow[0].borrowedAmount + 10, 0.1);
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
                              expect(results.receiverCollateralAssetBalance).approximately(borrowResults.status.collateralAmount, 1);
                            });
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
  });
});