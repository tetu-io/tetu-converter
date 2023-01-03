import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {
  Controller,
  DebtMonitorCheckHealthMock, DebtMonitorCheckHealthMock__factory,
  Keeper, Keeper__factory,
  KeeperCallbackMock, KeeperCallbackMock__factory,
  KeeperCaller, KeeperMock__factory
} from "../../typechain";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {Misc} from "../../scripts/utils/Misc";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {expect} from "chai";

describe("KeeperTest", () => {
//region Constants
  const FAILED_2 = 2;
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
  interface ISetupMockedAppResults {
    controller: Controller;
    keeper: Keeper;
    tetuConverterMock: KeeperCallbackMock;
    debtMonitorMock: DebtMonitorCheckHealthMock;
    keeperCaller: KeeperCaller;
  }

  async function setupMockedApp(
    signer: SignerWithAddress,
    wrapKeeper: boolean = false,
    blocksPerDayAutoUpdatePeriodSecs?: number
  ) : Promise<ISetupMockedAppResults> {
    const keeperCaller = await MocksHelper.createKeeperCaller(signer);
    const controller: Controller = await TetuConverterApp.createController(
      signer,
      {
        borrowManagerFabric: async c => (await CoreContractsHelper.createBorrowManager(signer, c.address)).address,
        tetuConverterFabric: async () => (await MocksHelper.createKeeperCallbackMock(signer)).address,
        debtMonitorFabric: async () => (await MocksHelper.createDebtMonitorCheckHealthMock(signer)).address,
        keeperFabric: wrapKeeper
          ? (async c => {
            const realKeeper = await CoreContractsHelper.createKeeper(signer,
              c.address,
              keeperCaller.address,
              blocksPerDayAutoUpdatePeriodSecs
            );
            return (await MocksHelper.createKeeperMock(deployer, realKeeper.address)).address;
          })
          : (async c => (await CoreContractsHelper.createKeeper(signer,
            c.address,
            keeperCaller.address,
            blocksPerDayAutoUpdatePeriodSecs
          )).address),
        swapManagerFabric: async () => ethers.Wallet.createRandom().address,
        tetuLiquidatorAddress: ethers.Wallet.createRandom().address,
        blocksPerDayAutoUpdatePeriodSecs
      }
    );

    const keeper = Keeper__factory.connect(await controller.keeper(), controller.signer);

    return {
      controller,
      keeper,
      tetuConverterMock: KeeperCallbackMock__factory.connect(await controller.tetuConverter(), controller.signer),
      debtMonitorMock: DebtMonitorCheckHealthMock__factory.connect(await controller.debtMonitor(), controller.signer),
      keeperCaller
    }
  }
//endregion Initialization

//region Unit tests
  describe("checker", () => {
    describe("Good paths", () => {
      describe("All positions are healthy", () => {
        describe("nextIndexToCheck0 is not changed", () => {
          it("should not call fixHealth", async () => {
            const startIndexToCheck = 0;
            const nextIndexToCheck = 0;

            const app = await setupMockedApp(deployer, true);
            const keeperExecutorMock = KeeperMock__factory.connect(app.keeper.address, deployer);
            // setup app: checker should call keeperMock.fixHealth
            await keeperExecutorMock.setNextIndexToCheck0(nextIndexToCheck);
            await app.keeperCaller.setupKeeper(app.keeper.address, keeperExecutorMock.address);

            // all pool adapters are healthy
            await app.debtMonitorMock.setReturnValues(startIndexToCheck, [], [], []);

            await app.keeperCaller.callChecker();

            // check if fixHealth was called
            const r = await keeperExecutorMock.lastFixHealthParams();
            expect(r.countCalls).eq(0);
          });
        });
        describe("nextIndexToCheck0 is changed", () => {
          it("should call fixHealth", async () => {
            const startIndexToCheck = 0;
            const nextIndexToCheck = 100; // != 0

            const app = await setupMockedApp(deployer, true);
            const keeperExecutorMock = KeeperMock__factory.connect(app.keeper.address, deployer);
            // setup app: checker should call keeperMock.fixHealth
            await keeperExecutorMock.setNextIndexToCheck0(nextIndexToCheck);
            await app.keeperCaller.setupKeeper(app.keeper.address, keeperExecutorMock.address);

            // all pool adapters are healthy
            await app.debtMonitorMock.setReturnValues(startIndexToCheck, [], [], []);

            await app.keeperCaller.callChecker();

            // check if fixHealth was called
            const r = await keeperExecutorMock.lastFixHealthParams();
            expect(r.countCalls).eq(1);
          });
        });
      });
      describe("There is unhealthy position", () => {
        it("should call fixHealth", async () => {
          const startIndexToCheck = 0;
          const nextIndexToCheck = 0;
          const unhealthyPoolAdapter = ethers.Wallet.createRandom().address;

          const app = await setupMockedApp(deployer, true);
          const keeperExecutorMock = KeeperMock__factory.connect(app.keeper.address, deployer);
          // setup app: checker should call keeperMock.fixHealth
          await keeperExecutorMock.setNextIndexToCheck0(nextIndexToCheck);
          await app.keeperCaller.setupKeeper(app.keeper.address, keeperExecutorMock.address);

          // all pool adapters are healthy
          await app.debtMonitorMock.setReturnValues(startIndexToCheck, [unhealthyPoolAdapter], [1], [2]);

          await app.keeperCaller.callChecker();

          // check if fixHealth was called
          const r = await keeperExecutorMock.lastFixHealthParams();
          expect(r.countCalls).eq(1);
        });
      });
      describe("Auto-update is not required", () => {
        it("should not call fixHealth", async () => {
          const startIndexToCheck = 0;
          const nextIndexToCheck = 0;

          const app = await setupMockedApp(deployer,
            true,
            2*7*24*60*60 // two weeks
          );
          // let's enable auto-update of blocksPerDay value
          await app.controller.setBlocksPerDay(1000, true);

          const keeperExecutorMock = KeeperMock__factory.connect(app.keeper.address, deployer);
          // setup app: checker should call keeperMock.fixHealth
          await keeperExecutorMock.setNextIndexToCheck0(nextIndexToCheck);
          await app.keeperCaller.setupKeeper(app.keeper.address, keeperExecutorMock.address);

          // all pool adapters are healthy and two weeks obviously were not passed
          await app.debtMonitorMock.setReturnValues(startIndexToCheck, [], [], []);

          await app.keeperCaller.callChecker();

          // check if fixHealth was called
          const r = await keeperExecutorMock.lastFixHealthParams();
          expect(r.countCalls).eq(0);
        });
        it("should call fixHealth", async () => {
          const startIndexToCheck = 0;
          const nextIndexToCheck = 0;

          const app = await setupMockedApp(deployer,
            true,
            1 // (!) auto update should be made each 1 second
          );

          // let's enable auto-update of blocksPerDay value
          await app.controller.setBlocksPerDay(1000, true);

          const keeperExecutorMock = KeeperMock__factory.connect(app.keeper.address, deployer);
          // setup app: checker should call keeperMock.fixHealth
          await keeperExecutorMock.setNextIndexToCheck0(nextIndexToCheck);
          await app.keeperCaller.setupKeeper(app.keeper.address, keeperExecutorMock.address);

          // all pool adapters are healthy and two weeks obviously were not passed
          await app.debtMonitorMock.setReturnValues(startIndexToCheck, [], [], []);

          // we assume here, that 100 blocks > 1 second
          // so, after the advancing it will be a time to make auto-update
          await TimeUtils.advanceNBlocks(100);

          await app.keeperCaller.callChecker();

          // check if fixHealth was called
          const r = await keeperExecutorMock.lastFixHealthParams();
          expect(r.countCalls).eq(1); // it's called to make auto-update
        });
      });
    });
  });

  describe("fixHealth", () => {
    describe("Good paths", () => {
      describe("All positions are healthy", () => {
        describe("nextIndexToCheck0 is changed", () => {
          it("should update nextIndexToCheck0 inside keeper", async () => {
            const newNextIndexToCheck = 10;

            const app = await setupMockedApp(deployer);

            // all pool adapters are healthy
            await app.debtMonitorMock.setReturnValues(newNextIndexToCheck, [], [], []);

            const before = (await app.keeper.nextIndexToCheck0()).toNumber();
            await app.keeperCaller.setupKeeper(app.keeper.address, app.keeper.address);
            await app.keeperCaller.callChecker();
            const after = (await app.keeper.nextIndexToCheck0()).toNumber();

            const ret = [before, after].join();
            const expected = [0, newNextIndexToCheck].join();

            expect(ret).eq(expected);
          });
        });
      });
      describe("There is single unhealthy position", () => {
        it("should call requireRepay for the unhealthy position with expected params", async () => {
          const unhealthyPoolAdapter = ethers.Wallet.createRandom().address;
          const borrowAssetAmountToRepay = 1;
          const collateralAssetAmountToRepay = 2;
          const newNextIndexToCheck = 7;

          const app = await setupMockedApp(deployer);

          // all pool adapters are healthy
          await app.debtMonitorMock.setReturnValues(
            newNextIndexToCheck,
            [unhealthyPoolAdapter],
            [borrowAssetAmountToRepay]
            , [collateralAssetAmountToRepay]
          );

          await app.keeperCaller.setupKeeper(app.keeper.address, app.keeper.address);
          await app.keeperCaller.callChecker();

          const r = await app.tetuConverterMock.requireRepayCalls(unhealthyPoolAdapter);

          const ret = [
            (await app.keeper.nextIndexToCheck0()).toNumber(),
            r.countCalls.toNumber(),
            r.requiredAmountBorrowAsset.toNumber(),
            r.requiredAmountCollateralAsset.toNumber(),
            r.lendingPoolAdapter
          ].join();
          const expected = [
            newNextIndexToCheck,
            1,
            borrowAssetAmountToRepay,
            collateralAssetAmountToRepay,
            unhealthyPoolAdapter
          ].join();

          expect(ret).eq(expected);
        });
      });

      describe("There are two unhealthy positions", () => {
        describe("Return two positions at once", () => {
          it("should call requireRepay for the unhealthy position with expected params", async () => {
            const unhealthyPoolAdapter1 = ethers.Wallet.createRandom().address;
            const unhealthyPoolAdapter2 = ethers.Wallet.createRandom().address;
            const borrowAssetAmountToRepay1 = 1;
            const collateralAssetAmountToRepay1 = 2;
            const borrowAssetAmountToRepay2 = 3;
            const collateralAssetAmountToRepay2 = 4;
            const newNextIndexToCheck = 7;

            const app = await setupMockedApp(deployer);

            // all pool adapters are healthy
            await app.debtMonitorMock.setReturnValues(
              newNextIndexToCheck,
              [unhealthyPoolAdapter1, unhealthyPoolAdapter2],
              [borrowAssetAmountToRepay1, borrowAssetAmountToRepay2],
              [collateralAssetAmountToRepay1, collateralAssetAmountToRepay2]
            );

            await app.keeperCaller.setupKeeper(app.keeper.address, app.keeper.address);
            await app.keeperCaller.callChecker();

            const r1 = await app.tetuConverterMock.requireRepayCalls(unhealthyPoolAdapter1);
            const r2 = await app.tetuConverterMock.requireRepayCalls(unhealthyPoolAdapter2);

            const ret = [
              (await app.keeper.nextIndexToCheck0()).toNumber(),

              r1.countCalls.toNumber(),
              r1.requiredAmountBorrowAsset.toNumber(),
              r1.requiredAmountCollateralAsset.toNumber(),
              r1.lendingPoolAdapter,

              r2.countCalls.toNumber(),
              r2.requiredAmountBorrowAsset.toNumber(),
              r2.requiredAmountCollateralAsset.toNumber(),
              r2.lendingPoolAdapter,
            ].join();
            const expected = [
              newNextIndexToCheck,

              1,
              borrowAssetAmountToRepay1,
              collateralAssetAmountToRepay1,
              unhealthyPoolAdapter1,

              1,
              borrowAssetAmountToRepay2,
              collateralAssetAmountToRepay2,
              unhealthyPoolAdapter2
            ].join();

            expect(ret).eq(expected);
          });
        });
      });

      /**
       * There are two pages.
       * First page has maxCountToCheck healthy adapters.
       * There is unhealthy adapter on seconds page.
       * After first call of callChecker, keeper.nextIndexToCheck0 = maxCountToCheck
       * After second call of callChecker, keeper.nextIndexToCheck0 = unhealthyPoolAdapterIndex + 1
       */
      describe("Check pagination", () => {
        it("should pass expected nextIndexToCheck0 values", async () => {
          const unhealthyPoolAdapter = ethers.Wallet.createRandom().address;
          const borrowAssetAmountToRepay = 1;
          const collateralAssetAmountToRepay = 2;

          const app = await setupMockedApp(deployer);
          const maxCountToCheck = (await app.keeper.maxCountToCheck()).toNumber();
          const maxCountToReturn = (await app.keeper.maxCountToReturn()).toNumber();

          // assume, that the whole list of positions is greater than maxCountToCheck
          // than first call of checkHealth will return nextIndexToCheck0 = maxCountToCheck
          await app.debtMonitorMock.setReturnValues(
            maxCountToCheck,
            [],
            []
            , []
          );

          await app.keeperCaller.setupKeeper(app.keeper.address, app.keeper.address);
          await app.keeperCaller.callChecker();
          const nextIndexToCheck0AfterFirstCall = (await app.keeper.nextIndexToCheck0()).toNumber();

          // assume, that one of pool adapters on the second page is unhealthy
          const unhealthyPoolAdapterIndex = maxCountToCheck + 5;
          await app.debtMonitorMock.setReturnValues(
            unhealthyPoolAdapterIndex + 1,
            [unhealthyPoolAdapter],
            [borrowAssetAmountToRepay]
            , [collateralAssetAmountToRepay]
          );
          await app.debtMonitorMock.setExpectedInputParams(
            maxCountToCheck, // second pages is started from maxCountToCheck's position
            maxCountToCheck,
            maxCountToReturn
          );

          await app.keeperCaller.callChecker();
          const r = await app.tetuConverterMock.requireRepayCalls(unhealthyPoolAdapter);

          const ret = [
            nextIndexToCheck0AfterFirstCall,
            (await app.keeper.nextIndexToCheck0()).toNumber(),
            r.countCalls.toNumber(),
            r.requiredAmountBorrowAsset.toNumber(),
            r.requiredAmountCollateralAsset.toNumber(),
            r.lendingPoolAdapter
          ].join();
          const expected = [
            maxCountToCheck,
            unhealthyPoolAdapterIndex + 1,
            1,
            borrowAssetAmountToRepay,
            collateralAssetAmountToRepay,
            unhealthyPoolAdapter
          ].join();

          expect(ret).eq(expected);
        });
      });

      describe("Check auto-update of blocksPerDay value is called", () => {
        it("should return expected values", async () => {
          const newNextIndexToCheck = 10;

          const app = await setupMockedApp(deployer, false
            , 1 // (!) auto-update of blocksPerDay should be called each 1 second
          );

          // enable auto-update of blocksPerDay
          const initialBLocksPerDaysValue = 99999999;
          await app.controller.setBlocksPerDay(initialBLocksPerDaysValue, true);

          // all pool adapters are healthy
          await app.debtMonitorMock.setReturnValues(newNextIndexToCheck, [], [], []);

          const before = (await app.controller.blocksPerDay()).toNumber();
          await app.keeperCaller.setupKeeper(app.keeper.address, app.keeper.address);

          await TimeUtils.advanceNBlocks(100); // we assume here, that 100 blocks > 1 second

          await app.keeperCaller.callChecker();
          const after = (await app.controller.blocksPerDay()).toNumber();

          const ret = [before === initialBLocksPerDaysValue, before === after].join();
          const expected = [true, false].join();

          expect(ret).eq(expected);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Called by not Gelato", () => {
        it("should revert", async () => {
          const app = await setupMockedApp(deployer);

          await expect(
            app.keeper.fixHealth(0, [], [], [])
          ).revertedWith("OpsReady: onlyOps");
        });
      });
      describe("Wrong lengths", () => {
        it("should revert", async () => {
          const newNextIndexToCheck = 10;

          const app = await setupMockedApp(deployer);

          // all pool adapters are healthy
          await app.debtMonitorMock.setReturnValues(
            newNextIndexToCheck,
            [],
            [1] // (!)
            , [2, 3] // (!)
          );

          await app.keeperCaller.setupKeeper(app.keeper.address, app.keeper.address);
          await app.keeperCaller.callChecker();
          const ret = await app.keeperCaller.lastCallResults();
          expect(ret).eq(FAILED_2);  // WRONG_LENGTHS
        });
      });
    });
  });

  describe("Initialization", () => {
    describe("Good paths", () => {
      it("should create keeper successfully", async () => {
        const controller = await TetuConverterApp.createController(deployer);
        const keeper = Keeper__factory.connect(await controller.keeper(), controller.signer);

        const ret = await keeper.controller();
        expect(ret).eq(controller.address);
      });
      describe("Check blocksPerDayAutoUpdatePeriod value", () => {
        it("should set zero period (auto-update checking is disabled)", async () => {
          const controller = await TetuConverterApp.createController(
            deployer, {
              blocksPerDayAutoUpdatePeriodSecs: 0 // auto-update checking is disabled
            }
          );
          const keeper = Keeper__factory.connect(await controller.keeper(), controller.signer);

          const ret = await keeper.blocksPerDayAutoUpdatePeriodSecs();
          expect(ret).eq(0);
        });
        it("should set not zero period (auto-update checking is disabled)", async () => {
          const controller = await TetuConverterApp.createController(
            deployer, {
              blocksPerDayAutoUpdatePeriodSecs: 7 * 24 * 60 * 60 // 1 week
            }
          );
          const keeper = Keeper__factory.connect(await controller.keeper(), controller.signer);

          const ret = await keeper.blocksPerDayAutoUpdatePeriodSecs();
          expect(ret).eq(7 * 24 * 60 * 60);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Zero address", () => {
        it("should revert", async () => {
          const keeperCaller = await MocksHelper.createKeeperCaller(deployer);
          await expect(
            DeployUtils.deployContract(
              deployer,
              "Keeper",
              Misc.ZERO_ADDRESS, // (!)
              keeperCaller.address,
              2 * 24 * 60 * 60 // 2 weeks
            )
          ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
        });
      });
    });
  });

  describe("events", () => {
    it("should emit expected events", async () => {
      const startIndexToCheck = 7;
      const unhealthyPoolAdapter1 = ethers.Wallet.createRandom().address;
      const unhealthyPoolAdapter2 = ethers.Wallet.createRandom().address;

      const app = await setupMockedApp(deployer, false);
      await app.keeperCaller.setupKeeper(app.keeper.address, app.keeper.address);

      // all pool adapters are healthy
      await app.debtMonitorMock.setReturnValues(
        startIndexToCheck,
        [unhealthyPoolAdapter1, unhealthyPoolAdapter2],
        [1, 14],
        [2, 39]
      );

      await expect(
        app.keeperCaller.callChecker()
      ).to.emit(app.keeper, "OnFixHealth").withArgs(
        startIndexToCheck,
        [unhealthyPoolAdapter1, unhealthyPoolAdapter2],
        [1, 14],
        [2, 39]
      );
    });
  });
//endregion Unit tests
});