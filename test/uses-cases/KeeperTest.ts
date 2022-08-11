import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {expect} from "chai";
import {Keeper} from "../baseUT/keeper/Keeper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {MockPlatformFabric} from "../baseUT/fabrics/MockPlatformFabric";
import {BigNumber} from "ethers";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {BorrowRepayUsesCase} from "../baseUT/BorrowRepayUsesCase";
import {BorrowAction} from "../baseUT/actions/BorrowAction";
import {TokenDataTypes} from "../baseUT/types/TokenDataTypes";
import {Borrower, Controller, IDebtMonitor__factory, ITetuConverter, PoolAdapterMock__factory} from "../../typechain";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";
import {ReConverterMock} from "../baseUT/keeper/ReСonverters";
import {LendingPlatformManagerMock} from "../baseUT/keeper/LendingPlatformManagerMock";
import {PoolAdapterState01} from "../baseUT/keeper/ILendingPlatformManager";
import {MockTestInputParams, TestSingleBorrowParams} from "../baseUT/types/BorrowRepayDataTypes";

describe("Keeper test", () => {
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

//region Tests implementations
    /**
     * @returns Array of too booleans:
     * - keeper has called a reconversion BEFORE modification of the platform state
     * - keeper has called a reconversion AFTER state modification
     */
    async function makeSingleBorrow_Mock (
        p: TestSingleBorrowParams,
        m: MockTestInputParams
    ) : Promise<{uc: Borrower, tc: ITetuConverter, controller: Controller, poolAdapter: string}> {
        const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
        const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

        const underlines = [p.collateral.asset, p.borrow.asset];
        const pricesUSD = [1, 1];
        const cTokenDecimals = [m.collateral.decimals, m.borrow.decimals];
        const cTokens = await MocksHelper.createCTokensMocks(deployer, cTokenDecimals, underlines);

        const fabric = new MockPlatformFabric(
            underlines,
            [m.collateral.borrowRate, m.borrow.borrowRate],
            [m.collateral.collateralFactor, m.borrow.collateralFactor],
            [m.collateral.liquidity, m.borrow.liquidity],
            [p.collateral.holder, p.borrow.holder],
            cTokens,
            pricesUSD.map((x, index) => BigNumber.from(10)
                .pow(18 - 2)
                .mul(x * 100))
        );
        const {tc, controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
        const uc: Borrower = await MocksHelper.deployBorrower(deployer.address
            , controller
            , p.healthFactor2
            , p.countBlocks
        );
        const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);
        const poolAdapters = await uc.getBorrows(collateralToken.address, borrowToken.address);
        const poolAdapter = poolAdapters[0];

        // make borrow only
        const {
            userBalances,
            borrowBalances
        } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer
            , uc
            , [
                new BorrowAction(
                    collateralToken
                    , collateralAmount
                    , borrowToken
                )
            ]
        );

        return {uc, tc, controller, poolAdapter};
    }
//endregion Tests implementations

//region Unit tests
    describe("Health checking", async () => {
        describe("Good paths", () => {
            describe("Health factor becomes below allowed minimum", () => {
                describe("DAI => USDC", () => {
                    const ASSET_COLLATERAL = MaticAddresses.DAI;
                    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
                    const ASSET_BORROW = MaticAddresses.USDC;
                    const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
                    const AMOUNT_COLLATERAL = 1_000;
                    const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
                    const INITIAL_LIQUIDITY_BORROW = 80_000;
                    const HEALTH_FACTOR2 = 200;
                    const COUNT_BLOCKS = 1;

                    async function makeTestForReconversionCall_Mock(
                        platformStateModifierFabric: (
                            uc: Borrower, tc: ITetuConverter, controller: Controller, poolAdapter: string
                        ) => Promise<PoolAdapterState01>
                    ): Promise<boolean[]> {
                        // make a borrow
                        const {uc, tc, controller, poolAdapter} = await makeSingleBorrow_Mock(
                            {
                                collateral: {
                                    asset: ASSET_COLLATERAL,
                                    holder: HOLDER_COLLATERAL,
                                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                                }, borrow: {
                                    asset: ASSET_BORROW,
                                    holder: HOLDER_BORROW,
                                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                                }, collateralAmount: AMOUNT_COLLATERAL
                                , healthFactor2: HEALTH_FACTOR2
                                , countBlocks: COUNT_BLOCKS
                            }, {
                                collateral: {
                                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 2
                                    , collateralFactor: 0.5
                                    , borrowRate: getBigNumberFrom(1, 10)
                                    , decimals: 6
                                }, borrow: {
                                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 2
                                    , collateralFactor: 0.8
                                    , borrowRate: getBigNumberFrom(1, 8)
                                    , decimals: 24
                                }
                            }
                        );

                        // let's call keeper job twice: before and after modification of the platform state
                        const dest: boolean[] = [];
                        for (let i = 0; i < 2; ++i) {
                            // run a keeper
                            const reconverter = new ReConverterMock();
                            const keeper: Keeper = new Keeper(
                                IDebtMonitor__factory.connect(await controller.debtMonitor(), deployer)
                                , HEALTH_FACTOR2
                                , COUNT_BLOCKS
                                , reconverter
                            );
                            await keeper.makeKeeperJob(deployer);

                            // ensure that re-conversion was called for the given poolAdapter
                            dest.push(reconverter.ensureExpectedPA(poolAdapter));

                            // modify platform state
                            await platformStateModifierFabric(uc, tc, controller, poolAdapter);
                        }

                        return dest;
                    }

                    describe("Mock", () => {
                        describe("Collateral factor is decreased to 100", () => {
                            it("should call reconvert", async () => {
                                if (!await isPolygonForkInUse()) return;

                                const modifier = async (
                                    uc: Borrower
                                    , tc: ITetuConverter
                                    , controller: Controller
                                    , poolAdapter: string
                                ) => {
                                    const m = new LendingPlatformManagerMock(
                                        PoolAdapterMock__factory.connect(poolAdapter, deployer)
                                    );
                                    return m.changeCollateralFactor(deployer, 100);
                                };
                                const ret = await makeTestForReconversionCall_Mock(modifier);
                                const expected = [false, true];

                                const sret = ret.join("\n");
                                const sexpected = expected.join("\n");

                                expect(sret).equal(sexpected);
                            });
                        });
                        describe("Collateral price is decreased 10 times", () => {
                            it("should call reconvert", async () => {
                                if (!await isPolygonForkInUse()) return;

                                const modifier = async (
                                    uc: Borrower
                                    , tc: ITetuConverter
                                    , controller: Controller
                                    , poolAdapter: string
                                ) => {
                                    const m = new LendingPlatformManagerMock(
                                        PoolAdapterMock__factory.connect(poolAdapter, deployer)
                                    );
                                    return m.changeAssetPrice(deployer, ASSET_COLLATERAL, false, 10);
                                };
                                const ret = await makeTestForReconversionCall_Mock(modifier);
                                const expected = [false, true];

                                const sret = ret.join("\n");
                                const sexpected = expected.join("\n");

                                expect(sret).equal(sexpected);
                            });
                        });
                        describe("Collateral price is increased 10 times", () => {
                            it("should call reconvert", async () => {
                                if (!await isPolygonForkInUse()) return;

                                const modifier = async (
                                    uc: Borrower
                                    , tc: ITetuConverter
                                    , controller: Controller
                                    , poolAdapter: string
                                ) => {
                                    const m = new LendingPlatformManagerMock(
                                        PoolAdapterMock__factory.connect(poolAdapter, deployer)
                                    );
                                    return m.changeAssetPrice(deployer, ASSET_BORROW, true, 10);
                                };
                                const ret = await makeTestForReconversionCall_Mock(modifier);
                                const expected = [false, true];

                                const sret = ret.join("\n");
                                const sexpected = expected.join("\n");

                                expect(sret).equal(sexpected);
                            });
                        });
                        describe("Increase borrow rate significantly", () => {
                            it("should call reconvert", async () => {
                                if (!await isPolygonForkInUse()) return;

                                const modifier = async (
                                    uc: Borrower
                                    , tc: ITetuConverter
                                    , controller: Controller
                                    , poolAdapter: string
                                ) => {
                                    const m = new LendingPlatformManagerMock(
                                        PoolAdapterMock__factory.connect(poolAdapter, deployer)
                                    );
                                    return m.makeMaxBorrow(deployer);
                                };
                                const ret = await makeTestForReconversionCall_Mock(modifier);
                                const expected = [false, true];

                                const sret = ret.join("\n");
                                const sexpected = expected.join("\n");

                                expect(sret).equal(sexpected);
                            });
                        });
                    });

                    describe("AAVE3", () => {
                        describe("Collateral price is decreased", () => {
                            it("should call reconvert", async () => {
                                expect.fail("TODO");
                            });
                        });
                        describe("Borrow price is increased", () => {
                            it("should call reconvert", async () => {
                                expect.fail("TODO");
                            });
                        });
                    });
                });
            });
        });
    });

    describe("Better converting way checking", async () => {
        describe("Good paths", () => {
            describe("Single borrow, single instant complete repay", () => {
                it("", async() => {
                    expect.fail("TODO");
                });
            });
        });
    });

//endregion Unit tests
});