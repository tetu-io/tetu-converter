import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  Aave3PlatformAdapter, AaveTwoPlatformAdapter, Bookkeeper, Bookkeeper__factory,
  BorrowManager,
  BorrowManager__factory,
  ConverterController, IPlatformAdapter, ITetuConverter__factory, MoonwellPlatformAdapter,
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
  BorrowRepayCases, IBookkeeperStatus,
  IAssetsPairConfig, IBorrowRepaySingleActionParams,
} from "../baseUT/uses-cases/shared/BorrowRepayCases";
import {IPlatformUtilsProvider} from "../baseUT/types/IPlatformUtilsProvider";
import {BaseAddresses} from "../../scripts/addresses/BaseAddresses";
import {parseUnits} from "ethers/lib/utils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {AppConstants} from "../baseUT/types/AppConstants";
import {expect} from "chai";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3Utils} from "../baseUT/protocols/aave3/Aave3Utils";
import {Aave3UtilsProviderMatic} from "../baseUT/protocols/aave3/utils-providers/Aave3UtilsProviderMatic";
import {MoonwellUtils} from "../baseUT/protocols/moonwell/MoonwellUtils";
import {MoonwellHelper} from "../../scripts/integration/moonwell/MoonwellHelper";
import {MoonwellUtilsProvider} from "../baseUT/protocols/moonwell/MoonwellUtilsProvider";
import {AaveTwoUtils} from "../baseUT/protocols/aaveTwo/AaveTwoUtils";
import {AaveTwoUtilsProvider} from "../baseUT/protocols/aaveTwo/AaveTwoUtilsProvider";

/** Ensure that all repay/borrow operations are correctly registered in the Bookkeeper */
describe("BookkeeperCaseTest", () => {
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
  const MIN_HEALTH_FACTOR = "1.05";
  const TARGET_HEALTH_FACTOR = "1.15";
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

  const NETWORKS: IChainParams[] = [
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
            {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.USDT, collateralAssetName: "USDC", borrowAssetName: "USDT", minTargetHealthFactor: "1.0625", singleParams: PARAMS_SINGLE_STABLE},
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
            {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.USDT, collateralAssetName: "USDC", borrowAssetName: "USDT", singleParams: PARAMS_SINGLE_STABLE},
          ]
        },

        // todo Compound3
      ]
    },

    { // Base chain
      networkId: BASE_NETWORK_ID,
      platforms: [
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
            {collateralAsset: BaseAddresses.DAI, borrowAsset: BaseAddresses.USDbC, collateralAssetName: "DAI", borrowAssetName: "USDbC", singleParams: PARAMS_SINGLE_STABLE},
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
  let bookkeeper: Bookkeeper;
//endregion Global vars for all tests

  NETWORKS.forEach(network => {
    describe(`${network.networkId}`, function () {
      before(async function () {
        await HardhatUtils.setupBeforeTest(network.networkId, network.block);
        this.timeout(1200000);

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;

        snapshot = await TimeUtils.snapshot();
        const signers = await ethers.getSigners();
        signer = signers[0];

        converterController = await TetuConverterApp.createController(signer, {networkId: network.networkId});
        converterGovernance = await Misc.impersonate(await converterController.governance());
        borrowManagerAsGov = await BorrowManager__factory.connect(await converterController.borrowManager(), converterGovernance);
        bookkeeper = await Bookkeeper__factory.connect(await converterController.bookkeeper(), signer);
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      network.platforms.forEach(platform => {
        describe(`${platform.platformUtilsProviderBuilder().getPlatformName()}`, function () {
          let platformUtilsProvider: IPlatformUtilsProvider;
          let snapshotLevelRoot: string;
          before(async function () {
            snapshotLevelRoot = await TimeUtils.snapshot();

            await platform.platformAdapterBuilder(signer, converterController.address, borrowManagerAsGov);
            platformUtilsProvider = platform.platformUtilsProviderBuilder();

            // set up health factors
            await converterController.connect(converterGovernance).setMinHealthFactor2(parseUnits(MIN_HEALTH_FACTOR, 2));
            await converterController.connect(converterGovernance).setTargetHealthFactor2(parseUnits(TARGET_HEALTH_FACTOR, 2));
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLevelRoot);
          });

          platform.assetPairs.forEach(function (assetPair: IAssetsPairConfig) {
            if (assetPair.singleParams) {
              describe(`${assetPair.collateralAssetName} : ${assetPair.borrowAssetName}`, function () {
                let snapshotLevel0: string;
                let userEmulator: UserEmulator;
                before(async function () {
                  snapshotLevel0 = await TimeUtils.snapshot();
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
                  await TimeUtils.rollback(snapshotLevel0);
                });

                describe("first borrow", function () {
                  let snapshotLevel1: string;
                  let ret1: IBookkeeperStatus;
                  before(async function () {
                    snapshotLevel1 = await TimeUtils.snapshot();
                    ret1 = await loadFixture(makeBorrowTest);
                    // console.log("ret1", ret1);
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshotLevel1);
                  });

                  async function makeBorrowTest(): Promise<IBookkeeperStatus> {
                    return BorrowRepayCases.borrowRepayPairsSingleBlockBookkeeper(
                      signer,
                      {
                        tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                        user: userEmulator,
                        borrowAsset: assetPair.borrowAsset,
                        collateralAsset: assetPair.collateralAsset,
                        borrowAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.borrowAsset),
                        collateralAssetHolder: platformUtilsProvider.getAssetHolder(assetPair.collateralAsset),
                        userBorrowAssetBalance: assetPair.singleParams?.userBorrowAssetBalance,
                        userCollateralAssetBalance: assetPair.singleParams?.userCollateralAssetBalance,
                        receiver: RECEIVER
                      },
                      [{borrow: {amountIn: assetPair.singleParams?.collateralAmount || "0",}}]
                    );
                  }

                  it("should add borrow action to Bookkeeper", async () => {
                    expect(ret1.actions.length).eq(1);
                    expect(ret1.actions[0].actionKind).eq(AppConstants.ACTION_KIND_BORROW_0);
                  });
                  it("should assigned expected amounts to the action", async () => {
                    expect(ret1.actions[0].suppliedAmount).approximately(Number(assetPair.singleParams?.collateralAmount) || 0, 1e-5);
                    expect(ret1.actions[0].borrowedAmount).approximately(ret1.results.status.amountToPay, 1e-5);
                  });
                  it("should register the pool adapter for the user", async () => {
                    expect(ret1.poolAdaptersForUser.length).eq(1);
                  });

                  describe("partial repay", function () {
                    const REPAY_PARTS = [1000, 25_000, 98_900];

                    REPAY_PARTS.forEach(repayPart => {
                      describe(`repay part ${repayPart / 100_000}`, function () {
                        let snapshotLevel2: string;
                        let ret2: IBookkeeperStatus;
                        before(async function () {
                          snapshotLevel2 = await TimeUtils.snapshot();
                          ret2 = await BorrowRepayCases.borrowRepayPairsSingleBlockBookkeeper(
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
                          // console.log("ret2", ret2);
                        });
                        after(async function () {
                          await TimeUtils.rollback(snapshotLevel2);
                        });

                        it("should add repay action to Bookkeeper", async () => {
                          expect(ret2.actions.length).eq(2);
                          expect(ret2.actions[0].actionKind).eq(AppConstants.ACTION_KIND_BORROW_0);
                          expect(ret2.actions[1].actionKind).eq(AppConstants.ACTION_KIND_REPAY_1);
                        });
                        it("should not change amounts in the borrow action", async () => {
                          expect(ret2.actions[0].suppliedAmount).eq(ret1.actions[0].suppliedAmount);
                          expect(ret2.actions[0].borrowedAmount).eq(ret1.actions[0].borrowedAmount);
                        });
                        it("should assign expected amounts to the repay action (assume that increases to debt/collateral are neglect)", async () => {
                          const paidAmount = ret1.results.userBorrowAssetBalance - ret2.results.userBorrowAssetBalance;
                          const debtGapReturned = ret2.results.receiverBorrowAssetBalance - ret1.results.receiverBorrowAssetBalance;
                          // console.log("paidAmount", paidAmount);
                          // console.log("debtGapReturned", debtGapReturned);
                          // console.log("ret1", ret1);
                          // console.log("ret2", ret2);
                          expect(ret2.actions[1].suppliedAmount).approximately(
                            ret1.actions[0].suppliedAmount - ret2.results.repay[0].collateralAmount,
                            1e-5
                          );
                          expect(ret2.actions[1].borrowedAmount - ret2.actions[1].repayInfo.loss).approximately(
                            ret1.actions[0].borrowedAmount - paidAmount + debtGapReturned,
                            1e-5
                          );
                        });
                        it("should not unregister the pool adapter for the user", async () => {
                          expect(ret1.poolAdaptersForUser.length).eq(1);
                        });
                      });
                    });
                  });
                  describe("full repay", function () {
                    let snasnapshotLevel2: string;
                    let ret2: IBookkeeperStatus;
                    before(async function () {
                      snasnapshotLevel2 = await TimeUtils.snapshot();
                      ret2 = await BorrowRepayCases.borrowRepayPairsSingleBlockBookkeeper(
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
                      await TimeUtils.rollback(snasnapshotLevel2);
                    });
                    it("should add repay action to Bookkeeper", async () => {
                      expect(ret2.actions.length).eq(2);
                      expect(ret2.actions[0].actionKind).eq(AppConstants.ACTION_KIND_BORROW_0);
                      expect(ret2.actions[1].actionKind).eq(AppConstants.ACTION_KIND_REPAY_1);
                    });
                    it("should not change amounts in the borrow action", async () => {
                      expect(ret2.actions[0].suppliedAmount).eq(ret1.actions[0].suppliedAmount);
                      expect(ret2.actions[0].borrowedAmount).eq(ret1.actions[0].borrowedAmount);
                    });
                    it("should assign expected amounts to the repay action (assume that increases to debt/collateral are neglect)", async () => {
                      expect(ret2.actions[1].suppliedAmount).eq(0);
                      expect(ret2.actions[1].borrowedAmount).eq(0);
                    });
                    it("should not unregister the pool adapter for the user", async () => {
                      expect(ret1.poolAdaptersForUser.length).eq(1);
                    });
                  });
                  describe("second borrow", function () {
                    let snasnapshotLevel2: string;
                    let ret2: IBookkeeperStatus;
                    before(async function () {
                      snasnapshotLevel2 = await TimeUtils.snapshot();
                      ret2 = await loadFixture(makeSecondBorrowTest);
                    });
                    after(async function () {
                      await TimeUtils.rollback(snasnapshotLevel2);
                    });

                    async function makeSecondBorrowTest(): Promise<IBookkeeperStatus> {
                      return BorrowRepayCases.borrowRepayPairsSingleBlockBookkeeper(
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
                        [{borrow: {amountIn: assetPair.singleParams?.collateralAmountSecond || "0",}}]
                      );
                    }

                    it("should add second borrow action to Bookkeeper", async () => {
                      expect(ret2.actions.length).eq(2);
                      expect(ret2.actions[0].actionKind).eq(AppConstants.ACTION_KIND_BORROW_0);
                      expect(ret2.actions[1].actionKind).eq(AppConstants.ACTION_KIND_BORROW_0);
                    });
                    it("should not change amounts in the first borrow action", async () => {
                      expect(ret2.actions[0].suppliedAmount).eq(ret1.actions[0].suppliedAmount);
                      expect(ret2.actions[0].borrowedAmount).eq(ret1.actions[0].borrowedAmount);
                    });
                    it("should assign expected amounts to the second borrow action (assume that increases to debt/collateral are neglect)", async () => {
                      const collateralSupplied = ret1.results.userCollateralAssetBalance - ret2.results.userCollateralAssetBalance;
                      const borrowAmountReceived = ret2.results.receiverBorrowAssetBalance - ret1.results.receiverBorrowAssetBalance;
                      expect(ret2.actions[1].suppliedAmount).eq(ret2.actions[0].suppliedAmount + collateralSupplied);
                      expect(ret2.actions[1].borrowedAmount).eq(ret2.actions[0].borrowedAmount + borrowAmountReceived);
                    });
                    it("should not unregister the pool adapter for the user", async () => {
                      expect(ret1.poolAdaptersForUser.length).eq(1);
                    });
                  });
                  describe("repay to rebalance", () => {
                    // TODO
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