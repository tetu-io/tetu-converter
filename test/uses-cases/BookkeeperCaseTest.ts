import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  Aave3PlatformAdapter,
  AaveTwoPlatformAdapter,
  Bookkeeper,
  Bookkeeper__factory,
  BorrowManager,
  BorrowManager__factory,
  Compound3PlatformAdapter,
  ConverterController,
  IERC20Metadata__factory,
  IPlatformAdapter,
  IPoolAdapter__factory,
  ITetuConverter__factory, KeomPlatformAdapter,
  MoonwellPlatformAdapter,
  UserEmulator
} from "../../typechain";
import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID, ZKEVM_NETWORK_ID} from "../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {TetuConverterApp} from "../baseUT/app/TetuConverterApp";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {AdaptersHelper} from "../baseUT/app/AdaptersHelper";
import {Misc} from "../../scripts/utils/Misc";
import {generateAssetPairs} from "../baseUT/utils/AssetPairUtils";
import {
  BorrowRepayCases, IBookkeeperStatusWithResults,
  IAssetsPairConfig, IBorrowRepaySingleActionParams,
} from "../baseUT/uses-cases/shared/BorrowRepayCases";
import {IPlatformUtilsProvider} from "../baseUT/types/IPlatformUtilsProvider";
import {BaseAddresses} from "../../scripts/addresses/BaseAddresses";
import {formatUnits, parseUnits} from "ethers/lib/utils";
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
import {NumberUtils} from "../baseUT/utils/NumberUtils";
import {Compound3Utils} from "../baseUT/protocols/compound3/Compound3Utils";
import {Compound3UtilsProvider} from "../baseUT/protocols/compound3/Compound3UtilsProvider";
import {BigNumber} from "ethers";
import {ZerovixUtilsProviderZkevm} from "../baseUT/protocols/zerovix/ZerovixUtilsProviderZkevm";
import {ZerovixUtilsZkevm} from "../baseUT/protocols/zerovix/ZerovixUtilsZkevm";
import {ZkevmAddresses} from "../../scripts/addresses/ZkevmAddresses";
import {ZerovixHelper} from "../../scripts/integration/zerovix/ZerovixHelper";
import {KeomUtilsPolygon} from "../baseUT/protocols/keom/KeomUtilsPolygon";
import {KeomUtilsProviderPolygon} from "../baseUT/protocols/keom/KeomUtilsProviderPolygon";
import {KeomSetupUtils} from "../baseUT/protocols/keom/KeomSetupUtils";
import {MaticCore} from "../baseUT/chains/polygon/maticCore";

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

  const PARAMS_WETH_USDC: IBorrowRepaySingleActionParams = {
    userBorrowAssetBalance: "10000",
    userCollateralAssetBalance: "10",
    collateralAmount: "1",
    collateralAmountSecond: "0.1",

    userBorrowAssetBalanceTinyAmount: "1",
    userCollateralAssetBalanceTinyAmount: "0.0015",
    collateralAmountTiny: "0.001",

    userBorrowAssetBalanceHugeAmount: "100000",
  }

  /** Allow to change the order of execution without modification of NETWORKS */
  const CHAINS_IN_ORDER_OF_EXECUTION = [ZKEVM_NETWORK_ID, BASE_NETWORK_ID, POLYGON_NETWORK_ID];

  const NETWORKS: IChainParams[] = [
    { // Polygon
      networkId: POLYGON_NETWORK_ID,
      platforms: [
        // { // Keom on Polygon
        //   async platformAdapterBuilder(signer0: SignerWithAddress, converterController0: string, borrowManagerAsGov0: BorrowManager): Promise<IPlatformAdapter> {
        //     const platformAdapter = await AdaptersHelper.createKeomPlatformAdapter(
        //       signer0,
        //       converterController0,
        //       MaticAddresses.KEOM_COMPTROLLER,
        //       (await AdaptersHelper.createKeomPoolAdapter(signer0)).address,
        //       KeomUtilsPolygon.getAllCTokens(),
        //     ) as KeomPlatformAdapter;
        //
        //     // register the platform adapter in TetuConverter app
        //     const pairs = generateAssetPairs(KeomUtilsPolygon.getAllAssets());
        //     await borrowManagerAsGov0.addAssetPairs(
        //       platformAdapter.address,
        //       pairs.map(x => x.smallerAddress),
        //       pairs.map(x => x.biggerAddress)
        //     );
        //
        //     // avoid error "Update time (heartbeat) exceeded"
        //     await KeomSetupUtils.disableHeartbeat(signer, MaticCore.getCoreKeom());
        //
        //     return platformAdapter;
        //   },
        //   platformUtilsProviderBuilder() {
        //     return new KeomUtilsProviderPolygon();
        //   },
        //   assetPairs: [
        //     {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.USDT, collateralAssetName: "USDC", borrowAssetName: "USDT", singleParams: PARAMS_SINGLE_STABLE,},
        //   ],
        // },
        { // Compound3 on Polygon
          async platformAdapterBuilder(signer0: SignerWithAddress, converterController0: string, borrowManagerAsGov0: BorrowManager): Promise<IPlatformAdapter> {
            const platformAdapter = await AdaptersHelper.createCompound3PlatformAdapter(
              signer0,
              converterController0,
              (await AdaptersHelper.createCompound3PoolAdapter(signer0)).address,
              [MaticAddresses.COMPOUND3_COMET_USDC],
              MaticAddresses.COMPOUND3_COMET_REWARDS
            ) as Compound3PlatformAdapter;

            // register the platform adapter in TetuConverter app
            const pairs = generateAssetPairs(Compound3Utils.getAllAssets());
            await borrowManagerAsGov0.addAssetPairs(
              platformAdapter.address,
              pairs.map(x => x.smallerAddress),
              pairs.map(x => x.biggerAddress)
            );

            return platformAdapter;
          },
          platformUtilsProviderBuilder() {
            return new Compound3UtilsProvider();
          },
          assetPairs: [
            {
              collateralAsset: MaticAddresses.WETH,
              borrowAsset: MaticAddresses.USDC,
              collateralAssetName: "WETH",
              borrowAssetName: "USDC",
              singleParams: PARAMS_WETH_USDC,
              skipCheckingNotZeroGains: true // probably gain is not zero, but it seems like we need to move a lot of blocks ahead to get not zero value
            },
          ],
        },

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
      ]
    },

    { // zkEVM chain
      networkId: ZKEVM_NETWORK_ID,
      platforms: [
        { // Zerovix on Zkevm chain
          platformUtilsProviderBuilder() {
            return new ZerovixUtilsProviderZkevm();
          },
          async platformAdapterBuilder(signer0: SignerWithAddress, converterController0: string, borrowManagerAsGov0: BorrowManager): Promise<IPlatformAdapter> {
            const platformAdapter = await AdaptersHelper.createZerovixPlatformAdapter(
              signer0,
              converterController0,
              (await ZerovixHelper.getComptroller(signer0, ZkevmAddresses.ZEROVIX_COMPTROLLER)).address,
              (await AdaptersHelper.createZerovixPoolAdapter(signer0)).address,
              ZerovixUtilsZkevm.getAllCTokens()
            );

            // register the platform adapter in TetuConverter app
            const pairs = generateAssetPairs(ZerovixUtilsZkevm.getAllAssets());
            await borrowManagerAsGov0.addAssetPairs(
              platformAdapter.address,
              pairs.map(x => x.smallerAddress),
              pairs.map(x => x.biggerAddress)
            );

            return platformAdapter;
          },
          assetPairs: [
            {collateralAsset: ZkevmAddresses.USDC, borrowAsset: ZkevmAddresses.USDT, collateralAssetName: "USDC", borrowAssetName: "USDT", singleParams: PARAMS_SINGLE_STABLE},
          ]
        },
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


  CHAINS_IN_ORDER_OF_EXECUTION.forEach(selectedChain => {
    const network = NETWORKS[NETWORKS.findIndex(x => x.networkId === selectedChain)];
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
                  let ret1: IBookkeeperStatusWithResults;
                  before(async function () {
                    snapshotLevel1 = await TimeUtils.snapshot();
                    ret1 = await makeBorrowTest();
                    // console.log("ret1", ret1);
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshotLevel1);
                  });

                  async function makeBorrowTest(): Promise<IBookkeeperStatusWithResults> {
                    return BorrowRepayCases.borrowRepayPairsSingleBlockBookkeeper(
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
                        let ret2: IBookkeeperStatusWithResults;
                        before(async function () {
                          snapshotLevel2 = await TimeUtils.snapshot();
                          ret2 = await BorrowRepayCases.borrowRepayPairsSingleBlockBookkeeper(
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
                    let ret2: IBookkeeperStatusWithResults;
                    before(async function () {
                      snasnapshotLevel2 = await TimeUtils.snapshot();
                      ret2 = await BorrowRepayCases.borrowRepayPairsSingleBlockBookkeeper(
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
                    let ret2: IBookkeeperStatusWithResults;
                    before(async function () {
                      snasnapshotLevel2 = await TimeUtils.snapshot();
                      ret2 = await makeSecondBorrowTest();
                    });
                    after(async function () {
                      await TimeUtils.rollback(snasnapshotLevel2);
                    });

                    async function makeSecondBorrowTest(): Promise<IBookkeeperStatusWithResults> {
                      return BorrowRepayCases.borrowRepayPairsSingleBlockBookkeeper(
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
                      expect(ret2.actions[1].suppliedAmount).approximately(ret2.actions[0].suppliedAmount + collateralSupplied, 1e-8);
                      expect(ret2.actions[1].borrowedAmount).eq(ret2.actions[0].borrowedAmount + borrowAmountReceived);
                    });
                    it("should not unregister the pool adapter for the user", async () => {
                      expect(ret1.poolAdaptersForUser.length).eq(1);
                    });
                  });
                  describe("repay to rebalance using collateral asset", () => {
                    let snasnapshotLevel2: string;
                    let ret2: IBookkeeperStatusWithResults;
                    before(async function () {
                      snasnapshotLevel2 = await TimeUtils.snapshot();
                      ret2 = await repayToRebalanceTest();
                    });
                    after(async function () {
                      await TimeUtils.rollback(snasnapshotLevel2);
                    });

                    async function repayToRebalanceTest(): Promise<IBookkeeperStatusWithResults> {
                      const collateralDecimals = await IERC20Metadata__factory.connect(assetPair.collateralAsset, signer).decimals();
                      return BorrowRepayCases.borrowRepayToRebalanceBookkeeper(
                        signer,
                        {
                          tetuConverter: ITetuConverter__factory.connect(await converterController.tetuConverter(), signer),
                          user: userEmulator,
                          borrowAsset: assetPair.borrowAsset,
                          collateralAsset: assetPair.collateralAsset,
                          receiver: RECEIVER,
                        },
                        {
                          isCollateral: true,
                          amount: NumberUtils.trimDecimals(
                            (ret1.results.status.collateralAmount / 2).toString(),
                            collateralDecimals
                          ),
                          userCollateralAssetBalance: NumberUtils.trimDecimals(
                            (ret1.results.status.collateralAmount / 2).toString(),
                            collateralDecimals
                          ),
                          targetHealthFactor: Math.round(Number(TARGET_HEALTH_FACTOR) * 2).toString(),
                        },
                        []
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
                      expect(ret2.actions[1].suppliedAmount).approximately(ret2.actions[0].suppliedAmount * 1.5, 1e-5);
                      expect(ret2.actions[1].borrowedAmount).eq(ret2.actions[0].borrowedAmount);
                    });
                    it("should not unregister the pool adapter for the user", async () => {
                      expect(ret1.poolAdaptersForUser.length).eq(1);
                    });
                  });
                  describe("repay to rebalance using borrow asset", function () {
                    let snapshotLevel2: string;
                    let ret2: IBookkeeperStatusWithResults;
                    before(async function () {
                      snapshotLevel2 = await TimeUtils.snapshot();
                      const amountIn = (NumberUtils.trimDecimals(
                        (ret1.results.status.amountToPay / 2).toString(),
                        await IERC20Metadata__factory.connect(assetPair.borrowAsset, signer).decimals()
                      )).toString();
                      ret2 = await BorrowRepayCases.borrowRepayToRebalanceBookkeeper(
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
                        {
                          isCollateral: false,
                          amount: amountIn,
                          userBorrowAssetBalance: amountIn,
                          targetHealthFactor: Math.round(Number(TARGET_HEALTH_FACTOR) * 2).toString(),
                        },
                        []
                      );
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
                      // console.log("ret2", ret2);
                      expect(ret2.actions[1].suppliedAmount).approximately(ret1.actions[0].suppliedAmount,1e-5);
                      expect(ret2.actions[1].borrowedAmount).approximately((ret2.actions[0].borrowedAmount) / 2,1e-4);
                    });
                    it("should not unregister the pool adapter for the user", async () => {
                      expect(ret1.poolAdaptersForUser.length).eq(1);
                    });
                  });
                  describe("checkpoint", () => {
                    let snasnapshotLevel2: string;
                    let checkpointResults: ICheckpointResults;
                    let previewResults: ICheckpointResults;
                    before(async function () {
                      snasnapshotLevel2 = await TimeUtils.snapshot();

                      // let's give some time to increment debts and gains
                      await TimeUtils.advanceNBlocks(5000);

                      checkpointResults = await bookkeeper.connect(
                        await Misc.impersonate(userEmulator.address)
                      ).callStatic.checkpoint([assetPair.collateralAsset, assetPair.borrowAsset]);
                      previewResults = await bookkeeper.previewCheckpoint(userEmulator.address, [assetPair.collateralAsset, assetPair.borrowAsset]);
                    });
                    after(async function () {
                      await TimeUtils.rollback(snasnapshotLevel2);
                    });

                    interface ICheckpointResults {
                      deltaGains: BigNumber[];
                      deltaLosses: BigNumber[];
                    }

                    it("should return arrays with length = 2", async () => {
                      expect(checkpointResults.deltaGains.length).eq(2);
                      expect(checkpointResults.deltaLosses.length).eq(2);
                    });
                    it("should return actual values same to preview values", async () => {
                      expect(
                        checkpointResults.deltaLosses[0].add(checkpointResults.deltaLosses[1])
                      ).eq(
                        previewResults.deltaLosses[0].add(previewResults.deltaLosses[1])
                      );

                      expect(
                        checkpointResults.deltaGains[0].add(checkpointResults.deltaGains[1])
                      ).eq(
                        previewResults.deltaGains[0].add(previewResults.deltaGains[1])
                      );
                    });
                  });
                  describe("startPeriod", function () {
                    let snasnapshotLevel2: string;
                    let ret2: IResults;

                    interface IPeriodResults {
                      gains: number;
                      losses: number;
                    }
                    interface IResults {
                      startPeriod: IPeriodResults;
                      preview: IPeriodResults;
                      periodLength: number;
                      periodAt: number;
                    }

                    before(async function () {
                      snasnapshotLevel2 = await TimeUtils.snapshot();

                      // let's give some time to increment debts and gains
                      await TimeUtils.advanceNBlocks(5000);

                      const underlying = IERC20Metadata__factory.connect(assetPair.collateralAsset, signer);

                      await BorrowRepayCases.borrowRepayPairsSingleBlockBookkeeper(
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

                      const user = await Misc.impersonate(userEmulator.address);

                      const preview = await bookkeeper.previewPeriod(underlying.address, user.address);
                      const ret = await bookkeeper.connect(user).callStatic.startPeriod(underlying.address);
                      await bookkeeper.connect(user).startPeriod(underlying.address);

                      const borrowManager = BorrowManager__factory.connect(await converterController.borrowManager(), signer);
                      const poolAdapter = IPoolAdapter__factory.connect(await borrowManager.listPoolAdapters(0), signer);

                      ret2 = {
                        startPeriod: {
                          gains: +formatUnits(ret.gains, await underlying.decimals()),
                          losses: +formatUnits(ret.losses, await underlying.decimals()),
                        },
                        preview: {
                          gains: +formatUnits(preview.gains, await underlying.decimals()),
                          losses: +formatUnits(preview.losses, await underlying.decimals()),
                        },
                        periodLength: (await bookkeeper.periodsLength(poolAdapter.address)).toNumber(),
                        periodAt: (await bookkeeper.periodsAt(poolAdapter.address, 0)).toNumber()
                      }
                    });
                    after(async function () {
                      await TimeUtils.rollback(snasnapshotLevel2);
                    });

                    it("should return not zero losses", async () => {
                      expect(ret2.startPeriod.losses).gt(0);
                      if (!assetPair.skipCheckingNotZeroGains) {
                        expect(ret2.startPeriod.gains).gt(0);
                      }
                    });
                    it("should return gains and losses equal to preview values", async () => {
                      expect(ret2.startPeriod.losses).eq(ret2.preview.losses);
                      expect(ret2.startPeriod.gains).eq(ret2.preview.gains);
                    });
                    it("should assign expected values to period array", async () => {
                      expect(ret2.periodLength).eq(1);
                      expect(ret2.periodAt).eq(2); // there are two actions: borrow and repay
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