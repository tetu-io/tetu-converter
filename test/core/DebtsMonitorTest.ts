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
    PoolAdapterMock__factory
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BorrowManagerHelper, IBmInputParams} from "../baseUT/BorrowManagerHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {CoreContractsHelper} from "../baseUT/CoreContractsHelper";
import {MocksHelper} from "../baseUT/MocksHelper";
import {Misc} from "../../scripts/utils/Misc";

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
    /** Create pool adapters (PA), initialize BM, create DM, connect to DM using first PA */
    async function getDmAsFirstPA(...poolAdapters: string[]) : Promise<DebtMonitor> {
        const controller = await CoreContractsHelper.createControllerWithPrices(deployer);
        const dm = await CoreContractsHelper.createDebtMonitor(deployer, controller);

        const bm = await MocksHelper.createBorrowManagerMock(deployer
            , poolAdapters
            , poolAdapters.map(x => ethers.Wallet.createRandom().address)
            , poolAdapters.map(x => ethers.Wallet.createRandom().address)
            , poolAdapters.map(x => ethers.Wallet.createRandom().address)
        );
        await controller.assignBatch(
            [await controller.borrowManagerKey()]
            , [bm.address]
        );
        const dmAsPA = DebtMonitor__factory.connect(
            dm.address,
            await DeployerUtils.startImpersonate(poolAdapters[0])
        );

        return dmAsPA;
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
        const templatePoolAdapter = await MocksHelper.createPoolAdapterMock(deployer);

        // create borrow manager (BM) with single pool and DebtMonitor (DM)
        const {bm, sourceToken, targetToken, pools, controller}
            = await BorrowManagerHelper.createBmTwoUnderlines(deployer, tt, templatePoolAdapter.address);
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
        await bm.registerPoolAdapter(pool, userTC, collateral);

        // pool adapter is a copy of templatePoolAdapter, created using minimal-proxy pattern
        // this is a mock, we need to configure it
        const poolAdapterAddress = await bm.getPoolAdapter(pool, userTC, collateral);
        const poolAdapterMock = await PoolAdapterMock__factory.connect(poolAdapterAddress, deployer);

        return {
            userTC, controller, sourceToken, targetToken, pool, cTokenAddress, poolAdapterMock
        }
    }

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
        await pa.borrow(amountCollateral, targetToken.address, amountToBorrow, userTC);
    }


//endregion Utils

//region Unit tests
    describe("onBorrow", () => {
        describe("Good paths", () => {
            describe("Single borrow", () => {
                it("should set expected state", async () => {
                    const cToken = ethers.Wallet.createRandom().address;
                    const borrowedToken = ethers.Wallet.createRandom().address;
                    const user = ethers.Wallet.createRandom().address;
                    const poolAdapter = (await MocksHelper.createPoolAdapterStab(deployer
                        , BigNumber.from(1)
                        , {
                            pool: ethers.Wallet.createRandom().address,
                            user: user,
                            collateralUnderline: ethers.Wallet.createRandom().address
                        }
                    )).address;
                    const amountCTokens = getBigNumberFrom(999);

                    const dmAsPa = await getDmAsFirstPA(poolAdapter);

                    const before = [
                        await dmAsPa.poolAdaptersLength(),
                        (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken)).toString(),
                        await dmAsPa.borrowedTokensLength(poolAdapter),
                        await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                        await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken),
                        await dmAsPa.userToAdaptersLength(user),
                    ];

                    await dmAsPa.onBorrow(cToken, amountCTokens, borrowedToken);

                    const after = [
                        await dmAsPa.poolAdapters(0),
                        await dmAsPa.poolAdaptersLength(),
                        (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken)).toString(),
                        await dmAsPa.borrowedTokensLength(poolAdapter),
                        await dmAsPa.borrowedTokens(poolAdapter, 0),
                        await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                        await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken),
                        await dmAsPa.userToAdaptersLength(user),
                        await dmAsPa.userToAdapters(user, 0)
                    ];

                    const ret = [...before, ...after].join("\n");

                    const expected = [
                        //before
                        0, 0, 0, Misc.ZERO_ADDRESS, false, 0,
                        //after
                        poolAdapter
                        , 1
                        , amountCTokens //TODO: exchange rate?
                        , 1
                        , borrowedToken
                        , cToken
                        , true
                        , 1
                        , poolAdapter
                    ].join("\n");

                    expect(ret).equal(expected);
                });
            });
            describe("Two borrows, same borrowed token", () => {
                it("should combine two borrows to single amount", async () => {
                    const cToken = ethers.Wallet.createRandom().address;
                    const borrowedToken = ethers.Wallet.createRandom().address;
                    const amountCTokens1 = getBigNumberFrom(999);
                    const amountCTokens2 = getBigNumberFrom(777);
                    const user = ethers.Wallet.createRandom().address;
                    const poolAdapter = (await MocksHelper.createPoolAdapterStab(deployer
                        , BigNumber.from(1)
                        , {
                            pool: ethers.Wallet.createRandom().address,
                            user: user,
                            collateralUnderline: ethers.Wallet.createRandom().address
                        }
                    )).address;


                    const dmAsPa = await getDmAsFirstPA(poolAdapter);

                    const before = [
                        await dmAsPa.poolAdaptersLength(),
                        (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken)).toString(),
                        await dmAsPa.borrowedTokensLength(poolAdapter),
                        await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                        await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken),
                        await dmAsPa.userToAdaptersLength(user),
                    ];

                    // make two borrows one by one
                    await dmAsPa.onBorrow(cToken, amountCTokens1, borrowedToken);
                    await dmAsPa.onBorrow(cToken, amountCTokens2, borrowedToken);

                    const after = [
                        await dmAsPa.poolAdapters(0),
                        await dmAsPa.poolAdaptersLength(),
                        (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken)).toString(),
                        await dmAsPa.borrowedTokensLength(poolAdapter),
                        await dmAsPa.borrowedTokens(poolAdapter, 0),
                        await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                        await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken),
                        await dmAsPa.userToAdaptersLength(user),
                        await dmAsPa.userToAdapters(user, 0)
                    ];

                    const ret = [...before, ...after].join("\n");

                    const expected = [
                        //before
                        0, 0, 0, Misc.ZERO_ADDRESS, false, 0,
                        //after
                        poolAdapter
                        , 1
                        , amountCTokens1.add(amountCTokens2)
                        , 1
                        , borrowedToken
                        , cToken
                        , true
                        , 1
                        , poolAdapter
                    ].join("\n");

                    expect(ret).equal(expected);
                });
            });
            describe("Two borrows, different borrowed tokens", () => {
                it("should set DM to expected state", async () => {
                    const cToken = ethers.Wallet.createRandom().address;
                    const borrowedToken1 = ethers.Wallet.createRandom().address;
                    const borrowedToken2 = ethers.Wallet.createRandom().address;
                    const amountCTokens1 = getBigNumberFrom(999);
                    const amountCTokens2 = getBigNumberFrom(777);
                    const user = ethers.Wallet.createRandom().address;
                    const poolAdapter = (await MocksHelper.createPoolAdapterStab(deployer
                        , BigNumber.from(1)
                        , {
                            pool: ethers.Wallet.createRandom().address,
                            user: user,
                            collateralUnderline: ethers.Wallet.createRandom().address
                        }
                    )).address;

                    const dmAsPa = await getDmAsFirstPA(poolAdapter);

                    const before = [
                        await dmAsPa.poolAdaptersLength(),
                        (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken1)).toString(),
                        (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken2)).toString(),
                        await dmAsPa.borrowedTokensLength(poolAdapter),
                        await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                        await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken1),
                        await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken2),
                        await dmAsPa.userToAdaptersLength(user),
                    ];

                    // make two borrows one by one
                    await dmAsPa.onBorrow(cToken, amountCTokens1, borrowedToken1);
                    await dmAsPa.onBorrow(cToken, amountCTokens2, borrowedToken2);

                    const after = [
                        await dmAsPa.poolAdapters(0),
                        await dmAsPa.poolAdaptersLength(),
                        (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken1)).toString(),
                        (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken2)).toString(),
                        await dmAsPa.borrowedTokensLength(poolAdapter),
                        await dmAsPa.borrowedTokens(poolAdapter, 0),
                        await dmAsPa.borrowedTokens(poolAdapter, 1),
                        await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                        await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken1),
                        await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken2),
                        await dmAsPa.userToAdaptersLength(user),
                        await dmAsPa.userToAdapters(user, 0)
                    ];

                    const ret = [...before, ...after].join("\n");

                    const expected = [
                        //before
                        0, 0, 0, 0, Misc.ZERO_ADDRESS, false, false, 0,
                        //after
                        poolAdapter
                        , 1
                        , amountCTokens1
                        , amountCTokens2
                        , 2
                        , borrowedToken1
                        , borrowedToken2
                        , cToken
                        , true
                        , true
                        , 1
                        , poolAdapter
                    ].join("\n");

                    expect(ret).equal(expected);
                });
            });
            describe("Two pool adapters, each makes two borrows with different borrowed tokens", () => {
                it("should set DM to expected state", async () => {
                    const cToken = ethers.Wallet.createRandom().address;
                    const borrowedToken11 = ethers.Wallet.createRandom().address;
                    const borrowedToken12 = ethers.Wallet.createRandom().address;
                    const borrowedToken21 = ethers.Wallet.createRandom().address;
                    const borrowedToken22 = ethers.Wallet.createRandom().address;
                    const amountCTokens11 = getBigNumberFrom(999);
                    const amountCTokens12 = getBigNumberFrom(777);
                    const amountCTokens21 = getBigNumberFrom(4147);
                    const amountCTokens22 = getBigNumberFrom(1313);
                    const user = ethers.Wallet.createRandom().address;
                    const poolAdapter1 = (await MocksHelper.createPoolAdapterStab(deployer
                        , BigNumber.from(1)
                        , {
                            pool: ethers.Wallet.createRandom().address,
                            user: user,
                            collateralUnderline: ethers.Wallet.createRandom().address
                        }
                    )).address;
                    const poolAdapter2 = (await MocksHelper.createPoolAdapterStab(deployer
                        , BigNumber.from(1)
                        , {
                            pool: ethers.Wallet.createRandom().address,
                            user: user,
                            collateralUnderline: ethers.Wallet.createRandom().address
                        }
                    )).address;

                    const dmAsPa1 = await getDmAsFirstPA(poolAdapter1, poolAdapter2);
                    const dmAsPa2 = DebtMonitor__factory.connect(
                        dmAsPa1.address
                        , await DeployerUtils.startImpersonate(poolAdapter2)
                    );

                    const before = [
                        //PA1
                        await dmAsPa1.poolAdaptersLength(),
                        (await dmAsPa1.activeCollaterals(poolAdapter1, borrowedToken11)).toString(),
                        (await dmAsPa1.activeCollaterals(poolAdapter1, borrowedToken12)).toString(),
                        await dmAsPa1.borrowedTokensLength(poolAdapter1),
                        await dmAsPa1.cTokensForPoolAdapters(poolAdapter1),
                        await dmAsPa1.registeredBorrowTokens(poolAdapter1, borrowedToken11),
                        await dmAsPa1.registeredBorrowTokens(poolAdapter1, borrowedToken12),
                        //PA2
                        await dmAsPa2.poolAdaptersLength(),
                        (await dmAsPa2.activeCollaterals(poolAdapter2, borrowedToken21)).toString(),
                        (await dmAsPa2.activeCollaterals(poolAdapter2, borrowedToken22)).toString(),
                        await dmAsPa2.borrowedTokensLength(poolAdapter2),
                        await dmAsPa2.cTokensForPoolAdapters(poolAdapter2),
                        await dmAsPa2.registeredBorrowTokens(poolAdapter2, borrowedToken21),
                        await dmAsPa2.registeredBorrowTokens(poolAdapter2, borrowedToken22),

                        await dmAsPa1.userToAdaptersLength(user),
                    ];

                    // each PA makes 2 borrows
                    await dmAsPa1.onBorrow(cToken, amountCTokens11, borrowedToken11);
                    await dmAsPa2.onBorrow(cToken, amountCTokens21, borrowedToken21);
                    await dmAsPa2.onBorrow(cToken, amountCTokens22, borrowedToken22);
                    await dmAsPa1.onBorrow(cToken, amountCTokens12, borrowedToken12);

                    const after = [
                        // PA1
                        await dmAsPa1.poolAdapters(0),
                        await dmAsPa1.poolAdaptersLength(),
                        (await dmAsPa1.activeCollaterals(poolAdapter1, borrowedToken11)).toString(),
                        (await dmAsPa1.activeCollaterals(poolAdapter1, borrowedToken12)).toString(),
                        await dmAsPa1.borrowedTokensLength(poolAdapter1),
                        await dmAsPa1.borrowedTokens(poolAdapter1, 0),
                        await dmAsPa1.borrowedTokens(poolAdapter1, 1),
                        await dmAsPa1.cTokensForPoolAdapters(poolAdapter1),
                        await dmAsPa1.registeredBorrowTokens(poolAdapter1, borrowedToken11),
                        await dmAsPa1.registeredBorrowTokens(poolAdapter1, borrowedToken12),
                        // PA2
                        await dmAsPa2.poolAdapters(1),
                        await dmAsPa2.poolAdaptersLength(),
                        (await dmAsPa2.activeCollaterals(poolAdapter2, borrowedToken21)).toString(),
                        (await dmAsPa2.activeCollaterals(poolAdapter2, borrowedToken22)).toString(),
                        await dmAsPa2.borrowedTokensLength(poolAdapter2),
                        await dmAsPa2.borrowedTokens(poolAdapter2, 0),
                        await dmAsPa2.borrowedTokens(poolAdapter2, 1),
                        await dmAsPa2.cTokensForPoolAdapters(poolAdapter2),
                        await dmAsPa2.registeredBorrowTokens(poolAdapter2, borrowedToken21),
                        await dmAsPa2.registeredBorrowTokens(poolAdapter2, borrowedToken22),

                        await dmAsPa1.userToAdaptersLength(user),
                        await dmAsPa1.userToAdapters(user, 0),
                        await dmAsPa1.userToAdapters(user, 1),
                    ];

                    const ret = [...before, ...after].join("\n");

                    const expected = [
                        //before
                        0, 0, 0, 0, Misc.ZERO_ADDRESS, false, false,
                        0, 0, 0, 0, Misc.ZERO_ADDRESS, false, false,
                        0,
                        //after, PA1
                        poolAdapter1
                        , 2
                        , amountCTokens11
                        , amountCTokens12
                        , 2
                        , borrowedToken11
                        , borrowedToken12
                        , cToken
                        , true
                        , true
                        //after, PA2
                        , poolAdapter2
                        , 2
                        , amountCTokens21
                        , amountCTokens22
                        , 2
                        , borrowedToken21
                        , borrowedToken22
                        , cToken
                        , true
                        , true

                        , 2
                        , poolAdapter1
                        , poolAdapter2
                    ].join("\n");

                    expect(ret).equal(expected);
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

    describe("onRepay", () => {
        describe("Good paths", () => {
            describe("Single borrow, single repay", () => {
                it("should set expected state", async () => {
                    const cToken = ethers.Wallet.createRandom().address;
                    const borrowedToken = ethers.Wallet.createRandom().address;
                    const user = ethers.Wallet.createRandom().address;
                    const poolAdapter = (await MocksHelper.createPoolAdapterStab(deployer
                        , BigNumber.from(1)
                        , {
                            pool: ethers.Wallet.createRandom().address,
                            user: user,
                            collateralUnderline: ethers.Wallet.createRandom().address
                        }
                    )).address;
                    const amountCTokens = getBigNumberFrom(999);

                    const dmAsPa = await getDmAsFirstPA(poolAdapter);

                    await dmAsPa.onBorrow(cToken, amountCTokens, borrowedToken);

                    const before = [
                        await dmAsPa.poolAdapters(0),
                        await dmAsPa.poolAdaptersLength(),
                        (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken)).toString(),
                        await dmAsPa.borrowedTokensLength(poolAdapter),
                        await dmAsPa.borrowedTokens(poolAdapter, 0),
                        await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                        await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken),
                        await dmAsPa.userToAdaptersLength(user),
                        await dmAsPa.userToAdapters(user, 0),
                    ];

                    await dmAsPa.onRepay(cToken, amountCTokens, borrowedToken);

                    const after = [
                        await dmAsPa.poolAdaptersLength(),
                        (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken)).toString(),
                        await dmAsPa.borrowedTokensLength(poolAdapter),
                        await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                        await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken),
                        await dmAsPa.userToAdaptersLength(user),
                    ];

                    const ret = [...before, ...after].join("\n");

                    const expected = [
                        //before
                        poolAdapter
                        , 1
                        , amountCTokens //TODO: exchange rate?
                        , 1
                        , borrowedToken
                        , cToken
                        , true
                        , 1, poolAdapter,
                        //after
                        0, 0, 0, Misc.ZERO_ADDRESS, false, 0
                    ].join("\n");

                    expect(ret).equal(expected);
                });
            });
            describe("Two borrows, same borrowed token", () => {
                describe("Repay single borrow only", () => {
                    it("should combine two borrows to single amount", async () => {
                        const cToken = ethers.Wallet.createRandom().address;
                        const borrowedToken = ethers.Wallet.createRandom().address;

                        const user = ethers.Wallet.createRandom().address;
                        const poolAdapter = (await MocksHelper.createPoolAdapterStab(deployer
                            , BigNumber.from(1)
                            , {
                                pool: ethers.Wallet.createRandom().address,
                                user: user,
                                collateralUnderline: ethers.Wallet.createRandom().address
                            }
                        )).address;

                        const amountCTokens1 = getBigNumberFrom(999);
                        const amountCTokens2 = getBigNumberFrom(777);

                        const dmAsPa = await getDmAsFirstPA(poolAdapter);

                        // make two borrows one by one
                        await dmAsPa.onBorrow(cToken, amountCTokens1, borrowedToken);
                        await dmAsPa.onBorrow(cToken, amountCTokens2, borrowedToken);

                        const before = [
                            await dmAsPa.poolAdapters(0),
                            await dmAsPa.poolAdaptersLength(),
                            (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken)).toString(),
                            await dmAsPa.borrowedTokensLength(poolAdapter),
                            await dmAsPa.borrowedTokens(poolAdapter, 0),
                            await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                            await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken),
                            await dmAsPa.userToAdaptersLength(user),
                            await dmAsPa.userToAdapters(user, 0),
                        ];

                        // repay borrow 1 only
                        await dmAsPa.onRepay(cToken, amountCTokens1, borrowedToken);

                        const after = [
                            await dmAsPa.poolAdapters(0),
                            await dmAsPa.poolAdaptersLength(),
                            (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken)).toString(),
                            await dmAsPa.borrowedTokensLength(poolAdapter),
                            await dmAsPa.borrowedTokens(poolAdapter, 0),
                            await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                            await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken),
                            await dmAsPa.userToAdaptersLength(user),
                            await dmAsPa.userToAdapters(user, 0),
                        ];

                        const ret = [...before, ...after].join("\n");

                        const expected = [
                            //before
                            poolAdapter
                            , 1
                            , amountCTokens1.add(amountCTokens2)
                            , 1
                            , borrowedToken
                            , cToken
                            , true
                            , 1
                            , poolAdapter
                            //after
                            , poolAdapter
                            , 1
                            , amountCTokens2
                            , 1
                            , borrowedToken
                            , cToken
                            , true
                            , 1
                            , poolAdapter
                        ].join("\n");

                        expect(ret).equal(expected);
                    });
                });
            });
            describe("Two borrows, different borrowed tokens", () => {
                describe("Repay first borrow only", () => {
                    it("should set DM to expected state", async () => {
                        const cToken = ethers.Wallet.createRandom().address;
                        const borrowedToken1 = ethers.Wallet.createRandom().address;
                        const borrowedToken2 = ethers.Wallet.createRandom().address;
                        const user = ethers.Wallet.createRandom().address;
                        const poolAdapter = (await MocksHelper.createPoolAdapterStab(deployer
                            , BigNumber.from(1)
                            , {
                                pool: ethers.Wallet.createRandom().address,
                                user: user,
                                collateralUnderline: ethers.Wallet.createRandom().address
                            }
                        )).address;
                        const amountCTokens1 = getBigNumberFrom(999);
                        const amountCTokens2 = getBigNumberFrom(777);

                        const dmAsPa = await getDmAsFirstPA(poolAdapter);

                        // make two borrows one by one
                        await dmAsPa.onBorrow(cToken, amountCTokens1, borrowedToken1);
                        await dmAsPa.onBorrow(cToken, amountCTokens2, borrowedToken2);

                        const before = [
                            await dmAsPa.poolAdapters(0),
                            await dmAsPa.poolAdaptersLength(),
                            (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken1)).toString(),
                            (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken2)).toString(),
                            await dmAsPa.borrowedTokensLength(poolAdapter),
                            await dmAsPa.borrowedTokens(poolAdapter, 0),
                            await dmAsPa.borrowedTokens(poolAdapter, 1),
                            await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                            await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken1),
                            await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken2),
                            await dmAsPa.userToAdaptersLength(user),
                            await dmAsPa.userToAdapters(user, 0),
                        ];

                        // repay second borrow only
                        await dmAsPa.onRepay(cToken, amountCTokens1, borrowedToken1);

                        const after = [
                            await dmAsPa.poolAdapters(0),
                            await dmAsPa.poolAdaptersLength(),
                            (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken1)).toString(),
                            (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken2)).toString(),
                            await dmAsPa.borrowedTokensLength(poolAdapter),
                            await dmAsPa.borrowedTokens(poolAdapter, 0),
                            await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                            await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken1),
                            await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken2),
                            await dmAsPa.userToAdaptersLength(user),
                            await dmAsPa.userToAdapters(user, 0),
                        ];
                        const ret = [...before, ...after].join("\n");

                        const expected = [
                            //before
                            poolAdapter
                            , 1
                            , amountCTokens1
                            , amountCTokens2
                            , 2
                            , borrowedToken1
                            , borrowedToken2
                            , cToken
                            , true
                            , true
                            , 1
                            , poolAdapter
                            //after
                            , poolAdapter
                            , 1
                            , 0
                            , amountCTokens2
                            , 1
                            , borrowedToken2
                            , cToken
                            , false
                            , true
                            , 1
                            , poolAdapter
                        ].join("\n");

                        expect(ret).equal(expected);
                    });
                });
                describe("Repay second borrow only", () => {
                    it("should set DM to expected state", async () => {
                        const cToken = ethers.Wallet.createRandom().address;
                        const borrowedToken1 = ethers.Wallet.createRandom().address;
                        const borrowedToken2 = ethers.Wallet.createRandom().address;
                        const user = ethers.Wallet.createRandom().address;
                        const poolAdapter = (await MocksHelper.createPoolAdapterStab(deployer
                            , BigNumber.from(1)
                            , {
                                pool: ethers.Wallet.createRandom().address,
                                user: user,
                                collateralUnderline: ethers.Wallet.createRandom().address
                            }
                        )).address;
                        const amountCTokens1 = getBigNumberFrom(999);
                        const amountCTokens2 = getBigNumberFrom(777);

                        const dmAsPa = await getDmAsFirstPA(poolAdapter);

                        // make two borrows one by one
                        await dmAsPa.onBorrow(cToken, amountCTokens1, borrowedToken1);
                        await dmAsPa.onBorrow(cToken, amountCTokens2, borrowedToken2);

                        const before = [
                            await dmAsPa.poolAdapters(0),
                            await dmAsPa.poolAdaptersLength(),
                            (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken1)).toString(),
                            (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken2)).toString(),
                            await dmAsPa.borrowedTokensLength(poolAdapter),
                            await dmAsPa.borrowedTokens(poolAdapter, 0),
                            await dmAsPa.borrowedTokens(poolAdapter, 1),
                            await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                            await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken1),
                            await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken2),
                            await dmAsPa.userToAdaptersLength(user),
                            await dmAsPa.userToAdapters(user, 0),
                        ];

                        // repay second borrow only
                        await dmAsPa.onRepay(cToken, amountCTokens2, borrowedToken2);

                        const after = [
                            await dmAsPa.poolAdapters(0),
                            await dmAsPa.poolAdaptersLength(),
                            (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken1)).toString(),
                            (await dmAsPa.activeCollaterals(poolAdapter, borrowedToken2)).toString(),
                            await dmAsPa.borrowedTokensLength(poolAdapter),
                            await dmAsPa.borrowedTokens(poolAdapter, 0),
                            await dmAsPa.cTokensForPoolAdapters(poolAdapter),
                            await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken1),
                            await dmAsPa.registeredBorrowTokens(poolAdapter, borrowedToken2),
                            await dmAsPa.userToAdaptersLength(user),
                            await dmAsPa.userToAdapters(user, 0),
                        ];
                        const ret = [...before, ...after].join("\n");

                        const expected = [
                            //before
                            poolAdapter
                            , 1
                            , amountCTokens1
                            , amountCTokens2
                            , 2
                            , borrowedToken1
                            , borrowedToken2
                            , cToken
                            , true
                            , true
                            , 1
                            , poolAdapter
                            //after
                            , poolAdapter
                            , 1
                            , amountCTokens1
                            , 0
                            , 1
                            , borrowedToken1
                            , cToken
                            , true
                            , false
                            , 1
                            , poolAdapter
                        ].join("\n");

                        expect(ret).equal(expected);
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

    describe("onRepayBehalf", () => {
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
        describe("Good paths", () => {
            describe("Single borrowed token", () => {
                describe("The token is healthy", () => {
                    describe("Health factor == min", () => {
                        it("should return empty", async () => {
                            const priceSourceUSD = 0.1;
                            const priceTargetUSD = 2;
                            const collateralFactor18 = getBigNumberFrom(5, 17); // 0.5
                            const borrowRatePerBlock18 = getBigNumberFrom(1, 10); // 0.01

                            const tt: IBmInputParams = {
                                targetCollateralFactor: 0.8,
                                priceSourceUSD: priceSourceUSD || 0.1,
                                priceTargetUSD: priceTargetUSD || 4,
                                sourceDecimals: 24,
                                targetDecimals: 12,
                                availablePools: [
                                    {   // source, target
                                        borrowRateInTokens: [0, borrowRatePerBlock18],
                                        availableLiquidityInTokens: [0, 200_000]
                                    }
                                ]
                            };

                            const amountBorrowLiquidityInPool = getBigNumberFrom(1e10, tt.targetDecimals);
                            const amountCollateral = getBigNumberFrom(10000, tt.sourceDecimals);
                            const amountToBorrow = getBigNumberFrom(100, tt.targetDecimals);

                            const {userTC, controller, sourceToken, targetToken, pool, cTokenAddress, poolAdapterMock} =
                                await preparePoolAdapter(tt);

                            await poolAdapterMock.setUpMock(
                                cTokenAddress,
                                await controller.priceOracle(),
                                await controller.debtMonitor(),
                                collateralFactor18,
                                [targetToken.address],
                                [borrowRatePerBlock18]
                            );

                            await makeBorrow(
                                userTC,
                                pool,
                                poolAdapterMock.address,
                                sourceToken,
                                targetToken,
                                amountBorrowLiquidityInPool,
                                amountCollateral,
                                amountToBorrow
                            );

                            expect.fail("TODO");
                        });
                    });
                    describe("Health factor > min", () => {
                        it("should return empty", async () => {
                            expect.fail("TODO");
                        });
                    });
                });
                describe("The token is unhealthy", () => {
                    describe("Collateral factor is too low", () => {
                        it("should return the token", async () => {
                            expect.fail("TODO");
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