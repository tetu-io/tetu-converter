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
  }

  function getAddressesArray(a: IControllerAddresses): string[] {
    return [
      a.governance

      , a.tetuConverter
      , a.borrowManager
      , a.debtMonitor

      , a.borrower
    ];
  }

  async function getValuesArray(controller: Controller) : Promise<string[]> {
    return [
      await controller.governance()

      , await controller.tetuConverter()
      , await controller.borrowManager()
      , await controller.debtMonitor()

      , await controller.borrower()
    ];
  }

  async function createTestController(
    a: IControllerAddresses
  ) : Promise<{controller: Controller, gasUsed: BigNumber}> {
    let controller = (await DeployUtils.deployContract(deployer
      , 'Controller'
      , COUNT_BLOCKS_PER_DAY
      , 101
      , a.governance
    )) as Controller;

    const gasUsed = await getGasUsed(
      controller.initialize(
        a.tetuConverter
        , a.borrowManager
        , a.debtMonitor
        , a.borrower
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
    }
  }

  async function setAddresses(
    controller: Controller
    , a: IControllerAddresses
  ) : Promise<{gasUsed: BigNumber[]}> {
    const gasUsed = [
      await getGasUsed(controller.setTetuConverter(a.tetuConverter)),
      await getGasUsed(controller.setBorrowManager(a.borrowManager)),
      await getGasUsed(controller.setDebtMonitor(a.debtMonitor)),
      await getGasUsed(controller.setBorrower(a.borrower)),
      await getGasUsed(controller.setGovernance(a.governance)),
    ];

    return {gasUsed};
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
    });

    describe ("Bad paths", () => {
      describe ("Zero address", () => {
        it("should revert", async () => {
          const a = getRandomControllerAddresses();
          type ta = typeof a;
          for (const key of Object.keys(a)) {
            const b = getRandomControllerAddresses();

            // let's set one of address to 0

            // @ts-ignore
            b[key] = Misc.ZERO_ADDRESS;

            await expect(
              createTestController(b)
            ).revertedWith("1");
          }
        });
      });
    });
  });

  describe ("setXXX", () => {
    describe ("Good paths", () => {
      it("should initialize addresses correctly", async () => {
        const initialAddresses = getRandomControllerAddresses();
        const updatedAddresses = getRandomControllerAddresses();

        const {controller} = await createTestController(initialAddresses);
        const controllerAsGov = Controller__factory.connect(
          controller.address
          , await DeployerUtils.startImpersonate(initialAddresses.governance)
        );
        const {gasUsed} = await setAddresses(controllerAsGov, updatedAddresses);

        const ret = (await getValuesArray(controller)).join();
        const expected = getAddressesArray(updatedAddresses).join();

        expect(ret).to.be.equal(expected);
        controlGasLimitsEx(
          //get max value
          gasUsed.reduce((prev, cur) => prev.gt(cur) ? prev : cur )
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

          type ta = typeof initialAddresses;
          for (const key of Object.keys(initialAddresses)) {
            const updatedAddresses: IControllerAddresses = {
              governance: await controller.governance(),
              borrower: await controller.borrower(),
              debtMonitor: await controller.debtMonitor(),
              borrowManager: await controller.borrowManager(),
              tetuConverter: await controller.tetuConverter()
            };
            // let's set one of address to 0

            // @ts-ignore
            updatedAddresses[key] = Misc.ZERO_ADDRESS;

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
//endregion Unit tests

});