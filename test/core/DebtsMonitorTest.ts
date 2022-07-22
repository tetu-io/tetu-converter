import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {DebtMonitor, DebtMonitor__factory, IPoolAdapter, IPoolAdapter__factory} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BorrowManagerHelper} from "../baseUT/BorrowManagerHelper";
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

    describe("findFirst", () => {
        describe("Good paths", () => {
            describe("All pool adapters are in good state", () => {
                it("should TODO", async () => {
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
                    describe("First borrowed tokens is unhealthy", () => {
                        it("should TODO", async () => {
                            expect.fail("TODO");
                        });
                    });
                    describe("Last borrowed tokens is unhealthy", () => {
                        it("should TODO", async () => {
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