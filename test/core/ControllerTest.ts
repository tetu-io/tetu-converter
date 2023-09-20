import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {expect} from "chai";
import {ConverterController, ConverterController__factory} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {GAS_LIMIT_CONTROLLER_INITIALIZE} from "../baseUT/GasLimit";
import {Misc} from "../../scripts/utils/Misc";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {randomInt} from "crypto";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {
  controlGasLimitsEx2,
  HARDHAT_NETWORK_ID,
  HardhatUtils
} from "../../scripts/utils/HardhatUtils";

describe("Controller", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let user3: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user3 = signers[4];
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
    proxyUpdater: string;
    governance: string;
    tetuConverter: string;
    borrowManager: string;
    debtMonitor: string;

    keeper: string;
    tetuLiquidator: string;
    swapManager: string;
    priceOracle: string;

    minHealthFactor2: number;
    targetHealthFactor2: number;
    maxHealthFactor2: number;

    blocksPerDay: BigNumber;
    debtGap: BigNumber;
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
      a.priceOracle,

      a.minHealthFactor2.toString(),
      a.targetHealthFactor2.toString(),
      a.maxHealthFactor2.toString(),

      a.blocksPerDay.toString(),
      a.debtGap.toString()
    ];
  }

  async function getValuesArray(controller: ConverterController) : Promise<string[]> {
    return [
      await controller.governance(),

      await controller.tetuConverter(),
      await controller.borrowManager(),
      await controller.debtMonitor(),

      await controller.keeper(),
      await controller.tetuLiquidator(),
      await controller.swapManager(),
      await controller.priceOracle(),

      (await controller.minHealthFactor2()).toString(),
      (await controller.targetHealthFactor2()).toString(),
      (await controller.maxHealthFactor2()).toString(),

      (await controller.blocksPerDay()).toString(),
      (await controller.debtGap()).toString(),
    ];
  }

  async function createTestController(
    a: IControllerMembers,
  ) : Promise<{controller: ConverterController, gasUsed: BigNumber}> {
    const controller = ConverterController__factory.connect(await CoreContractsHelper.deployController(deployer), deployer);

    const gasUsed = await HardhatUtils.getGasUsed(
      controller.init(
        a.proxyUpdater,
        a.governance,
        a.tetuConverter,
        a.borrowManager,
        a.debtMonitor,
        a.keeper,
        a.swapManager,
        a.priceOracle,
        a.tetuLiquidator,
        a.blocksPerDay
      )
    );

    // maxHealthFactor2 was removed from initialize in ver.13
    await controller.connect(await Misc.impersonate(a.governance)).setMaxHealthFactor2(a.maxHealthFactor2);
    await controller.connect(await Misc.impersonate(a.governance)).setMinHealthFactor2(a.minHealthFactor2);
    await controller.connect(await Misc.impersonate(a.governance)).setTargetHealthFactor2(a.targetHealthFactor2);
    await controller.connect(await Misc.impersonate(a.governance)).setDebtGap(a.debtGap);

    return {controller, gasUsed};
  }

  function getRandomMembersValues() : IControllerMembers {
    return {
      proxyUpdater: ethers.Wallet.createRandom().address,
      governance: ethers.Wallet.createRandom().address,

      tetuConverter: ethers.Wallet.createRandom().address,
      borrowManager: ethers.Wallet.createRandom().address,
      debtMonitor: ethers.Wallet.createRandom().address,

      keeper: ethers.Wallet.createRandom().address,
      tetuLiquidator: ethers.Wallet.createRandom().address,
      swapManager: ethers.Wallet.createRandom().address,
      priceOracle: ethers.Wallet.createRandom().address,

      minHealthFactor2: 120 + randomInt(10),
      targetHealthFactor2: 220 + randomInt(10),
      maxHealthFactor2: 920 + randomInt(10),

      blocksPerDay: BigNumber.from(1000 + randomInt(1000)),
      debtGap: BigNumber.from(1000 + randomInt(1000)),
    }
  }

  async function prepareTestController() : Promise<ConverterController> {
    const a = getRandomMembersValues();
    const {controller} = await createTestController(a);
    return controller;
  }
//endregion Utils

//region Unit tests
  describe ("init", () => {
    describe ("Good paths", () => {
      it("should initialize values correctly", async () => {
        const a = getRandomMembersValues();

        const {controller} = await createTestController(a);

        const ret = (await getValuesArray(controller)).join();
        const expected = getMembersArray(a).join();

        expect(ret).to.be.equal(expected);
      });
      it("should not exceed gas limits  @skip-on-coverage", async () => {
        const a = getRandomMembersValues();

        const {gasUsed} = await createTestController(a);

        controlGasLimitsEx2(gasUsed, GAS_LIMIT_CONTROLLER_INITIALIZE, (u, t) => {
            expect(u).to.be.below(t);
          }
        );
      });
    });

    describe ("Bad paths", () => {
      describe("Zero address", () => {
        it("should revert if tetuConverter is zero", async () => {
          const a = getRandomMembersValues();
          a.tetuConverter = Misc.ZERO_ADDRESS;
          await expect(createTestController(a)).revertedWith("TC-1 zero address");
        });
        it("should revert if borrowManager is zero", async () => {
          const a = getRandomMembersValues();
          a.borrowManager = Misc.ZERO_ADDRESS;
          await expect(createTestController(a)).revertedWith("TC-1 zero address");
        });
        it("should revert if debtMonitor is zero", async () => {
          const a = getRandomMembersValues();
          a.debtMonitor = Misc.ZERO_ADDRESS;
          await expect(createTestController(a)).revertedWith("TC-1 zero address");
        });
        it("should revert if keeper is zero", async () => {
          const a = getRandomMembersValues();
          a.keeper = Misc.ZERO_ADDRESS;
          await expect(createTestController(a)).revertedWith("TC-1 zero address");
        });
        it("should revert if tetuLiquidator is zero", async () => {
          const a = getRandomMembersValues();
          a.tetuLiquidator = Misc.ZERO_ADDRESS;
          await expect(createTestController(a)).revertedWith("TC-1 zero address");
        });
        it("should revert if swapManager is zero", async () => {
          const a = getRandomMembersValues();
          a.swapManager = Misc.ZERO_ADDRESS;
          await expect(createTestController(a)).revertedWith("TC-1 zero address");
        });
        it("should revert if priceOracle is zero", async () => {
          const a = getRandomMembersValues();
          a.priceOracle = Misc.ZERO_ADDRESS;
          await expect(createTestController(a)).revertedWith("TC-1 zero address");
        });
      });

      it("should revert if zero governance", async () => {
        const a = getRandomMembersValues();
        a.governance = Misc.ZERO_ADDRESS;
        await expect(
          createTestController(a)
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if zero proxyUpdater", async () => {
        const a = getRandomMembersValues();
        a.proxyUpdater = Misc.ZERO_ADDRESS;
        await expect(
          createTestController(a)
        ).revertedWith("TC-1 zero address");
      });
      it("Min health factor is too small - should revert", async () => {
        const a = getRandomMembersValues();
        a.minHealthFactor2 = 99; // (!)

        await expect(
          createTestController(a)
        ).revertedWith("TC-3 wrong health factor");
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
        ).revertedWith("TC-29 incorrect value");
      });
      it("should revert if already initialized", async () => {
        const a = getRandomMembersValues();
        const {controller} = await createTestController(a);
        await expect(
          controller.init(
            a.proxyUpdater,
            a.governance,
            a.tetuConverter,
            a.borrowManager,
            a.debtMonitor,
            a.keeper,
            a.swapManager,
            a.priceOracle,
            a.tetuLiquidator,
            a.blocksPerDay,
          )
        ).revertedWith("Initializable: contract is already initialized");
      });
    });
  });

  describe ("set/acceptGovernance", () => {
    describe ("Good paths", () => {
      it("should change the governance", async () => {
        const {controller} = await createTestController(getRandomMembersValues());

        const existGovernance = await controller.governance();
        const newGovernance = ethers.Wallet.createRandom().address;

        const controllerAsOldGov = ConverterController__factory.connect(controller.address,
          await DeployerUtils.startImpersonate(existGovernance)
        );
        const controllerAsNewGov = ConverterController__factory.connect(controller.address,
          await DeployerUtils.startImpersonate(newGovernance)
        );

        await controllerAsOldGov.setGovernance(newGovernance);
        const afterOffer = await controller.governance();

        await controllerAsNewGov.acceptGovernance();
        const afterAccepting = await controller.governance();

        const ret = [afterOffer, afterAccepting].join();
        const expected = [existGovernance, newGovernance].join();
        expect(ret).eq(expected);
      });
      it("governance changes the governance to itself, success", async () => {
        const {controller} = await createTestController(getRandomMembersValues());

        const existGovernance = await controller.governance();

        const controllerAsGov = ConverterController__factory.connect(controller.address,
          await DeployerUtils.startImpersonate(existGovernance)
        );

        await controllerAsGov.setGovernance(existGovernance);
        const afterOffer = await controller.governance();

        await controllerAsGov.acceptGovernance();
        const afterAccepting = await controller.governance();

        const ret = [afterOffer, afterAccepting].join();
        const expected = [existGovernance, existGovernance].join();
        expect(ret).eq(expected);
      });
    });

    describe ("Bad paths", () => {
      it("should revert if zero address", async () => {
        const {controller} = await createTestController(getRandomMembersValues());

        const existGovernance = await controller.governance();
        const newGovernance = Misc.ZERO_ADDRESS;  // (!)

        const controllerAsOldGov = ConverterController__factory.connect(controller.address,
          await DeployerUtils.startImpersonate(existGovernance)
        );

        await expect(
          controllerAsOldGov.setGovernance(newGovernance)
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert if not governance", async () => {
        const {controller} = await createTestController(getRandomMembersValues());

        const notGovernance = ethers.Wallet.createRandom().address;
        const newGovernance = ethers.Wallet.createRandom().address;

        const controllerAsNotGov = ConverterController__factory.connect(controller.address,
          await DeployerUtils.startImpersonate(notGovernance)
        );

        await expect(
          controllerAsNotGov.setGovernance(newGovernance)
        ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
      });
      it("should revert if not new-governance tries to accept", async () => {
        const {controller} = await createTestController(getRandomMembersValues());

        const existGovernance = await controller.governance();
        const newGovernance = ethers.Wallet.createRandom().address;
        const notNewGovernance = ethers.Wallet.createRandom().address;

        const controllerAsOldGov = ConverterController__factory.connect(controller.address,
          await DeployerUtils.startImpersonate(existGovernance)
        );
        const controllerAsNotNewGov = ConverterController__factory.connect(controller.address,
          await DeployerUtils.startImpersonate(notNewGovernance)
        );

        await controllerAsOldGov.setGovernance(newGovernance);
        await expect(
          controllerAsNotNewGov.acceptGovernance()
        ).revertedWith("TC-51 not pending gov"); // NOT_PENDING_GOVERNANCE
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
        const beforeLastBlockNumber = (await controller.lastBlockNumber()).toNumber();

        const controllerAsGov = ConverterController__factory.connect(
          controller.address,
          await DeployerUtils.startImpersonate(await controller.governance())
        );
        await controllerAsGov.setBlocksPerDay(blocksPerDayUpdated, false);
        const after = await controller.blocksPerDay();
        const afterLastBlockNumber = (await controller.lastBlockNumber()).toNumber();

        const ret = [before, after, beforeLastBlockNumber, afterLastBlockNumber].join();
        const expected = [a.blocksPerDay, blocksPerDayUpdated, 0, 0].join();

        expect(ret).to.be.equal(expected);
      });
      it("should enable auto-update", async () => {
        const a = getRandomMembersValues();
        const blocksPerDayUpdated = 418;

        const {controller} = await createTestController(a);

        const before = await controller.blocksPerDay();
        const beforeLastBlockNumber = (await controller.lastBlockNumber()).toNumber();

        const controllerAsGov = ConverterController__factory.connect(
          controller.address,
          await DeployerUtils.startImpersonate(await controller.governance())
        );
        await controllerAsGov.setBlocksPerDay(blocksPerDayUpdated, true);
        const after = await controller.blocksPerDay();
        const afterLastBlockNumber = (await controller.lastBlockNumber()).toNumber();

        const ret = [before, after, beforeLastBlockNumber, afterLastBlockNumber > 0].join();
        const expected = [a.blocksPerDay, blocksPerDayUpdated, 0, true].join();

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
            controller.setBlocksPerDay(blocksPerDayUpdated, false)
          ).revertedWith("TC-29 incorrect value");
        });
      });
      describe ("Not governance", () => {
        it("should set expected value", async () => {
          const a = getRandomMembersValues();
          const {controller} = await createTestController(a);
          const controllerNotGov = ConverterController__factory.connect(controller.address, user3);
          await expect(
            controllerNotGov.setBlocksPerDay(4000, false)
          ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
        });
      });
    });
  });

  describe ("isBlocksPerDayAutoUpdateRequired", () => {
    describe ("Good paths", () => {
      it("should return false", async () => {
        const {controller} = await createTestController(getRandomMembersValues());

        const controllerAsGov = ConverterController__factory.connect(
          controller.address,
          await DeployerUtils.startImpersonate(await controller.governance())
        );
        await controllerAsGov.setBlocksPerDay(400, true);
        // const block1 = await hre.ethers.provider.getBlock("latest");
        await TimeUtils.advanceNBlocks(1); // we assume here, that 1 block < 100 seconds
        // const block2 = await hre.ethers.provider.getBlock("latest");
        const ret = await controller.isBlocksPerDayAutoUpdateRequired(100); // 100 seconds

        expect(ret).to.be.equal(false);
      });
      it("should return true", async () => {
        const {controller} = await createTestController(getRandomMembersValues());

        const controllerAsGov = ConverterController__factory.connect(
          controller.address,
          await DeployerUtils.startImpersonate(await controller.governance())
        );
        await controllerAsGov.setBlocksPerDay(400, true);
        await TimeUtils.advanceNBlocks(200); // we assume here, that 200 blocks > 100 seconds
        const ret = await controller.isBlocksPerDayAutoUpdateRequired(100);

        expect(ret).to.be.equal(true);
      });
    });
  });

  describe("updateBlocksPerDay", () => {
    describe("Good paths", () => {
      it("should assigned expected value to blocksPerDay", async () => {
        const {controller} = await createTestController(getRandomMembersValues());

        const controllerAsGov = ConverterController__factory.connect(
          controller.address,
          await DeployerUtils.startImpersonate(await controller.governance())
        );
        await controllerAsGov.setBlocksPerDay(400, true);
        const block0 = await hre.ethers.provider.getBlock("latest");
        const lastBlockNumber0 = (await controller.lastBlockNumber()).toNumber();
        const lastBlockTimestamp0 = (await controller.lastBlockTimestamp()).toNumber();

        const periodSecs = 100; // seconds

        // eslint-disable-next-line no-constant-condition
        while (true) {
          await TimeUtils.advanceNBlocks(10);
          const block = await hre.ethers.provider.getBlock("latest");
          if (block.timestamp - block0.timestamp > periodSecs) {
            break;
          }
        }

        const controllerAsKeeper = ConverterController__factory.connect(
          controller.address,
          await DeployerUtils.startImpersonate(await controller.keeper())
        );

        await controllerAsKeeper.updateBlocksPerDay(100);
        const lastBlockNumber1 = (await controller.lastBlockNumber()).toNumber();
        const lastBlockTimestamp1 = (await controller.lastBlockTimestamp()).toNumber();

        const resultBlocksPerDay = (await controllerAsKeeper.blocksPerDay()).toNumber();
        const countPassedDays = (lastBlockTimestamp1 - lastBlockTimestamp0) / (24*60*60);
        const expectedBlocksPerDay = Math.floor((lastBlockNumber1 - lastBlockNumber0) / countPassedDays);

        expect(resultBlocksPerDay).eq(expectedBlocksPerDay);
      });
    });
    describe("Bad paths", () => {
      it("should revert if not keeper", async () => {
        const {controller} = await createTestController(getRandomMembersValues());

        const controllerAsGov = ConverterController__factory.connect(
          controller.address,
          await DeployerUtils.startImpersonate(await controller.governance())
        );
        await controllerAsGov.setBlocksPerDay(400, true);
        await TimeUtils.advanceNBlocks(50); // assume here, that 50 blocks > 10 seconds
        await expect(
          controllerAsGov.updateBlocksPerDay(10)
        ).revertedWith("TC-42 keeper only");
      });
      it("should revert if auto-update is disabled", async () => {
        const {controller} = await createTestController(getRandomMembersValues());

        const controllerAsGov = ConverterController__factory.connect(
          controller.address,
          await DeployerUtils.startImpersonate(await controller.governance())
        );
        await controllerAsGov.setBlocksPerDay(400,
          true // auto-update is enabled
        );
        await controllerAsGov.setBlocksPerDay(400,
          false // (!) auto-update is disabled
        );
        const controllerAsKeeper = ConverterController__factory.connect(
          controller.address,
          await DeployerUtils.startImpersonate(await controller.keeper())
        );
        await TimeUtils.advanceNBlocks(50); // assume here, that 50 blocks > 10 seconds
        await expect(
          controllerAsKeeper.updateBlocksPerDay(10)
        ).revertedWith("TC-52 incorrect op");
      });
      it("should revert if period is zero", async () => {
        const {controller} = await createTestController(getRandomMembersValues());

        const controllerAsGov = ConverterController__factory.connect(controller.address,
          await DeployerUtils.startImpersonate(await controller.governance())
        );
        await controllerAsGov.setBlocksPerDay(400, true);
        const controllerAsKeeper = ConverterController__factory.connect(controller.address,
          await DeployerUtils.startImpersonate(await controller.keeper())
        );
        await TimeUtils.advanceNBlocks(50); // assume here, that 50 blocks > 10 seconds
        await expect(
          controllerAsKeeper.updateBlocksPerDay(
            0 // (!)
          )
        ).revertedWith("TC-29 incorrect value");
      });
      it("should revert if auto-update is not yet required", async () => {
        const {controller} = await createTestController(getRandomMembersValues());

        const controllerAsGov = ConverterController__factory.connect(controller.address,
          await DeployerUtils.startImpersonate(await controller.governance())
        );
        await controllerAsGov.setBlocksPerDay(400, true);
        const controllerAsKeeper = ConverterController__factory.connect(controller.address,
          await DeployerUtils.startImpersonate(await controller.keeper())
        );
        await TimeUtils.advanceNBlocks(50);
        await expect(
          controllerAsKeeper.updateBlocksPerDay(
            100000 // (!) it's not time to auto-update yet
          )
        ).revertedWith("TC-29 incorrect value");
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
        const controllerAsGov = ConverterController__factory.connect(
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
          ).revertedWith("TC-3 wrong health factor");
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
          const controllerNotGov = ConverterController__factory.connect(controller.address, user3);
          await expect(
            controllerNotGov.setMinHealthFactor2(125)
          ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
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
        const controllerAsGov = ConverterController__factory.connect(
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
          const controllerNotGov = ConverterController__factory.connect(controller.address, user3);
          await expect(
            controllerNotGov.setTargetHealthFactor2(250)
          ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
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
        const controllerAsGov = ConverterController__factory.connect(
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
          const controllerNotGov = ConverterController__factory.connect(controller.address, user3);
          await expect(
            controllerNotGov.setMaxHealthFactor2(1250)
          ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
        });
      });
    });
  });

  describe ("events", () => {
    it("should emit expected events", async () => {
      const {controller} = await createTestController(getRandomMembersValues());
      const controllerAsGov = await ConverterController__factory.connect(
        controller.address,
        await DeployerUtils.startImpersonate(await controller.governance())
      );
      await expect(
        controllerAsGov.setBlocksPerDay(100, false)
      ).to.emit(controller, "OnSetBlocksPerDay").withArgs(100, false);

      await expect(
        controllerAsGov.setMinHealthFactor2(111)
      ).to.emit(controller, "OnSetMinHealthFactor2").withArgs(111);

      await expect(
        controllerAsGov.setTargetHealthFactor2(213)
      ).to.emit(controller, "OnSetTargetHealthFactor2").withArgs(213);

      await expect(
        controllerAsGov.setMaxHealthFactor2(516)
      ).to.emit(controller, "OnSetMaxHealthFactor2").withArgs(516);

      const newGovernance = ethers.Wallet.createRandom().address;
      await expect(
        controllerAsGov.setGovernance(newGovernance)
      ).to.emit(controller, "OnSetGovernance").withArgs(newGovernance);

      await expect(
        ConverterController__factory.connect(
          controller.address,
          await DeployerUtils.startImpersonate(newGovernance)
        ).acceptGovernance()
      ).to.emit(controller, "OnAcceptGovernance").withArgs(newGovernance);
    });
  });

  describe("set/paused", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        const {controller} = await createTestController(getRandomMembersValues());
        const before = await controller.paused();
        const governance = await controller.governance();
        await controller.connect(await DeployerUtils.startImpersonate(governance)).setPaused(true);
        const middle = await controller.paused();
        await controller.connect(await DeployerUtils.startImpersonate(governance)).setPaused(false);
        const after = await controller.paused();

        const ret = [before, middle, after].join();
        const expected = [false, true, false].join();

        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert if not governance", async () => {
        const notGovernance = ethers.Wallet.createRandom().address;
        const {controller} = await createTestController(getRandomMembersValues());

        await expect(
          controller.connect(await DeployerUtils.startImpersonate(notGovernance)).setPaused(true)
        ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
      });
    });
  });

  describe("setWhitelist", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        const user1 = ethers.Wallet.createRandom().address;
        const user2 = ethers.Wallet.createRandom().address;
        const user7 = ethers.Wallet.createRandom().address;

        const {controller} = await createTestController(getRandomMembersValues());
        const governance = await controller.governance();
        await controller.connect(await DeployerUtils.startImpersonate(governance)).setWhitelistValues([user1, user2], true);
        const state10 = await controller.isWhitelisted(user1);
        const state20 = await controller.isWhitelisted(user2);
        const state30 = await controller.isWhitelisted(user7);
        await controller.connect(await DeployerUtils.startImpersonate(governance)).setWhitelistValues([user1, user7], false);
        const state11 = await controller.isWhitelisted(user1);
        const state21 = await controller.isWhitelisted(user2);
        const state31 = await controller.isWhitelisted(user7);
        await controller.connect(await DeployerUtils.startImpersonate(governance)).setWhitelistValues([user1, user2, user7], true);
        const state12 = await controller.isWhitelisted(user1);
        const state22 = await controller.isWhitelisted(user2);
        const state32 = await controller.isWhitelisted(user7);

        const ret = [
          state10, state20, state30,
          state11, state21, state31,
          state12, state22, state32
        ].join("\n");
        const expected = [
          true, true, false,
          false, true, false,
          true, true, true
        ].join("\n");

        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert if not governance", async () => {
        const notGovernance = ethers.Wallet.createRandom().address;
        const {controller} = await createTestController(getRandomMembersValues());
        const user1 = ethers.Wallet.createRandom().address;

        await expect(
          controller.connect(await DeployerUtils.startImpersonate(notGovernance)).setWhitelistValues([user1], true)
        ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
      });
    });
  });

  describe("debtGap", () => {
    describe("Good paths", () => {
      it("should set debt gap 1%", async () => {
        const debtGap = 1_000; // 1%
        const {controller} = await createTestController(getRandomMembersValues());
        await controller.connect(await DeployerUtils.startImpersonate(await controller.governance())).setDebtGap(debtGap);

        const retDebtGap = await controller.debtGap();
        expect(retDebtGap).eq(debtGap);
      });
      it("should set debt gap 0", async () => {
        const debtGap = 0;
        const {controller} = await createTestController(getRandomMembersValues());
        await controller.connect(await DeployerUtils.startImpersonate(await controller.governance())).setDebtGap(10000);
        await controller.connect(await DeployerUtils.startImpersonate(await controller.governance())).setDebtGap(debtGap);

        const retDebtGap = await controller.debtGap();
        expect(retDebtGap).eq(debtGap);
      });
      it("should set debt gap 200%", async () => {
        const debtGap = 200_000;
        const {controller} = await createTestController(getRandomMembersValues());
        await controller.connect(await DeployerUtils.startImpersonate(await controller.governance())).setDebtGap(debtGap);

        const retDebtGap = await controller.debtGap();
        expect(retDebtGap).eq(debtGap);
      });
    });
    describe("Bad paths", () => {
      it("should revert if not governance", async () => {
        const {controller} = await createTestController(getRandomMembersValues());

        const debtGap = 100_000 + 1; // (!) too big
        await expect(
          controller.connect(await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)).setDebtGap(debtGap)
        ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
      });
    });
  });

  describe("setPriceOracle", () => {
    describe("Good paths", () => {
      it("should update price oracle", async () => {
        const newPriceOracle = ethers.Wallet.createRandom().address;
        const {controller} = await createTestController(getRandomMembersValues());
        await controller.connect(await DeployerUtils.startImpersonate(await controller.governance())).setPriceOracle(newPriceOracle);

        const priceOracle = await controller.priceOracle();
        expect(priceOracle).eq(newPriceOracle);
      });
    });
    describe("Bad paths", () => {
      it("should revert if not governance", async () => {
        const {controller} = await createTestController(getRandomMembersValues());
        await expect(
          controller.connect(await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)).setPriceOracle(ethers.Wallet.createRandom().address)
        ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
      });
      it("should revert if zero address", async () => {
        const {controller} = await createTestController(getRandomMembersValues());
        await expect(
          controller.connect(await DeployerUtils.startImpersonate(await controller.governance())).setPriceOracle(Misc.ZERO_ADDRESS)
        ).revertedWith("TC-1 zero address"); // AppErrors.ZERO_ADDRESS
      });
    });
  });
//endregion Unit tests

});
