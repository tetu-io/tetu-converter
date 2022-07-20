import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {Controller, Controller__factory} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {controlGasLimitsEx, getGasUsed} from "../../scripts/utils/hardhatUtils";
import {GAS_LIMIT_CONTROLLER_BATCH_ASSIGN, GAS_LIMIT_CONTROLLER_INITIALIZE} from "../baseUT/GasLimit";
import {describe} from "mocha";
import {Misc} from "../../scripts/utils/Misc";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";

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
        priceOracle: string;
        tetuConverter: string;
        borrowManager: string;
        debtMonitor: string;

        borrower: string;
    }

    async function getKeysArray(controller: Controller) : Promise<string[]> {
        return [
            await controller.governanceKey()

            , await controller.priceOracleKey()
            , await controller.tetuConverterKey()
            , await controller.borrowManagerKey()
            , await controller.debtMonitorKey()

            , await controller.borrowerKey()
        ];
    }

    function getAddressesArray(a: IControllerAddresses): string[] {
        return [
            a.governance

            , a.priceOracle
            , a.tetuConverter
            , a.borrowManager
            , a.debtMonitor

            , a.borrower
        ];
    }

    async function getValuesArray(controller: Controller) : Promise<string[]> {
        return [
            await controller.governance()

            , await controller.priceOracle()
            , await controller.tetuConverter()
            , await controller.borrowManager()
            , await controller.debtMonitor()

            , await controller.borrower()
        ];
    }

    async function createTestController(
        a: IControllerAddresses
    ) : Promise<{
        controller: Controller
        , gasUsed: BigNumber
    }> {
        let controller = (await DeployUtils.deployContract(deployer, 'Controller')) as Controller;
        const r = await getGasUsed(controller.initialize(
            await getKeysArray(controller)
            , getAddressesArray(a)
        ));

        return {controller, gasUsed: r};
    }

    function getRandomControllerAddresses() : IControllerAddresses {
        return {
            governance: ethers.Wallet.createRandom().address,

            priceOracle: ethers.Wallet.createRandom().address,
            tetuConverter: ethers.Wallet.createRandom().address,
            borrowManager: ethers.Wallet.createRandom().address,
            debtMonitor: ethers.Wallet.createRandom().address,

            borrower: ethers.Wallet.createRandom().address,
        }
    }
//endregion Utils

//region Unit tests
    describe ("initialize", () => {
        describe ("Good paths", () => {
            it("should initialize addresses correctly", async () => {
                const a = getRandomControllerAddresses();

                const {controller, gasUsed} = await createTestController(a);

                const ret = (await getValuesArray(controller)).join();
                const expected = getAddressesArray(a).join();

                expect(ret).to.be.equal(expected);
                controlGasLimitsEx(gasUsed, GAS_LIMIT_CONTROLLER_INITIALIZE, (u, t) => {
                    expect(u).to.be.below(t);
                });
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
                        ).revertedWith("zero address");
                    }
                });
            });
        });
    });

    describe ("assignBatch", () => {
        describe ("Good paths", () => {
            it("should initialize addresses correctly", async () => {
                const initialAddresses = getRandomControllerAddresses();
                const updatedAddresses = getRandomControllerAddresses();

                const {controller} = await createTestController(initialAddresses);
                const controllerAsGov = Controller__factory.connect(
                    controller.address
                    , await DeployerUtils.startImpersonate(initialAddresses.governance)
                );
                const gasUsed = await getGasUsed(controllerAsGov.assignBatch(
                    await getKeysArray(controller)
                    , getAddressesArray(updatedAddresses))
                );

                const ret = (await getValuesArray(controller)).join();
                const expected = getAddressesArray(updatedAddresses).join();

                expect(ret).to.be.equal(expected);
                controlGasLimitsEx(gasUsed, GAS_LIMIT_CONTROLLER_BATCH_ASSIGN, (u, t) => {
                    expect(u).to.be.below(t);
                });
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
                        const updatedAddresses = getRandomControllerAddresses();

                        // let's set one of address to 0

                        // @ts-ignore
                        updatedAddresses[key] = Misc.ZERO_ADDRESS;

                        await expect(
                            controllerAsGov.assignBatch(
                                await getKeysArray(controller)
                                , getAddressesArray(updatedAddresses)
                            )
                        ).revertedWith("zero address");
                    }
                });
            });
        });
    });
//endregion Unit tests

});