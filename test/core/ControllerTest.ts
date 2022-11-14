import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {Controller, Controller__factory} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {controlGasLimitsEx, getGasUsed} from "../../scripts/utils/hardhatUtils";
import {
  GAS_LIMIT_CONTROLLER_INITIALIZE,
  GAS_LIMIT_CONTROLLER_SET_XXX
} from "../baseUT/GasLimit";
import {Misc} from "../../scripts/utils/Misc";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {COUNT_BLOCKS_PER_DAY} from "../baseUT/utils/aprUtils";
import {randomInt} from "crypto";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";

describe("Controller", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;
  let user5: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user1 = signers[2];
    user2 = signers[3];
    user3 = signers[4];
    user4 = signers[5];
    user5 = signers[6];
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

//region Utils
  interface IControllerMembers {
    governance: string;
    tetuConverter: string;
    borrowManager: string;
    debtMonitor: string;

    keeper: string;
    tetuLiquidator: string;
    swapManager: string;

    minHealthFactor2: number;
    targetHealthFactor2: number;
    maxHealthFactor2: number;

    blocksPerDay: BigNumber;
  }

  function getMembersArray(a: IControllerMembers): string[] {
    return [
      a.governance,

      a.tetuConverter,
      a.borrowManager,
      a.debtMonitor,

      a.keeper,
      a.tetuLiquidator,
      a.swapManager,

      a.minHealthFactor2.toString(),
      a.targetHealthFactor2.toString(),
      a.maxHealthFactor2.toString(),

      a.blocksPerDay.toString()
    ];
  }

  async function getValuesArray(controller: Controller) : Promise<string[]> {
    return [
      await controller.governance(),

      await controller.tetuConverter(),
      await controller.borrowManager(),
      await controller.debtMonitor(),

      await controller.keeper(),
      await controller.tetuLiquidator(),
      await controller.swapManager(),

      (await controller.minHealthFactor2()).toString(),
      (await controller.targetHealthFactor2()).toString(),
      (await controller.maxHealthFactor2()).toString(),

      (await controller.blocksPerDay()).toString(),
    ];
  }

  async function createTestController(
    a: IControllerMembers,
  ) : Promise<{controller: Controller, gasUsed: BigNumber}> {
    const controller = await CoreContractsHelper.deployController(deployer);

    const gasUsed = await getGasUsed(
      controller.initialize(
        a.governance,
        a.blocksPerDay,
        a.minHealthFactor2,
        a.targetHealthFactor2,
        a.maxHealthFactor2,
        a.tetuConverter,
        a.borrowManager,
        a.debtMonitor,
        a.keeper,
        a.tetuLiquidator,
        a.swapManager,
      )
    );

    return {controller, gasUsed};
  }

  function getRandomMembersValues() : IControllerMembers {
    return {
      governance: ethers.Wallet.createRandom().address,

      tetuConverter: ethers.Wallet.createRandom().address,
      borrowManager: ethers.Wallet.createRandom().address,
      debtMonitor: ethers.Wallet.createRandom().address,

      keeper: ethers.Wallet.createRandom().address,
      tetuLiquidator: ethers.Wallet.createRandom().address,
      swapManager: ethers.Wallet.createRandom().address,

      minHealthFactor2: 120 + randomInt(10),
      targetHealthFactor2: 220 + randomInt(10),
      maxHealthFactor2: 920 + randomInt(10),

      blocksPerDay: BigNumber.from(1000 + randomInt(1000))
    }
  }

  async function prepareTestController() : Promise<Controller> {
    const a = getRandomMembersValues();
    const {controller} = await createTestController(a);
    return controller;
  }
//endregion Utils

//region Unit tests
  describe ("initialize", () => {
    describe ("Good paths", () => {
      it("should initialize values correctly", async () => {
        const a = getRandomMembersValues();

        const {controller, gasUsed} = await createTestController(a);

        const ret = (await getValuesArray(controller)).join();
        const expected = getMembersArray(a).join();

        expect(ret).to.be.equal(expected);
        controlGasLimitsEx(gasUsed, GAS_LIMIT_CONTROLLER_INITIALIZE, (u, t) => {
            expect(u).to.be.below(t);
          }
        );
      });
    });

    describe ("Bad paths", () => {
      it("zero governance should revert", async () => {
        const a = getRandomMembersValues();
        a.governance = Misc.ZERO_ADDRESS;
        await expect(
          createTestController(a)
        ).revertedWith("TC-1");
      });
      it("Min health factor is too small - should revert", async () => {
        const a = getRandomMembersValues();
        a.minHealthFactor2 = 99; // (!)

        await expect(
          createTestController(a)
        ).revertedWith("TC-3: wrong health factor");
      });
      it("Min health factor is not less then target health factor - should revert", async () => {
        const a = getRandomMembersValues();
        a.targetHealthFactor2 = a.minHealthFactor2; // (!)

        await expect(
          createTestController(a)
        ).revertedWith("TC-38: wrong health factor config");
      });
      it("Target health factor is not less then max health factor - should revert", async () => {
        const a = getRandomMembersValues();
        a.maxHealthFactor2 = a.targetHealthFactor2; // (!)

        await expect(
          createTestController(a)
        ).revertedWith("TC-38: wrong health factor config");
      });
      it("should revert if Blocks per day = 0", async () => {
        const a = getRandomMembersValues();
        a.blocksPerDay = BigNumber.from(0); // (!)

        await expect(
          createTestController(a)
        ).revertedWith("TC-29");
      });
    });
  });

  describe ("set governance", () => {
    describe ("Good paths", () => {
      it("should initialize addresses correctly", async () => {
        expect.fail("TODO");
      });
    });

    describe ("Bad paths", () => {
      describe ("Zero address", () => {
        it("should revert", async () => {
            //  await expect(
            //   setAddresses(controllerAsGov, updatedAddresses)
            // ).revertedWith("TC-1");
          expect.fail("TODO");
        });
      });
      describe ("Not governance", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe ("setBlocksPerDay", () => {
    describe ("Good paths", () => {
      it("should set expected value", async () => {
        const a = getRandomMembersValues();
        const blocksPerDayUpdated = 418;

        const {controller} = await createTestController(a);

        const before = await controller.blocksPerDay();
        const controllerAsGov = Controller__factory.connect(
          controller.address,
          await DeployerUtils.startImpersonate(await controller.governance())
        );
        await controllerAsGov.setBlocksPerDay(blocksPerDayUpdated);
        const after = await controller.blocksPerDay();

        const ret = [before, after].join();
        const expected = [a.blocksPerDay, blocksPerDayUpdated].join();

        expect(ret).to.be.equal(expected);
      });
    });
    describe ("Bad paths", () => {
      describe ("Set ZERO blocks per day", () => {
        it("should set expected value", async () => {
          const a = getRandomMembersValues();
          const blocksPerDayUpdated = 0; // (!)

          const {controller} = await createTestController(a);

          await expect(
            controller.setBlocksPerDay(blocksPerDayUpdated)
          ).revertedWith("TC-29");
        });
      });
      describe ("Not governance", () => {
        it("should set expected value", async () => {
          const a = getRandomMembersValues();
          const {controller} = await createTestController(a);
          const controllerNotGov = Controller__factory.connect(controller.address, user3);
          await expect(
            controllerNotGov.setBlocksPerDay(4000)
          ).revertedWith("TC-9"); // GOVERNANCE_ONLY
        });
      });
    });
  });

  describe ("setMinHealthFactor2", () => {
    describe ("Good paths", () => {
      it("should set expected value", async () => {
        const a = getRandomMembersValues();
        const minHealthFactorUpdated = 101;

        const {controller} = await createTestController(a);

        const before = await controller.minHealthFactor2();
        const controllerAsGov = Controller__factory.connect(
          controller.address
          , await DeployerUtils.startImpersonate(await controller.governance())
        );
        await controllerAsGov.setMinHealthFactor2(minHealthFactorUpdated);
        const after = await controller.minHealthFactor2();

        const ret = [before, after].join();
        const expected = [a.minHealthFactor2, minHealthFactorUpdated].join();

        expect(ret).to.be.equal(expected);
      });
    });
    describe ("Bad paths", () => {
      describe ("Set too small min health factor", () => {
        it("should set expected value", async () => {
          const controller = await prepareTestController();
          await expect(
            controller.setMinHealthFactor2(1) // (!) 1 < 100
          ).revertedWith("TC-3: wrong health factor");
        });
      });
      describe ("Set too min health factor bigger then target health factor", () => {
        it("should set expected value", async () => {
          const controller = await prepareTestController();
          await expect(
            controller.setMinHealthFactor2(1000) // (!) 1000 > target health factor
          ).revertedWith("TC-38: wrong health factor config");
        });
      });
      describe ("Not governance", () => {
        it("should set expected value", async () => {
          const a = getRandomMembersValues();
          const {controller} = await createTestController(a);
          const controllerNotGov = Controller__factory.connect(controller.address, user3);
          await expect(
            controllerNotGov.setMinHealthFactor2(125)
          ).revertedWith("TC-9"); // GOVERNANCE_ONLY
        });
      });
    });
  });
  describe ("setTargetHealthFactor2", () => {
    describe ("Good paths", () => {
      it("should set expected value", async () => {
        const a = getRandomMembersValues();
        const targetHealthFactorUpdated = 301;

        const {controller} = await createTestController(a);

        const before = await controller.targetHealthFactor2();
        const controllerAsGov = Controller__factory.connect(
          controller.address
          , await DeployerUtils.startImpersonate(await controller.governance())
        );
        await controllerAsGov.setTargetHealthFactor2(targetHealthFactorUpdated);
        const after = await controller.targetHealthFactor2();

        const ret = [before, after].join();
        const expected = [a.targetHealthFactor2, targetHealthFactorUpdated].join();

        expect(ret).to.be.equal(expected);
      });
    });
    describe ("Bad paths", () => {
      describe ("Target health factor is equal to MIN health factor", () => {
        it("should set expected value", async () => {
          const controller = await prepareTestController();
          await expect(
            controller.setTargetHealthFactor2(
              await controller.minHealthFactor2()
            )
          ).revertedWith("TC-38: wrong health factor config");
        });
      });
      describe ("Target health factor is equal to MAX health factor", () => {
        it("should set expected value", async () => {
          const controller = await prepareTestController();
          await expect(
            controller.setTargetHealthFactor2(
              await controller.maxHealthFactor2()
            )
          ).revertedWith("TC-38: wrong health factor config");
        });
      });
      describe ("Not governance", () => {
        it("should set expected value", async () => {
          const a = getRandomMembersValues();
          const {controller} = await createTestController(a);
          const controllerNotGov = Controller__factory.connect(controller.address, user3);
          await expect(
            controllerNotGov.setTargetHealthFactor2(250)
          ).revertedWith("TC-9"); // GOVERNANCE_ONLY
        });
      });
    });
  });
  describe ("setMaxHealthFactor2", () => {
    describe ("Good paths", () => {
      it("should set expected value", async () => {
        const a = getRandomMembersValues();
        const maxHealthFactorUpdated = 400;

        const {controller} = await createTestController(a);

        const before = await controller.maxHealthFactor2();
        const controllerAsGov = Controller__factory.connect(
          controller.address
          , await DeployerUtils.startImpersonate(await controller.governance())
        );
        await controllerAsGov.setMaxHealthFactor2(maxHealthFactorUpdated);
        const after = await controller.maxHealthFactor2();

        const ret = [before, after].join();
        const expected = [a.maxHealthFactor2, maxHealthFactorUpdated].join();

        expect(ret).to.be.equal(expected);
      });
    });
    describe ("Bad paths", () => {
      describe ("MAX health factor is equal to TARGET health factor", () => {
        it("should set expected value", async () => {
          const controller = await prepareTestController();
          await expect(
            controller.setMaxHealthFactor2(
              await controller.targetHealthFactor2()
            )
          ).revertedWith("TC-38: wrong health factor config");
        });
      });
      describe ("Not governance", () => {
        it("should set expected value", async () => {
          const a = getRandomMembersValues();
          const {controller} = await createTestController(a);
          const controllerNotGov = Controller__factory.connect(controller.address, user3);
          await expect(
            controllerNotGov.setMaxHealthFactor2(1250)
          ).revertedWith("TC-9"); // GOVERNANCE_ONLY
        });
      });
    });
  });
//endregion Unit tests

});
