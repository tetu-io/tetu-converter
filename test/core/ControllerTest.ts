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
  interface IControllerAddresses {
    governance: string;
    tetuConverter: string;
    borrowManager: string;
    debtMonitor: string;

    borrower: string;
    tetuLiquidator: string,
    swapManager: string,
  }

  type ControllerAddressesKeys = keyof IControllerAddresses;

  function getAddressesArray(a: IControllerAddresses): string[] {
    return [
      a.governance

      , a.tetuConverter
      , a.borrowManager
      , a.debtMonitor

      , a.borrower
      , a.tetuLiquidator
      , a.swapManager
    ];
  }

  async function getValuesArray(controller: Controller) : Promise<string[]> {
    return [
      await controller.governance()

      , await controller.tetuConverter()
      , await controller.borrowManager()
      , await controller.debtMonitor()

      , await controller.borrower()
      , await controller.tetuLiquidator()
      , await controller.swapManager()
    ];
  }

  async function createTestController(
    a: IControllerAddresses,
    minHealthFactor: number = 101,
    targetHealthFactor: number = 200,
    maxHealthFactor: number = 400,
    blocksPerDay: number = COUNT_BLOCKS_PER_DAY
  ) : Promise<{controller: Controller, gasUsed: BigNumber}> {
    const controller = (await DeployUtils.deployContract(deployer
      , 'Controller'
      , blocksPerDay
      , a.governance
      , minHealthFactor
      , targetHealthFactor
      , maxHealthFactor
    )) as Controller;

    const gasUsed = await getGasUsed(
      controller.initialize(
        a.tetuConverter
        , a.borrowManager
        , a.debtMonitor
        , a.borrower
        , a.tetuLiquidator
        , a.swapManager
      )
    );

    return {controller, gasUsed};
  }

  function getRandomControllerAddresses() : IControllerAddresses {
    return {
      governance: ethers.Wallet.createRandom().address,

      tetuConverter: ethers.Wallet.createRandom().address,
      borrowManager: ethers.Wallet.createRandom().address,
      debtMonitor: ethers.Wallet.createRandom().address,

      borrower: ethers.Wallet.createRandom().address,
      tetuLiquidator: ethers.Wallet.createRandom().address,
      swapManager: ethers.Wallet.createRandom().address,
    }
  }

  async function setAddresses(
    controller: Controller,
    a: IControllerAddresses
  ) : Promise<{gasUsed: BigNumber[]}> {
    console.log('a', a);
    const gasUsed = [
      await getGasUsed(controller.setTetuConverter(a.tetuConverter)),
      await getGasUsed(controller.setBorrowManager(a.borrowManager)),
      await getGasUsed(controller.setDebtMonitor(a.debtMonitor)),
      await getGasUsed(controller.setBorrower(a.borrower)),
      await getGasUsed(controller.setSwapManager(a.swapManager)),
      await getGasUsed(controller.setTetuLiquidator(a.tetuLiquidator)),
      // Governance must be set at the end to avoid check error. Add new setXXX above
      await getGasUsed(controller.setGovernance(a.governance)),
    ];

    return {gasUsed};
  }

  async function prepareTestController() : Promise<Controller> {
    const a = getRandomControllerAddresses();
    // initial values
    const minHealthFactor = 310;
    const targetHealthFactor = 320;
    const maxHealthFactor = 330;

    const {controller} = await createTestController(
      a,
      minHealthFactor,
      targetHealthFactor,
      maxHealthFactor,
    );

    return controller;
  }
//endregion Utils

//region Unit tests
  describe ("constructor and initialize", () => {
    describe ("Good paths", () => {
      it("should initialize addresses correctly", async () => {
        const a = getRandomControllerAddresses();

        const {controller, gasUsed} = await createTestController(a);

        const ret = (await getValuesArray(controller)).join();
        const expected = getAddressesArray(a).join();

        expect(ret).to.be.equal(expected);
        controlGasLimitsEx(gasUsed, GAS_LIMIT_CONTROLLER_INITIALIZE, (u, t) => {
            expect(u).to.be.below(t);
          }
        );
      });

      it("should initialize health factors and blocks per day correctly", async () => {
        const a = getRandomControllerAddresses();
        const minHealthFactor = 300;
        const targetHealthFactor = 301;
        const maxHealthFactor = 302;
        const blocksPerDay = 417;

        const {controller, gasUsed} = await createTestController(
          a,
          minHealthFactor,
          targetHealthFactor,
          maxHealthFactor,
          blocksPerDay
        );

        const ret = [
          await controller.minHealthFactor2(),
          await controller.targetHealthFactor2(),
          await controller.maxHealthFactor2(),
          await controller.blocksPerDay()
        ].join();
        const expected = [
          minHealthFactor,
          targetHealthFactor,
          maxHealthFactor,
          blocksPerDay
        ].join();

        expect(ret).to.be.equal(expected);
        controlGasLimitsEx(gasUsed, GAS_LIMIT_CONTROLLER_INITIALIZE, (u, t) => {
            expect(u).to.be.below(t);
          }
        );
      });
    });

    describe ("Bad paths", () => {
      describe ("Zero address", () => {
        it("should revert", async () => {
          const a = getRandomControllerAddresses();
          for (const key of Object.keys(a)) {
            const b = getRandomControllerAddresses();

            // let's set one of address to 0

            b[key as ControllerAddressesKeys] = Misc.ZERO_ADDRESS;

            await expect(
              createTestController(b)
            ).revertedWith("TC-1");
          }
        });
      });
      describe ("Min health factor is too small", () => {
        it("should revert", async () => {
          const a = getRandomControllerAddresses();
          const minHealthFactor = 99; // (!)
          const targetHealthFactor = 301;
          const maxHealthFactor = 302;

          await expect(
            createTestController(
              a,
              minHealthFactor,
              targetHealthFactor,
              maxHealthFactor
            )
          ).revertedWith("TC-3: wrong health factor");
        });
      });
      describe ("Min health factor is not less then target health factor", () => {
        it("should revert", async () => {
          const a = getRandomControllerAddresses();
          const minHealthFactor = 300;
          const targetHealthFactor = minHealthFactor; // (!)
          const maxHealthFactor = 302;

          await expect(
            createTestController(
              a,
              minHealthFactor,
              targetHealthFactor,
              maxHealthFactor
            )
          ).revertedWith("TC-38: wrong health factor config");
        });
      });
      describe ("Target health factor is not less then max health factor", () => {
        it("should revert", async () => {
          const a = getRandomControllerAddresses();
          const minHealthFactor = 300;
          const targetHealthFactor = 302;
          const maxHealthFactor = targetHealthFactor; // (!)

          await expect(
            createTestController(
              a,
              minHealthFactor,
              targetHealthFactor,
              maxHealthFactor
            )
          ).revertedWith("TC-38: wrong health factor config");
        });
      });
      describe ("Blocks per day = 0", () => {
        it("should revert", async () => {
          const a = getRandomControllerAddresses();
          const minHealthFactor = 300;
          const targetHealthFactor = 302;
          const maxHealthFactor = 303;
          const blocksPerDay = 0; // (!)

          await expect(
            createTestController(
              a,
              minHealthFactor,
              targetHealthFactor,
              maxHealthFactor,
              blocksPerDay
            )
          ).revertedWith("TC-29");
        });
      });
    });
  });

  describe ("set addresses", () => {
    describe ("Good paths", () => {
      it("should initialize addresses correctly", async () => {
        const initialAddresses = getRandomControllerAddresses();
        console.log('initialAddresses', initialAddresses);
        const updatedAddresses = getRandomControllerAddresses();
        console.log('updatedAddresses', updatedAddresses);

        const {controller} = await createTestController(initialAddresses);
        const controllerAsGov = Controller__factory.connect(
          controller.address
          , await DeployerUtils.startImpersonate(initialAddresses.governance)
        );
        const {gasUsed} = await setAddresses(controllerAsGov, updatedAddresses);
        console.log('gasUsed', gasUsed);

        const ret = (await getValuesArray(controller)).join();
        const expected = getAddressesArray(updatedAddresses).join();

        expect(ret).to.be.equal(expected);
        controlGasLimitsEx(
          // get max value
          gasUsed.reduce((prev, cur) => prev.gt(cur) ? prev : cur)
          , GAS_LIMIT_CONTROLLER_SET_XXX
          , (u, t) => {
            expect(u).to.be.below(t);
          }
        );
      });
    });

    describe ("Bad paths", () => {
      describe ("Zero address", () => {
        it("should revert", async () => {
          const initialAddresses = getRandomControllerAddresses();

          const {controller} = await createTestController(initialAddresses);
          const controllerAsGov = Controller__factory.connect(
            controller.address
            , await DeployerUtils.startImpersonate(initialAddresses.governance)
          );

          for (const key of Object.keys(initialAddresses)) {
            const updatedAddresses: IControllerAddresses = {
              governance: await controller.governance(),
              borrower: await controller.borrower(),
              debtMonitor: await controller.debtMonitor(),
              borrowManager: await controller.borrowManager(),
              tetuConverter: await controller.tetuConverter(),
              tetuLiquidator: await controller.tetuLiquidator(),
              swapManager: await controller.swapManager(),
            };
            // let's set one of address to 0

            updatedAddresses[key as ControllerAddressesKeys] = Misc.ZERO_ADDRESS;

            console.log("initialAddresses", initialAddresses);
            console.log("updatedAddresses", updatedAddresses);

            await expect(
              setAddresses(controllerAsGov, updatedAddresses)
            ).revertedWith("TC-1");
          }
        });
      });
    });
  });

  describe ("setBlocksPerDay", () => {
    describe ("Good paths", () => {
      it("should set expected value", async () => {
        const a = getRandomControllerAddresses();
        // initial values
        const minHealthFactor = 300;
        const targetHealthFactor = 301;
        const maxHealthFactor = 302;
        const blocksPerDay = 417;
        // updated values
        const blocksPerDayUpdated = 418;

        const {controller} = await createTestController(
          a,
          minHealthFactor,
          targetHealthFactor,
          maxHealthFactor,
          blocksPerDay
        );

        const before = await controller.blocksPerDay();
        await controller.setBlocksPerDay(blocksPerDayUpdated);
        const after = await controller.blocksPerDay();

        const ret = [before, after].join();
        const expected = [blocksPerDay, blocksPerDayUpdated].join();

        expect(ret).to.be.equal(expected);
      });
    });
    describe ("Bad paths", () => {
      describe ("Set ZERO blocks per day", () => {
        it("should set expected value", async () => {
          const a = getRandomControllerAddresses();
          // initial values
          const minHealthFactor = 300;
          const targetHealthFactor = 301;
          const maxHealthFactor = 302;
          const blocksPerDay = 417;
          // updated values
          const blocksPerDayUpdated = 0; // (!)

          const {controller} = await createTestController(
            a,
            minHealthFactor,
            targetHealthFactor,
            maxHealthFactor,
            blocksPerDay
          );

          await expect(
            controller.setBlocksPerDay(blocksPerDayUpdated)
          ).revertedWith("TC-29");
        });
      });
    });
  });
  describe ("setMinHealthFactor2", () => {
    describe ("Good paths", () => {
      it("should set expected value", async () => {
        const a = getRandomControllerAddresses();
        // initial values
        const minHealthFactor = 300;
        const targetHealthFactor = 310;
        const maxHealthFactor = 320;
        // updated values
        const minHealthFactorUpdated = 205;

        const {controller} = await createTestController(
          a,
          minHealthFactor,
          targetHealthFactor,
          maxHealthFactor,
        );

        const before = await controller.minHealthFactor2();
        await controller.setMinHealthFactor2(minHealthFactorUpdated);
        const after = await controller.minHealthFactor2();

        const ret = [before, after].join();
        const expected = [minHealthFactor, minHealthFactorUpdated].join();

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
    });
  });
  describe ("setTargetHealthFactor2", () => {
    describe ("Good paths", () => {
      it("should set expected value", async () => {
        const a = getRandomControllerAddresses();
        // initial values
        const minHealthFactor = 300;
        const targetHealthFactor = 310;
        const maxHealthFactor = 320;
        // updated values
        const targetHealthFactorUpdated = 319;

        const {controller} = await createTestController(
          a,
          minHealthFactor,
          targetHealthFactor,
          maxHealthFactor,
        );

        const before = await controller.targetHealthFactor2();
        await controller.setTargetHealthFactor2(targetHealthFactorUpdated);
        const after = await controller.targetHealthFactor2();

        const ret = [before, after].join();
        const expected = [targetHealthFactor, targetHealthFactorUpdated].join();

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
    });
  });
  describe ("setMaxHealthFactor2", () => {
    describe ("Good paths", () => {
      it("should set expected value", async () => {
        const a = getRandomControllerAddresses();
        // initial values
        const minHealthFactor = 300;
        const targetHealthFactor = 310;
        const maxHealthFactor = 320;
        // updated values
        const maxHealthFactorUpdated = 400;

        const {controller} = await createTestController(
          a,
          minHealthFactor,
          targetHealthFactor,
          maxHealthFactor,
        );

        const before = await controller.maxHealthFactor2();
        await controller.setMaxHealthFactor2(maxHealthFactorUpdated);
        const after = await controller.maxHealthFactor2();

        const ret = [before, after].join();
        const expected = [maxHealthFactor, maxHealthFactorUpdated].join();

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
    });
  });
//endregion Unit tests

});
