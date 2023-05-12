import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  BorrowManager__factory,
  ConverterController,
  ConverterController__factory,
  DebtMonitor__factory,
  IBorrowManager__factory,
  Keeper__factory,
  ProxyControlled__factory, SwapManager__factory,
  TetuConverter__factory
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {Misc} from "../../scripts/utils/Misc";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {proxy} from "../../typechain/contracts";

/**
 * Most proxy contracts are proxy-contracts, that can be updated by proxy-updater only.
 * Proxy updater is tetu-contracts-v2 controller, that uses update with announce.
 *
 */
describe("ProxyTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let deployer: SignerWithAddress;
  let user3: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user3 = signers[4];
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

  // Each test is started with loadFixture
  // So, there beforeEach/afterEach are not used


//endregion before, after

//region Fixtures
  async function createController(): Promise<ConverterController> {
    return TetuConverterApp.createController(deployer);
  }
  async function deployController(): Promise<string> {
    return CoreContractsHelper.deployController(deployer);
  }
//endregion Fixtures

//region Unit tests
  describe("__Controllable_init", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    it("should revert if governance is zero", async () => {
      const controller = loadFixture(deployController);
      const borrowManager = await CoreContractsHelper.deployBorrowManager(deployer);
      await expect(
        BorrowManager__factory.connect(borrowManager, deployer).init(controller, 0)
      ).revertedWith("Zero governance");
    });
  });

  describe("update implementation", () => {
    describe("Good paths", () => {

      it("should update BorrowManager", async () => {
        const controller = await loadFixture(createController);
        const proxyUpdater = await controller.proxyUpdater();
        const before = await IBorrowManager__factory.connect(await controller.borrowManager(), deployer).platformAdaptersLength();
        const proxyControlled = ProxyControlled__factory.connect(
          await controller.borrowManager(),
          await Misc.impersonate(proxyUpdater)
        );
        const newImplementation = (await DeployUtils.deployContract(deployer, "BorrowManager")).address;
        await proxyControlled.upgrade(newImplementation);

        const after = await IBorrowManager__factory.connect(await controller.borrowManager(), deployer).platformAdaptersLength();
        expect(after.eq(before)).eq(true);
        expect(await BorrowManager__factory.connect(await controller.borrowManager(), deployer).revision()).eq(1);
      });
      it("should update TetuConverter", async () => {
        const controller = await loadFixture(createController);
        const proxyUpdater = await controller.proxyUpdater();
        const before = await TetuConverter__factory.connect(await controller.tetuConverter(), deployer).TETU_CONVERTER_VERSION();
        const proxyControlled = ProxyControlled__factory.connect(
          await controller.tetuConverter(),
          await Misc.impersonate(proxyUpdater)
        );
        const newImplementation = (await DeployUtils.deployContract(deployer, "TetuConverter")).address;
        await proxyControlled.upgrade(newImplementation);

        const after = await TetuConverter__factory.connect(await controller.tetuConverter(), deployer).TETU_CONVERTER_VERSION();
        expect(after).eq(before);
        expect(await TetuConverter__factory.connect(await controller.tetuConverter(), deployer).revision()).eq(1);
      });
      it("should update DebtMonitor", async () => {
        const controller = await loadFixture(createController);
        const proxyUpdater = await controller.proxyUpdater();
        const before = await DebtMonitor__factory.connect(await controller.debtMonitor(), deployer).DEBT_MONITOR_VERSION();
        const proxyControlled = ProxyControlled__factory.connect(
          await controller.debtMonitor(),
          await Misc.impersonate(proxyUpdater)
        );
        const newImplementation = (await DeployUtils.deployContract(deployer, "DebtMonitor")).address;
        await proxyControlled.upgrade(newImplementation);

        const after = await DebtMonitor__factory.connect(await controller.debtMonitor(), deployer).DEBT_MONITOR_VERSION();
        expect(after).eq(before);
        expect(await DebtMonitor__factory.connect(await controller.debtMonitor(), deployer).revision()).eq(1);
      });
      it("should update Keeper", async () => {
        const controller = await loadFixture(createController);
        const proxyUpdater = await controller.proxyUpdater();
        const before = await Keeper__factory.connect(await controller.keeper(), deployer).KEEPER_VERSION();
        const proxyControlled = ProxyControlled__factory.connect(
          await controller.keeper(),
          await Misc.impersonate(proxyUpdater)
        );
        const newImplementation = (await DeployUtils.deployContract(deployer, "Keeper")).address;
        await proxyControlled.upgrade(newImplementation);

        const after = await Keeper__factory.connect(await controller.keeper(), deployer).KEEPER_VERSION();
        expect(after).eq(before);
        expect(await Keeper__factory.connect(await controller.keeper(), deployer).revision()).eq(1);
      });
      it("should update SwapManager", async () => {
        const controller = await loadFixture(createController);
        const proxyUpdater = await controller.proxyUpdater();
        const before = await SwapManager__factory.connect(await controller.swapManager(), deployer).SWAP_MANAGER_VERSION();
        const proxyControlled = ProxyControlled__factory.connect(
          await controller.swapManager(),
          await Misc.impersonate(proxyUpdater)
        );
        const newImplementation = (await DeployUtils.deployContract(deployer, "SwapManager")).address;
        await proxyControlled.upgrade(newImplementation);

        const after = await SwapManager__factory.connect(await controller.swapManager(), deployer).SWAP_MANAGER_VERSION();
        expect(after).eq(before);
        expect(await SwapManager__factory.connect(await controller.swapManager(), deployer).revision()).eq(1);
      });
      it("should update ConverterController", async () => {
        const controller = await loadFixture(createController);
        const proxyUpdater = await controller.proxyUpdater();
        const before = await ConverterController__factory.connect(await controller.controller(), deployer).CONVERTER_CONTROLLER_VERSION();
        const proxyControlled = ProxyControlled__factory.connect(controller.address, await Misc.impersonate(proxyUpdater));
        const newImplementation = (await DeployUtils.deployContract(deployer, "ConverterController")).address;
        await proxyControlled.upgrade(newImplementation);

        const after = await ConverterController__factory.connect(await controller.controller(), deployer).CONVERTER_CONTROLLER_VERSION();
        expect(after).eq(before);
        expect(await ConverterController__factory.connect(await controller.controller(), deployer).revision()).eq(1);
      });
    });

    describe("Bad paths", () => {
      it("should revert if new implementation is zero", async () => {
        const controller = await loadFixture(createController);
        const proxyUpdater = await controller.proxyUpdater();
        const proxyControlled = ProxyControlled__factory.connect(
          await controller.borrowManager(),
          await Misc.impersonate(proxyUpdater)
        );
        await expect(proxyControlled.upgrade(Misc.ZERO_ADDRESS)).reverted;
      });
      it("should revert if not proxy-updater", async () => {
        const controller = await loadFixture(createController);
        const notProxyUpdater = ethers.Wallet.createRandom().address;
        const proxyControlled = ProxyControlled__factory.connect(
          await controller.borrowManager(),
          await Misc.impersonate(notProxyUpdater)
        );
        const newImplementation = (await DeployUtils.deployContract(deployer, "BorrowManager")).address;
        await expect(proxyControlled.upgrade(newImplementation)).revertedWith("Proxy: Forbidden");
      });
      it("should revert if BorrowManager is updated with wrong implementation by mistake", async () => {
        const controller = await loadFixture(createController);
        const proxyUpdater = await controller.proxyUpdater();
        const proxyControlled = ProxyControlled__factory.connect(
          await controller.borrowManager(),
          await Misc.impersonate(proxyUpdater)
        );
        const newImplementation = (await DeployUtils.deployContract(deployer, "PriceOracle", MaticAddresses.AAVE_V3_PRICE_ORACLE)).address; // (!)
        await expect(proxyControlled.upgrade(newImplementation)).reverted;
      });
    });
  });

  describe("isController", () => {
    it("should return expected values", async () => {
      const controller = await loadFixture(createController);
      expect(await controller.isController(await controller.controller())).eq(true);
    });
  });

  describe("isGovernance", () => {
    it("should return true for governance", async () => {
      const controller = await loadFixture(createController);
      expect(await controller.isGovernance(deployer.address)).eq(true);
    });
    it("should return true false for not governance", async () => {
      const controller = await loadFixture(createController);
      expect(await controller.isGovernance(user3.address)).eq(false);
    });
  });

  describe("revision", () => {
    it("should return expected values", async () => {
      const controller = await loadFixture(createController);
      expect(await controller.revision()).eq(0);
    });
    it("should be incremented after update", async () => {
      const controller = await loadFixture(createController);
      const proxyUpdater = await controller.proxyUpdater();
      const before = (await controller.revision()).toNumber();
      const proxyControlled = ProxyControlled__factory.connect(controller.address, await Misc.impersonate(proxyUpdater));
      const newImplementation = (await DeployUtils.deployContract(deployer, "ConverterController")).address;
      await proxyControlled.upgrade(newImplementation);

      const after = (await controller.revision()).toNumber();
      expect(before + 1).eq(after);
    });
  });

  describe("previousImplementation", () => {
    it("should return expected values", async () => {
      const controller = await loadFixture(createController);
      const proxyUpdater = await controller.proxyUpdater();
      const before = await controller.previousImplementation();
      const proxyControlled = ProxyControlled__factory.connect(controller.address, await Misc.impersonate(proxyUpdater));
      const newImplementation = (await DeployUtils.deployContract(deployer, "ConverterController")).address;
      await proxyControlled.upgrade(newImplementation);
      const after = await controller.previousImplementation();

      expect(before).not.eq(after);
    });
  });

  describe("createdBlock", () => {
    it("should return not zero", async () => {
      const controller = await loadFixture(createController);
      expect((await controller.createdBlock()).toNumber()).not.eq(0);
    });
  });

  describe("increaseRevision", () => {
    it("should return not zero", async () => {
      const controller = await loadFixture(createController);
      await expect(
        controller.increaseRevision(Misc.ZERO_ADDRESS)
      ).revertedWith("Increase revision forbidden");
    });
  });

  describe("implementation", () => {
    it("should return expected values", async () => {
      const controller = await loadFixture(createController);
      const proxyUpdater = await controller.proxyUpdater();
      const proxyControlled = ProxyControlled__factory.connect(controller.address, await Misc.impersonate(proxyUpdater));
      expect(await proxyControlled.implementation()).not.eq(Misc.ZERO_ADDRESS);
    });
  });
//endregion Unit tests
});
