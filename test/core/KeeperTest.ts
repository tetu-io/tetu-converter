import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {
  Controller,
  DebtMonitorCheckHealthMock,
  Keeper, Keeper__factory,
  KeeperCallbackMock,
  KeeperCaller,
  KeeperMock
} from "../../typechain";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {Misc} from "../../scripts/utils/Misc";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";

describe("KeeperTest", () => {
//region Constants
  const NOT_CALLED_0 = 0;
  const SUCCESS_1 = 1;
  const FAILED_2 = 2;
//endregion Constants

//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user1 = signers[2];
    user2 = signers[3];
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
    signer: SignerWithAddress
  ) : Promise<ISetupMockedAppResults> {
    const controller = await CoreContractsHelper.createController(signer);
    const debtMonitorMock = await MocksHelper.createDebtMonitorCheckHealthMock(signer);
    const tetuConverterMock = await MocksHelper.createKeeperCallbackMock(signer);
    const keeperCaller = await MocksHelper.createKeeperCaller(signer);
    const keeper = await CoreContractsHelper.createKeeper(signer, controller, keeperCaller.address);
    await keeperCaller.setupKeeper(keeper.address, keeper.address);

    await controller.setDebtMonitor(debtMonitorMock.address);
    await controller.setTetuConverter(tetuConverterMock.address);
    await controller.setKeeper(keeper.address);

    return {
      controller,
      keeper,
      tetuConverterMock,
      debtMonitorMock,
      keeperCaller,
    }
  }

  async function setupKeeperMock(
    signer: SignerWithAddress,
    app: ISetupMockedAppResults
  ) : Promise<KeeperMock> {
    const keeperMock = await MocksHelper.createKeeperMock(signer);
    await app.controller.setKeeper(keeperMock.address);
    return keeperMock;
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

            const app = await setupMockedApp(deployer);
            // setup app: checker should call keeperMock.fixHealth
            const keeperExecutorMock = await setupKeeperMock(deployer, app);
            await keeperExecutorMock.setNextIndexToCheck0(nextIndexToCheck);
            await app.controller.setKeeper(keeperExecutorMock.address);
            await app.keeperCaller.setupKeeper(app.keeper.address, keeperExecutorMock.address);

            // all pool adapters are healthy
            await app.debtMonitorMock.setReturnValues(
              startIndexToCheck,
              [],
              []
              , []
            );

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

            const app = await setupMockedApp(deployer);

            // setup app: checker should call keeperMock.fixHealth
            const keeperExecutorMock = await setupKeeperMock(deployer, app);
            await keeperExecutorMock.setNextIndexToCheck0(nextIndexToCheck);
            await app.controller.setKeeper(keeperExecutorMock.address);
            await app.keeperCaller.setupKeeper(app.keeper.address, keeperExecutorMock.address);

            // all pool adapters are healthy
            await app.debtMonitorMock.setReturnValues(
              startIndexToCheck,
              [],
              []
              , []
            );

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

          const app = await setupMockedApp(deployer);

          // setup app: checker should call keeperMock.fixHealth
          const keeperExecutorMock = await setupKeeperMock(deployer, app);
          await keeperExecutorMock.setNextIndexToCheck0(nextIndexToCheck);
          await app.controller.setKeeper(keeperExecutorMock.address);
          await app.keeperCaller.setupKeeper(app.keeper.address, keeperExecutorMock.address);

          // all pool adapters are healthy
          await app.debtMonitorMock.setReturnValues(
            startIndexToCheck,
            [unhealthyPoolAdapter],
            [1]
            , [2]
          );

          await app.keeperCaller.callChecker();

          // check if fixHealth was called
          const r = await keeperExecutorMock.lastFixHealthParams();
          expect(r.countCalls).eq(1);
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
            await app.debtMonitorMock.setReturnValues(
              newNextIndexToCheck,
              [],
              []
              , []
            );

            const before = (await app.keeper.nextIndexToCheck0()).toNumber();
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
    });
    describe("Bad paths", () => {
      describe("Called by not Gelato", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
      describe("Wrong lengths", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("Initialization", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        const controller = await CoreContractsHelper.createController(deployer);
        const keeperCaller = await MocksHelper.createKeeperCaller(deployer);
        const keeper = await CoreContractsHelper.createKeeper(deployer, controller, keeperCaller.address);

        const ret = await keeper.controller();
        expect(ret).eq(controller.address);
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
              keeperCaller.address
            )
          ).revertedWith("TC-1"); // ZERO_ADDRESS
        });
      });
    });
  });

  describe("setController", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        const controller = await CoreContractsHelper.createController(deployer);
        const keeperCaller = await MocksHelper.createKeeperCaller(deployer);
        const keeper = await CoreContractsHelper.createKeeper(deployer, controller, keeperCaller.address);

        const before = await keeper.controller();
        const controller2 = await CoreContractsHelper.createController(deployer);
        await keeper.setController(controller2.address);
        const after = await keeper.controller();

        const ret = [before, after].join();
        const expected = [controller.address, controller2.address].join();
        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      describe("Zero address", () => {
        it("should revert", async () => {
          const controller = await CoreContractsHelper.createController(deployer);
          const keeperCaller = await MocksHelper.createKeeperCaller(deployer);
          const keeper = await CoreContractsHelper.createKeeper(deployer, controller, keeperCaller.address);

          await expect(keeper.setController(Misc.ZERO_ADDRESS)).revertedWith("TC-1"); // ZERO_ADDRESS
        });
      });
      describe("Not governance", () => {
        it("should revert", async () => {
          const controller = await CoreContractsHelper.createController(deployer);
          const keeperCaller = await MocksHelper.createKeeperCaller(deployer);
          const keeper = await CoreContractsHelper.createKeeper(deployer, controller, keeperCaller.address);
          const controller2 = await CoreContractsHelper.createController(deployer);

          const keeperNotGov = Keeper__factory.connect(
            keeper.address,
            await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
          );

          await expect(keeperNotGov.setController(controller2.address)).revertedWith("TC-9"); // GOVERNANCE_ONLY
        });
      });
    });
  });
//endregion Unit tests
});