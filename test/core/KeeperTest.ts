import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {
  Controller,
  DebtMonitorCheckHealthMock,
  Keeper,
  KeeperCallbackMock,
  KeeperCaller,
  KeeperMock
} from "../../typechain";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";

describe("KeeperTest", () => {

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
    await keeperCaller.setupKeeper(keeper.address);

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
            const nextIndexToCheck = 0;

            const app = await setupMockedApp(deployer);
            const keeperExecutorMock = await setupKeeperMock(deployer, app);
            await keeperExecutorMock.setNextIndexToCheck0(nextIndexToCheck);

            // all pool adapters are healthy
            await app.debtMonitorMock.setReturnValues(
              nextIndexToCheck,
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
        describe("Current nextIndexToCheck0 is less than the position index", () => {
          it("should call requireRepay for the unhealthy position with expected params", async () => {
            expect.fail("TODO");
          });
          it("should set nextIndexToCheck0 = position + 1", async () => {
            expect.fail("TODO");
          });
        });
        describe("Current nextIndexToCheck0 is equal to the position index", () => {
          it("should call requireRepay for the unhealthy position with expected params", async () => {
            expect.fail("TODO");
          });
          it("should set nextIndexToCheck0 = position + 1", async () => {
            expect.fail("TODO");
          });
        });
        describe("Current nextIndexToCheck0 is greater than the position index", () => {
          it("should not call fixHealth", async () => {
            expect.fail("TODO");
          });
          it("should set nextIndexToCheck0 to 0", async () => {
            expect.fail("TODO");
          });
        });
      });

      describe("There are two unhealthy positions", () => {
        it("should call requireRepay for the unhealthy position with expected params", async () => {
          expect.fail("TODO");
        });
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("fixHealth", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        expect.fail("TODO");
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
//endregion Unit tests
});