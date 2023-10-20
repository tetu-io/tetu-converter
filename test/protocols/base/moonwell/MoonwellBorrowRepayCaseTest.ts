import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowManager__factory,
  ConverterController,
  IMoonwellComptroller, ITetuConverter__factory,
  MoonwellPlatformAdapter, UserEmulator
} from "../../../../typechain";
import {BASE_NETWORK_ID, HardhatUtils} from "../../../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {TetuConverterApp} from "../../../baseUT/app/TetuConverterApp";
import {MoonwellHelper} from "../../../../scripts/integration/moonwell/MoonwellHelper";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {AdaptersHelper} from "../../../baseUT/app/AdaptersHelper";
import {MoonwellUtils} from "../../../baseUT/protocols/moonwell/MoonwellUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {generateAssetPairs} from "../../../baseUT/utils/AssetPairUtils";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {
  BorrowRepayCases, IBorrowRepayPairResults,
} from "../../../baseUT/uses-cases/shared/BorrowRepayCases";
import {expect} from "chai";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {AppConstants} from "../../../baseUT/types/AppConstants";

describe("MoonwellBorrowRepayCaseTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;

  let converterController: ConverterController;
  let converterGovernance: SignerWithAddress;
  let comptroller: IMoonwellComptroller;
  let poolAdapterTemplate: string;
  let platformAdapter: MoonwellPlatformAdapter;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];

    converterController = await TetuConverterApp.createController(signer, {networkId: BASE_NETWORK_ID,});
    comptroller = await MoonwellHelper.getComptroller(signer);

    poolAdapterTemplate = (await AdaptersHelper.createMoonwellPoolAdapter(signer)).address;
    platformAdapter = await DeployUtils.deployContract(
      signer,
      "MoonwellPlatformAdapter",
      converterController.address,
      comptroller.address,
      poolAdapterTemplate,
      MoonwellUtils.getAllCTokens()
    ) as MoonwellPlatformAdapter;

    converterGovernance = await Misc.impersonate(await converterController.governance());
    const borrowManagerAsGov = await BorrowManager__factory.connect(await converterController.borrowManager(), converterGovernance);

    // register the platform adapter in TetuConverter app
    const pairs = generateAssetPairs(MoonwellUtils.getAllAssets());
    await borrowManagerAsGov.addAssetPairs(
      platformAdapter.address,
      pairs.map(x => x.smallerAddress),
      pairs.map(x => x.biggerAddress)
    );
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Unit tests
  interface IHealthFactorsPair {
    minValue: string;
    targetValue: string;
  }
  const HEALTH_FACTOR_PAIRS: IHealthFactorsPair[] = [
    {minValue: "1.05", targetValue: "1.20"},
    {minValue: "1.01", targetValue: "1.03"},
  ];
  interface IAssetsPair {
    collateralAsset: string;
    borrowAsset: string;
  }
  const ASSET_PAIRS: IAssetsPair[] = [
    {collateralAsset: BaseAddresses.USDC, borrowAsset: BaseAddresses.DAI},
    {collateralAsset: BaseAddresses.USDDbC, borrowAsset: BaseAddresses.USDC},
    {collateralAsset: BaseAddresses.DAI, borrowAsset: BaseAddresses.USDDbC},
  ]

  HEALTH_FACTOR_PAIRS.forEach((healthFactorsPair: IHealthFactorsPair) => {
    describe(`hf ${healthFactorsPair.minValue}, ${healthFactorsPair.targetValue}`, () => {
      /** receive all borrowed amounts and collaterals after any repays */
      const RECEIVER = ethers.Wallet.createRandom().address;
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

      ASSET_PAIRS.forEach((assetPair: IAssetsPair) => {
        describe(`${MoonwellUtils.getAssetName(assetPair.collateralAsset)} : ${MoonwellUtils.getAssetName(assetPair.borrowAsset)}`, () => {
          const PERIOD_IN_BLOCKS = 1000;
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

          describe("entry kind 0", () => {
            describe("borrow", () => {
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
                    borrowAssetHolder: MoonwellUtils.getHolder(assetPair.borrowAsset),
                    collateralAssetHolder: MoonwellUtils.getHolder(assetPair.collateralAsset),
                    userBorrowAssetBalance: "1000",
                    userCollateralAssetBalance: "1500",
                    receiver: RECEIVER
                  },
                  [{borrow: {amountIn: "1000",}}]
                );
              }

              it("should borrow not zero amount", async () => {
                expect(borrowResults.borrow[0].borrowedAmount).gt(300); // stablecoin : stablecoin
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

              describe("partial repay", () => {
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
                      borrowAssetHolder: MoonwellUtils.getHolder(assetPair.borrowAsset),
                      collateralAssetHolder: MoonwellUtils.getHolder(assetPair.collateralAsset),
                      userBorrowAssetBalance: "0",
                      userCollateralAssetBalance: "0",
                      receiver: RECEIVER
                    },
                    [{repay: {repayPart: 25_000}}] // pay 25%
                  );
                  console.log("repayResults", repayResults);
                });
                after(async function () {
                  await TimeUtils.rollback(snapshotLevel4);
                });

                it("should reduce debt on expected value", async () => {
                  expect(repayResults.status.amountToPay).approximately(borrowResults.borrow[0].borrowedAmount * 0.75, 1e-3);
                });
                it("should receive expected amount of collateral on receiver's balance", async () => {
                  expect(repayResults.receiverCollateralAssetBalance).approximately(1000 * 0.25, 1e-3);
                });
                it("the debt should have health factor near to the target value", async () => {
                  expect(repayResults.status.healthFactor).approximately(Number(healthFactorsPair.targetValue), 1e-4);
                });
              });
              describe("full repay", () => {
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
                      borrowAssetHolder: MoonwellUtils.getHolder(assetPair.borrowAsset),
                      collateralAssetHolder: MoonwellUtils.getHolder(assetPair.collateralAsset),
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
                  expect(results.userBorrowAssetBalance).approximately(1000 - borrowResults.borrow[0].borrowedAmount, 0.1);
                });
              });
              describe("second borrow", () => {
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
                      borrowAssetHolder: MoonwellUtils.getHolder(assetPair.borrowAsset),
                      collateralAssetHolder: MoonwellUtils.getHolder(assetPair.collateralAsset),
                      receiver: RECEIVER
                    },
                    [{borrow: {amountIn: "100",}}]
                  );
                }

                it("should borrow not zero amount", async () => {
                  expect(secondBorrowResults.borrow[0].borrowedAmount).gt(30); // stablecoin : stablecoin
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
          describe("entry kind 1", () => {
            describe("borrow", () => {
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
                    borrowAssetHolder: MoonwellUtils.getHolder(assetPair.borrowAsset),
                    collateralAssetHolder: MoonwellUtils.getHolder(assetPair.collateralAsset),
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
          describe("use 1 token as collateral", () => {
            describe("borrow", () => {
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
                    borrowAssetHolder: MoonwellUtils.getHolder(assetPair.borrowAsset),
                    collateralAssetHolder: MoonwellUtils.getHolder(assetPair.collateralAsset),
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

              describe("full repay", () => {
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
                      borrowAssetHolder: MoonwellUtils.getHolder(assetPair.borrowAsset),
                      collateralAssetHolder: MoonwellUtils.getHolder(assetPair.collateralAsset),
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
//endregion Unit tests
});