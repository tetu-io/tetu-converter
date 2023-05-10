import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {expect} from "chai";
import {
  BorrowManager__factory,
  ConverterController,
  ConverterController__factory,
  DebtMonitor__factory,
  IBorrowManager__factory,
  IConverterController__factory,
  ITetuConverter__factory,
  Keeper__factory,
  ProxyControlled__factory, SwapManager__factory,
  TetuConverter__factory
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {controlGasLimitsEx, getGasUsed} from "../../scripts/utils/hardhatUtils";
import {GAS_LIMIT_CONTROLLER_INITIALIZE} from "../baseUT/GasLimit";
import {Misc} from "../../scripts/utils/Misc";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {randomInt} from "crypto";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";

/**
 * Most proxy contracts are proxy-contracts, that can be updated by proxy-updater only.
 * Proxy updater is tetu-contracts-v2 controller, that uses update with announce.
 */
describe("ProxyTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
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

  beforeEach(async function () {
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
  });
//endregion before, after

//region Unit tests
  describe("update implementation", () => {
    describe("Good paths", () => {
      it("should update BorrowManager", async () => {
        const controller = await TetuConverterApp.createController(deployer);
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
      });
      it("should update TetuConverter", async () => {
        const controller = await TetuConverterApp.createController(deployer);
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
      });
      it("should update DebtMonitor", async () => {
        const controller = await TetuConverterApp.createController(deployer);
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
      });
      it("should update Keeper", async () => {
        const controller = await TetuConverterApp.createController(deployer);
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
      });
      it("should update SwapManager", async () => {
        const controller = await TetuConverterApp.createController(deployer);
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
      });
      it("should update ConverterController", async () => {
        const controller = await TetuConverterApp.createController(deployer);
        const proxyUpdater = await controller.proxyUpdater();
        const before = await ConverterController__factory.connect(await controller.controller(), deployer).CONVERTER_CONTROLLER_VERSION();
        const proxyControlled = ProxyControlled__factory.connect(
          await controller.swapManager(),
          await Misc.impersonate(proxyUpdater)
        );
        const newImplementation = (await DeployUtils.deployContract(deployer, "ConverterController")).address;
        await proxyControlled.upgrade(newImplementation);

        const after = await ConverterController__factory.connect(await controller.controller(), deployer).CONVERTER_CONTROLLER_VERSION();
        expect(after).eq(before);
      });
    });

    describe("Bad paths", () => {
      it("should revert if new implementation is zero", async () => {
        const controller = await TetuConverterApp.createController(deployer);
        const proxyUpdater = await controller.proxyUpdater();
        const proxyControlled = ProxyControlled__factory.connect(
          await controller.borrowManager(),
          await Misc.impersonate(proxyUpdater)
        );
        await expect(proxyControlled.upgrade(Misc.ZERO_ADDRESS)).reverted;
      });
      it("should revert if not proxy-updater", async () => {
        const controller = await TetuConverterApp.createController(deployer);
        const notProxyUpdater = ethers.Wallet.createRandom().address;
        const proxyControlled = ProxyControlled__factory.connect(
          await controller.borrowManager(),
          await Misc.impersonate(notProxyUpdater)
        );
        const newImplementation = (await DeployUtils.deployContract(deployer, "BorrowManager")).address;
        await expect(proxyControlled.upgrade(newImplementation)).revertedWith("Proxy: Forbidden");
      });
      it("should revert if BorrowManager is updated with wrong implementation by mistake", async () => {
        const controller = await TetuConverterApp.createController(deployer);
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
//endregion Unit tests
});
