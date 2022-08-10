import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
    Controller,
    DebtMonitor,
    DebtMonitor__factory,
    IPoolAdapter,
    IPoolAdapter__factory,
    MockERC20, MockERC20__factory, PoolAdapterMock,
    PoolAdapterMock__factory, PriceOracleMock, PriceOracleMock__factory, UserBorrowRepayUCs
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BorrowManagerHelper, IBmInputParams} from "../baseUT/BorrowManagerHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {CoreContractsHelper} from "../baseUT/CoreContractsHelper";
import {IPooAdapterStabInitParams, MocksHelper} from "../baseUT/MocksHelper";
import {Misc} from "../../scripts/utils/Misc";
import {CoreContracts} from "../baseUT/CoreContracts";

describe("DebtsMonitor", () => {
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
    async function makeBorrow(
        userTC: string,
        pool: string,
        poolAdapterAddress: string,
        sourceToken: MockERC20,
        targetToken: MockERC20,
        amountBorrowLiquidityInPool: BigNumber,
        amountCollateral: BigNumber,
        amountToBorrow: BigNumber
    ) {
        // get data from the pool adapter
        const pa: IPoolAdapter = IPoolAdapter__factory.connect(
            poolAdapterAddress, await DeployerUtils.startImpersonate(userTC)
        );

        // prepare initial balances
        await targetToken.mint(pool, amountBorrowLiquidityInPool);
        await sourceToken.mint(userTC, amountCollateral);

        // user transfers collateral to pool adapter
        await MockERC20__factory.connect(sourceToken.address, await DeployerUtils.startImpersonate(userTC))
            .transfer(pa.address, amountCollateral);

        // borrow
        await pa.borrow(amountCollateral, amountToBorrow, userTC);
    }

    async function preparePoolAdapter(
        tt: IBmInputParams
    ) : Promise<{
        userTC: string,
        controller: Controller,
        sourceToken: MockERC20,
        targetToken: MockERC20,
        pool: string,
        cTokenAddress: string,
        poolAdapterMock: PoolAdapterMock
    }> {
        // create template-pool-adapter
        const converter = await MocksHelper.createPoolAdapterMock(deployer);

        // create borrow manager (BM) with single pool and DebtMonitor (DM)
        const {bm, sourceToken, targetToken, pools, controller}
            = await BorrowManagerHelper.createBmTwoUnderlines(deployer, tt, converter.address);
        const dm = await CoreContractsHelper.createDebtMonitor(deployer, controller);
        await controller.assignBatch(
            [await controller.debtMonitorKey(), await controller.borrowManagerKey()]
            , [dm.address, bm.address]
        );

        // register pool adapter
        const pool = pools[0].pool;
        const cTokenAddress = pools[0].underlineTocTokens.get(sourceToken.address) || "";
        const userTC = ethers.Wallet.createRandom().address;
        const collateral = sourceToken.address;
        await bm.registerPoolAdapter(converter.address, userTC, collateral, targetToken.address);

        // pool adapter is a copy of templatePoolAdapter, created using minimal-proxy pattern
        // this is a mock, we need to configure it
        const poolAdapterAddress = await bm.getPoolAdapter(converter.address, userTC, collateral, targetToken.address);
        const poolAdapterMock = await PoolAdapterMock__factory.connect(poolAdapterAddress, deployer);

        return {
            userTC, controller, sourceToken, targetToken, pool, cTokenAddress, poolAdapterMock
        }
    }

    async function prepareContracts(
        tt: IBmInputParams,
        user: string,
        borrowRatePerBlock18: BigNumber
    ) : Promise<{
        core: CoreContracts,
        pool: string,
        cToken: string,
        userContract: UserBorrowRepayUCs,
        sourceToken: MockERC20,
        targetToken: MockERC20,
        poolAdapter: string
    }>{
        const converter = await MocksHelper.createPoolAdapterMock(deployer);

        const {bm, sourceToken, targetToken, pools, controller}
            = await BorrowManagerHelper.createBmTwoUnderlines(deployer, tt, converter.address);
        const tc = await CoreContractsHelper.createTetuConverter(deployer, controller);
        const dm = await CoreContractsHelper.createDebtMonitor(deployer, controller);
        await controller.assignBatch(
            [await controller.tetuConverterKey(), await controller.debtMonitorKey()]
            , [tc.address, dm.address]
        );

        const core = new CoreContracts(controller, tc, bm, dm);

        const pool = pools[0].pool;
        const cToken = pools[0].underlineTocTokens.get(sourceToken.address) || "";
        const userContract = await MocksHelper.deployUserBorrowRepayUCs(user, core.controller);

        // we need to set up a pool adapter
        await core.bm.registerPoolAdapter(
            converter.address,
            userContract.address,
            sourceToken.address,
            targetToken.address
        );
        const poolAdapter: string = await core.bm.getPoolAdapter(
            converter.address,
            userContract.address,
            sourceToken.address,
            targetToken.address
        );
        const poolAdapterMock = PoolAdapterMock__factory.connect(poolAdapter, deployer);
            // cToken,
            // getBigNumberFrom(tt.targetCollateralFactor*10, 17),
            // borrowRatePerBlock18
        console.log("poolAdapter-mock is configured:", poolAdapter, targetToken.address);

        return {core,  pool, cToken, userContract, sourceToken, targetToken, poolAdapter};
    }


//endregion Utils

//region Unit tests
    describe("onOpenPosition", () => {
        describe("Good paths", () => {
            describe("Single borrow", () => {
                it("should set expected state", async () => {
                    const user = ethers.Wallet.createRandom().address;
                    const targetDecimals = 12;
                    const sourceDecimals = 24;
                    const availableBorrowLiquidityNumber = 200_000_000;
                    const borrowRatePerBlock18 = getBigNumberFrom(1);
                    const tt: IBmInputParams = {
                        collateralFactor: 0.8,
                        priceSourceUSD: 0.1,
                        priceTargetUSD: 4,
                        sourceDecimals: sourceDecimals,
                        targetDecimals: targetDecimals,
                        availablePools: [
                            {   // source, target
                                borrowRateInTokens: [
                                    getBigNumberFrom(0, targetDecimals),
                                    getBigNumberFrom(1, targetDecimals - 6), //1e-6
                                ],
                                availableLiquidityInTokens: [0, availableBorrowLiquidityNumber]
                            }
                        ]
                    };

                    const {core,  pool, cToken, userContract, sourceToken, targetToken, poolAdapter} =
                        await prepareContracts(tt, user, borrowRatePerBlock18);

                    const dmAsPa = DebtMonitor__factory.connect(core.dm.address
                        , await DeployerUtils.startImpersonate(poolAdapter)
                    );

                    const before = [
                        await dmAsPa.poolAdaptersLength(userContract.address
                            , sourceToken.address
                            , targetToken.address
                        ),
                        await dmAsPa.positionsLength(),
                        await dmAsPa.positionsRegistered(poolAdapter)
                    ];

                    await dmAsPa.onOpenPosition();

                    const after = [
                        await dmAsPa.poolAdaptersLength(userContract.address
                            , sourceToken.address
                            , targetToken.address
                        ),
                        await dmAsPa.positionsLength(),
                        await dmAsPa.positionsRegistered(poolAdapter)
                    ];

                    const ret = [...before, ...after].join("\n");

                    const expected = [
                        //before
                        0, 0, false,
                        //after
                        1, 1, true
                    ].join("\n");

                    expect(ret).equal(expected);
                });
            });
            describe("Two borrows, same borrowed token", () => {
                it("should combine two borrows to single amount", async () => {
                    expect.fail("TODO");
                });
            });
            describe("Two borrows, different borrowed tokens", () => {
                it("should set DM to expected state", async () => {
                    expect.fail("TODO");
                });
            });
            describe("Two pool adapters, each makes two borrows with different borrowed tokens", () => {
                it("should set DM to expected state", async () => {
                    expect.fail("TODO");
                });
            });
        });
        describe("Bad paths", () => {
            describe("Wrong pool address", () => {
                it("should revert with template contract not found", async () => {
                    expect.fail("TODO");
                });
            });
        });
    });

    describe("onClosePosition", () => {
        describe("Good paths", () => {
            describe("Single borrow, single repay", () => {
                it("should set expected state", async () => {
                    const user = ethers.Wallet.createRandom().address;
                    const targetDecimals = 12;
                    const sourceDecimals = 24;
                    const availableBorrowLiquidityNumber = 200_000_000;
                    const borrowRatePerBlock18 = getBigNumberFrom(1);
                    const tt: IBmInputParams = {
                        collateralFactor: 0.8,
                        priceSourceUSD: 0.1,
                        priceTargetUSD: 4,
                        sourceDecimals: sourceDecimals,
                        targetDecimals: targetDecimals,
                        availablePools: [
                            {   // source, target
                                borrowRateInTokens: [
                                    getBigNumberFrom(0, targetDecimals),
                                    getBigNumberFrom(1, targetDecimals - 6), //1e-6
                                ],
                                availableLiquidityInTokens: [0, availableBorrowLiquidityNumber]
                            }
                        ]
                    };

                    const {core,  pool, cToken, userContract, sourceToken, targetToken, poolAdapter} =
                        await prepareContracts(tt, user, borrowRatePerBlock18);

                    const dmAsPa = DebtMonitor__factory.connect(core.dm.address
                        , await DeployerUtils.startImpersonate(poolAdapter)
                    );

                    const before = [
                        await dmAsPa.poolAdaptersLength(userContract.address
                            , sourceToken.address
                            , targetToken.address
                        ),
                        await dmAsPa.positionsLength(),
                        await dmAsPa.positionsRegistered(poolAdapter)
                    ];

                    await dmAsPa.onOpenPosition();
                    const afterBorrow = [
                        await dmAsPa.poolAdaptersLength(userContract.address
                            , sourceToken.address
                            , targetToken.address
                        ),
                        await dmAsPa.positionsLength(),
                        await dmAsPa.positionsRegistered(poolAdapter)
                    ];

                    await dmAsPa.onClosePosition();

                    const afterRepay = [
                        await dmAsPa.poolAdaptersLength(userContract.address
                            , sourceToken.address
                            , targetToken.address
                        ),
                        await dmAsPa.positionsLength(),
                        await dmAsPa.positionsRegistered(poolAdapter)
                    ];

                    const ret = [...before, ...afterBorrow, ...afterRepay].join("\n");

                    const expected = [
                        //before
                        0, 0, false,
                        //after
                        1, 1, true,
                        //before
                        0, 0, false,
                    ].join("\n");

                    expect(ret).equal(expected);
                });
            });
            describe("Two borrows, same borrowed token", () => {
                describe("Repay single borrow only", () => {
                    it("should combine two borrows to single amount", async () => {
                        expect.fail("TODO");
                    });
                });
            });
            describe("Two borrows, different borrowed tokens", () => {
                describe("Repay first borrow only", () => {
                    it("should set DM to expected state", async () => {
                        expect.fail("TODO");
                    });
                });
                describe("Repay second borrow only", () => {
                    it("should set DM to expected state", async () => {
                        expect.fail("TODO");
                    });
                });
            });

        });
        describe("Bad paths", () => {
            it("should TODO", async () => {
                expect.fail("TODO");
            });
        });
    });

    describe("findBorrows", () => {
        describe("Good paths", () => {
            it("should TODO", async () => {
                expect.fail("TODO");
            });
        });
        describe("Bad paths", () => {
            it("should TODO", async () => {
                expect.fail("TODO");
            });
        });
    });

    describe("getUnhealthyTokens", () => {

        interface OldNewValue {
            initial: number;
            updated: number;
        }

        interface TestParams {
            amountCollateral: number;
            sourceDecimals: number;
            targetDecimals: number;
            amountToBorrow: number;
            priceSourceUSD: OldNewValue;
            priceTargetUSD: OldNewValue;
            collateralFactor: OldNewValue;
            countPassedBlocks: number;
            borrowRate: number; // i.e. 1e-18
        }

        async function prepareTest(
            pp: TestParams
        ) : Promise<{
            dm: DebtMonitor,
            poolAdapterMock: PoolAdapterMock,
            sourceToken: MockERC20,
            targetToken: MockERC20,
            userTC: string,
            controller: Controller,
            pool: string,
            cTokenAddress: string,
        }> {
            const tt: IBmInputParams = {
                collateralFactor: pp.collateralFactor.initial,
                priceSourceUSD: pp.priceSourceUSD.initial,
                priceTargetUSD: pp.priceTargetUSD.initial,
                sourceDecimals: pp.sourceDecimals,
                targetDecimals: pp.targetDecimals,
                availablePools: [{
                    borrowRateInTokens: [0, getBigNumberFrom(1e18*pp.borrowRate)],
                    availableLiquidityInTokens: [0, 200_000]
                }]
            };

            const amountBorrowLiquidityInPool = getBigNumberFrom(1e10, tt.targetDecimals);

            const {userTC, controller, sourceToken, targetToken, pool, cTokenAddress, poolAdapterMock} =
                await preparePoolAdapter(tt);

            const dm = DebtMonitor__factory.connect(await controller.debtMonitor(), deployer);

                // cTokenAddress,
                // collateralFactor18,
                // getBigNumberFrom(1e18*pp.borrowRate)

            await makeBorrow(
                userTC,
                pool,
                poolAdapterMock.address,
                sourceToken,
                targetToken,
                amountBorrowLiquidityInPool,
                getBigNumberFrom(pp.amountCollateral, tt.sourceDecimals),
                getBigNumberFrom(pp.amountToBorrow, tt.targetDecimals)
            );

            const pam: PoolAdapterMock = PoolAdapterMock__factory.connect(poolAdapterMock.address
                , deployer);
            if (pp.collateralFactor.initial != pp.collateralFactor.updated) {
                await pam.changeCollateralFactor(getBigNumberFrom(pp.collateralFactor.updated * 10, 17));
                console.log("Collateral factor is changed from", pp.collateralFactor.initial
                    , "to", pp.collateralFactor.updated);
            }

            await pam.setPassedBlocks(pp.countPassedBlocks);

            const priceOracle: PriceOracleMock = PriceOracleMock__factory.connect(
                await poolAdapterMock.priceOracle()
                , deployer
            );
            await priceOracle.changePrices(
                [sourceToken.address, targetToken.address],
                [
                    getBigNumberFrom(pp.priceSourceUSD.updated * 10, 17)
                    , getBigNumberFrom(pp.priceTargetUSD.updated * 10, 17)
                ]
            );

            return {dm, poolAdapterMock, sourceToken, targetToken, userTC, controller, pool, cTokenAddress};
        }
        describe("Good paths", () => {
            describe("Single borrowed token", () => {
                describe("The token is healthy", () => {
                    describe("Health factor > min", () => {
                        it("should return empty", async () => {
                            const index = 0;
                            const count = 100; // find all pools
                            const minAllowedHealthFactor = 2.0;

                            const pp: TestParams = {
                                amountCollateral:  10_000
                                , sourceDecimals: 6
                                , targetDecimals: 24
                                , amountToBorrow: 1000
                                , priceSourceUSD: {initial: 1, updated: 1}
                                , priceTargetUSD: {initial: 2, updated: 2}
                                , collateralFactor: {initial: 0.5, updated: 0.5}
                                , countPassedBlocks: 0 // no debts
                                , borrowRate: 1e-10
                            }
                            const {dm} = await prepareTest(pp);

                            const expectedHealthFactor =
                                pp.collateralFactor.updated
                                * pp.priceSourceUSD.updated * pp.amountCollateral
                                / (pp.priceTargetUSD.updated * pp.amountToBorrow + pp.borrowRate * pp.countPassedBlocks);
                            console.log("Expected healthy factor", expectedHealthFactor);

                            const ret = await dm.findUnhealthyPositions(index, count, count
                                , getBigNumberFrom(minAllowedHealthFactor * 10, 17)
                            );
                            const retPoolAdapters: string[] = ret.countFoundItems.toNumber()
                                ? ret.outPoolAdapters.slice(0, ret.countFoundItems.toNumber())
                                : [];

                            const sret = [
                                ret.nextIndexToCheck0.toNumber(),
                                ret.countFoundItems.toNumber(),
                                retPoolAdapters,
                                expectedHealthFactor > minAllowedHealthFactor
                            ].join();

                            const sexpected = [
                                0,
                                0,
                                [],
                                true
                            ].join();

                            expect(sret).equal(sexpected);
                        });
                    });
                    describe("Health factor == min", () => {
                        it("should return empty", async () => {
                            const index = 0;
                            const count = 100; // find all pools
                            const minAllowedHealthFactor = 2.5;

                            const pp: TestParams = {
                                amountCollateral:  10_000
                                , sourceDecimals: 6
                                , targetDecimals: 24
                                , amountToBorrow: 1000
                                , priceSourceUSD: {initial: 1, updated: 1}
                                , priceTargetUSD: {initial: 2, updated: 2}
                                , collateralFactor: {initial: 0.5, updated: 0.5}
                                , countPassedBlocks: 0 // no debts
                                , borrowRate: 1e-10
                            }
                            const {dm} = await prepareTest(pp);

                            const expectedHealthFactor =
                                pp.collateralFactor.updated
                                * pp.priceSourceUSD.updated * pp.amountCollateral
                                / (pp.priceTargetUSD.updated * pp.amountToBorrow + pp.borrowRate * pp.countPassedBlocks);
                            console.log("Expected healthy factor", expectedHealthFactor);

                            const ret = await dm.findUnhealthyPositions(index, count, count
                                , getBigNumberFrom(minAllowedHealthFactor * 10, 17)
                            );

                            const retPoolAdapters: string[] = ret.countFoundItems.toNumber()
                                ? ret.outPoolAdapters.slice(0, ret.countFoundItems.toNumber())
                                : [];
                            const sret = [
                                ret.nextIndexToCheck0.toNumber(),
                                ret.countFoundItems.toNumber(),
                                retPoolAdapters,
                                expectedHealthFactor == minAllowedHealthFactor
                            ].join();

                            const sexpected = [
                                0,
                                0,
                                [],
                                true
                            ].join();

                            expect(sret).equal(sexpected);
                        });
                    });
                });
                describe("The token is unhealthy", () => {
                    describe("Collateral factor is too high", () => {
                        it("should return the token", async () => {
                            const index = 0;
                            const count = 100; // find all pools
                            const minAllowedHealthFactor = 2.5;

                            const pp: TestParams = {
                                amountCollateral:  10_000
                                , sourceDecimals: 6
                                , targetDecimals: 24
                                , amountToBorrow: 1000
                                , priceSourceUSD: {initial: 1, updated: 1}
                                , priceTargetUSD: {initial: 2, updated: 2}
                                , collateralFactor: {
                                    initial: 0.5
                                    , updated: 0.3  // (!) changed
                                }
                                , countPassedBlocks: 0 // no debts
                                , borrowRate: 1e-10
                            }
                            const {dm, poolAdapterMock, sourceToken, targetToken} = await prepareTest(pp);

                            const expectedHealthFactor =
                                pp.collateralFactor.updated
                                * pp.priceSourceUSD.updated * pp.amountCollateral
                                / (pp.priceTargetUSD.updated * pp.amountToBorrow + pp.borrowRate * pp.countPassedBlocks);
                            console.log("Expected healthy factor", expectedHealthFactor);

                            const ret = await dm.findUnhealthyPositions(index, count, count
                                , getBigNumberFrom(minAllowedHealthFactor * 10, 17)
                            );

                            const retPoolAdapters: string[] = ret.countFoundItems.toNumber()
                                ? ret.outPoolAdapters.slice(0, ret.countFoundItems.toNumber())
                                : [];

                            const sret = [
                                ret.nextIndexToCheck0.toNumber(),
                                ret.countFoundItems.toNumber(),
                                retPoolAdapters,
                                expectedHealthFactor < minAllowedHealthFactor
                            ].join();

                            const sexpected = [
                                0,
                                1,
                                [poolAdapterMock.address],
                                true
                            ].join();

                            expect(sret).equal(sexpected);
                        });
                    });
                    describe("Collateral is too cheap", () => {
                        it("should return the token", async () => {
                            expect.fail("TODO");
                        });
                    });
                    describe("Borrowed token is too expensive", () => {
                        it("should return the token", async () => {
                            expect.fail("TODO");
                        });
                    });
                    describe("Debt is too high", () => {
                        it("should return the token", async () => {
                            expect.fail("TODO");
                        });
                    });
                });
            });
            describe("Multiple borrowed tokens", () => {
                describe("All tokens are healthy", () => {
                    describe("Tokens have different decimals", () => {
                        it("should return empty", async () => {
                            expect.fail("TODO");
                        });
                    });
                });
                describe("All tokens are unhealthy", () => {
                    describe("Tokens have different decimals", () => {
                        it("should return all tokens", async () => {
                            expect.fail("TODO");
                        });
                    });
                });
                describe("First token is unhealthy", () => {
                    it("should return first token only", async () => {
                        expect.fail("TODO");
                    });
                });
                describe("Last token is unhealthy", () => {
                    it("should return last token only", async () => {
                        expect.fail("TODO");
                    });
                });

            });
        });
        describe("Bad paths", () => {
            describe("Unknown pool adapter", () => {
                it("should revert", async () => {
                    expect.fail("TODO");
                });
            });
            describe("Price oracle returns zero price", () => {
                it("should revert", async () => {
                    expect.fail("TODO");
                });
            });
        });
    });

    describe("findFirstUnhealthyPoolAdapter", () => {
        describe("Good paths", () => {
            describe("All pool adapters are in good state", () => {
                it("should return no pool adapters ", async () => {
                    expect.fail("TODO");
                });
            });
            describe("Single unhealthy PA", () => {
                describe("Single unhealthy borrowed token", () => {
                    it("should TODO", async () => {
                        expect.fail("TODO");
                    });
                });
                describe("Multiple unhealthy borrowed tokens", () => {
                    describe("Multiple calls of findFirst", () => {
                        it("should return all unhealthy pool adapters", async () => {
                            expect.fail("TODO");
                        });
                    });
                });
            });

            describe("First pool adapter is unhealthy", () => {
                it("should TODO", async () => {
                    expect.fail("TODO");
                });
            });
            describe("Last pool adapter is unhealthy", () => {
                it("should TODO", async () => {
                    expect.fail("TODO");
                });
            });

        });
        describe("Bad paths", () => {
            it("should TODO", async () => {
                expect.fail("TODO");
            });
        });
    });

    describe("getCountActivePoolAdapters", () => {
        describe("Good paths", () => {
            it("should TODO", async () => {
                expect.fail("TODO");
            });
        });
        describe("Bad paths", () => {
            it("should TODO", async () => {
                expect.fail("TODO");
            });
        });
    });
//endregion Unit tests

});