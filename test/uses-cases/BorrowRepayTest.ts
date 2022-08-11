import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
    BorrowManager__factory,
    IERC20__factory, IPlatformAdapter__factory
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {BalanceUtils, IUserBalances} from "../baseUT/utils/BalanceUtils";
import {TokenWrapper} from "../baseUT/helpers/TokenWrapper";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {BorrowRepayUsesCase} from "../baseUT/uses-cases/BorrowRepayUsesCase";
import {BorrowAction} from "../baseUT/actions/BorrowAction";
import {RepayAction} from "../baseUT/actions/RepayAction";
import {MockPlatformFabric} from "../baseUT/fabrics/MockPlatformFabric";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";
import {HundredFinancePlatformFabric} from "../baseUT/fabrics/HundredFinancePlatformFabric";
import {DForcePlatformFabric} from "../baseUT/fabrics/DForcePlatformFabric";
import {BorrowMockAction} from "../baseUT/actions/BorrowMockAction";
import {RepayMockAction} from "../baseUT/actions/RepayMockAction";
import {AaveTwoPlatformFabric} from "../baseUT/fabrics/AaveTwoPlatformFabric";
import {
    GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_AAVE3,
    GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_AAVE_TWO,
    GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_DFORCE,
    GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_HUNDRED_FINANCE
} from "../baseUT/GasLimit";
import {controlGasLimitsEx} from "../../scripts/utils/hardhatUtils";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {ILendingPlatformFabric} from "../baseUT/fabrics/ILendingPlatformFabric";

describe("BorrowRepayTest", () => {
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
    async function setInitialBalance(
        asset: string,
        holder: string,
        amount: number,
        recipient: string
    ) : Promise<BigNumber> {
        await BalanceUtils.getAmountFromHolder(asset, holder, recipient, amount);
        return IERC20__factory.connect(asset, deployer).balanceOf(recipient);
    }

    /// @param accuracy 10 for 1e-10
    function areAlmostEqual(b1: BigNumber, b2: BigNumber, accuracy: number = 8) : boolean {
        const n18 = getBigNumberFrom(1, accuracy);
        console.log("approx1", b1, b2);
        console.log("approx2", b1.sub(b2));
        console.log("approx3", b1.sub(b2).mul(n18).div(b1).abs());
        console.log("approx4", b1.sub(b2).mul(n18).div(b1).abs().mul(accuracy));
        console.log("approx5", b1.sub(b2).mul(n18).div(b1).abs().mul(accuracy).toNumber());
        return b1.sub(b2).mul(n18).div(b1).abs().mul(accuracy).toNumber() == 0;
    }

    function getSingleBorrowSingleRepayResults(
        c0: BigNumber,
        b0: BigNumber,
        collateralAmount: BigNumber,
        userBalances: IUserBalances[],
        borrowBalances: BigNumber[],
        totalBorrowedAmount: BigNumber,
        totalRepaidAmount: BigNumber
    ) : {sret: string, sexpected: string} {
        const sret = [
            // collateral after borrow
            userBalances[0].collateral
            // borrowed amount > 0
            , !totalBorrowedAmount.eq(BigNumber.from(0))
            // contract borrow balance ~ borrowed amount
            , areAlmostEqual(borrowBalances[0], totalBorrowedAmount),

            // after repay
            // collateral >= initial collateral
            userBalances[1].collateral.gt(c0) || areAlmostEqual(userBalances[1].collateral, c0) //TODO: userBalances[1].collateral.gte(c0)
            // borrowed balance <= initial borrowed balance
            , b0.gte(userBalances[1].borrow)
            // contract borrowed balance is 0
            , borrowBalances[1].eq(BigNumber.from(0))

            // paid amount >= borrowed amount
            , totalRepaidAmount.gte(totalBorrowedAmount)
        ].map(x => BalanceUtils.toString(x)).join("\n");

        const sexpected = [
            // collateral after borrow
            c0.sub(collateralAmount)
            // borrowed amount > 0
            , true
            // contract borrow balance ~ borrowed amount
            , true

            //after repay
            // collateral >= initial collateral
            // TODO: aave can keep dust collateral on balance, so we check collateral ~ initial collateral
            , true
            // borrowed balance <= initial borrowed balance
            , true
            // contract borrowed balance is 0
            , true

            // paid amount >= borrowed amount
            , true

        ].map(x => BalanceUtils.toString(x)).join("\n");

        console.log(`after borrow: collateral=${userBalances[0].collateral.toString()} borrow=${userBalances[0].borrow.toString()} borrowBalance=${borrowBalances[0].toString()}`);
        console.log(`after repay: collateral=${userBalances[1].collateral.toString()} borrow=${userBalances[1].borrow.toString()} borrowBalance=${borrowBalances[1].toString()}`);
        console.log(`borrowedAmount: ${totalBorrowedAmount} paidAmount: ${totalRepaidAmount}`);

        return {sret, sexpected};
    }

    function getTwoBorrowsTwoRepaysResults(
        c0: BigNumber,
        b0: BigNumber,
        collateralAmount: BigNumber,
        userBalances: IUserBalances[],
        borrowBalances: BigNumber[],
        totalBorrowedAmount: BigNumber,
        totalRepaidAmount: BigNumber
    ) : {sret: string, sexpected: string} {
        const sret = [
            // collateral after borrow 2
            userBalances[1].collateral
            // borrowed amount > 0
            , !totalBorrowedAmount.eq(BigNumber.from(0))
            // contract borrow balance ~ borrowed amount 1
            , areAlmostEqual(borrowBalances[1], totalBorrowedAmount, 6),

            // after repay
            // collateral >= initial collateral
            userBalances[3].collateral.gt(c0) || areAlmostEqual(userBalances[3].collateral, c0) //TODO: userBalances[1].collateral.gte(c0)
            // borrowed balance <= initial borrowed balance
            , b0.gte(userBalances[3].borrow)
            // contract borrowed balance is 0
            , borrowBalances[3].eq(BigNumber.from(0))

            // paid amount >= borrowed amount
            , totalRepaidAmount.gte(totalBorrowedAmount)
        ].map(x => BalanceUtils.toString(x)).join("\n");

        const sexpected = [
            // collateral after borrow
            c0.sub(collateralAmount)
            // borrowed amount > 0
            , true
            // contract borrow balance ~ borrowed amount
            , true

            //after repay
            // collateral >= initial collateral
            // TODO: aave can keep dust collateral on balance, so we check collateral ~ initial collateral
            , true
            // borrowed balance <= initial borrowed balance
            , true
            // contract borrowed balance is 0
            , true

            // paid amount >= borrowed amount
            , true

        ].map(x => BalanceUtils.toString(x)).join("\n");

        console.log(`after borrow: collateral=${userBalances[1].collateral.toString()} borrow=${userBalances[1].borrow.toString()} borrowBalance=${borrowBalances[1].toString()}`);
        console.log(`after repay: collateral=${userBalances[3].collateral.toString()} borrow=${userBalances[3].borrow.toString()} borrowBalance=${borrowBalances[3].toString()}`);
        console.log(`borrowedAmount: ${totalBorrowedAmount} paidAmount: ${totalRepaidAmount}`);

        return {sret, sexpected};
    }
//endregion Utils

//region Data types
    interface TokenParams {
        asset: string;
        holder: string;
        initialLiquidity: number;
    }

    /** Input params for test: single borrow, single repay*/
    interface TestSingleBorrowParams {
        collateral: TokenParams;
        borrow: TokenParams;
        collateralAmount: number;
        healthFactor2: number;
        countBlocks: number;
    }
    /** Input params for test: two borrows, two repays*/
    interface TestTwoBorrowsParams extends TestSingleBorrowParams {
        collateralAmount2: number;
        repayAmount1: number;
        deltaBlocksBetweenBorrows: number;
        deltaBlocksBetweenRepays: number;
    }

    interface MockCTokenParams {
        decimals: number;
        liquidity: number;
        borrowRate: BigNumber;
        collateralFactor: number;
    }

    interface MockTestInputParams {
        collateral: MockCTokenParams;
        borrow: MockCTokenParams;
    }
//endregion Data types

//region Test single borrow, single repay
    async function makeTestSingleBorrowInstantRepay_Mock(
        p: TestSingleBorrowParams,
        m: MockTestInputParams
    ) : Promise<{sret: string, sexpected: string}> {
        const collateralToken = await TokenWrapper.Build(deployer, p.collateral.asset);
        const borrowToken = await TokenWrapper.Build(deployer, p.borrow.asset);

        const amountToRepay = undefined; //full repay

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
        const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.healthFactor2, p.countBlocks);

        const c0 = await setInitialBalance(collateralToken.address
            , p.collateral.holder, p.collateral.initialLiquidity, uc.address);
        const b0 = await setInitialBalance(borrowToken.address
            , p.borrow.holder, p.borrow.initialLiquidity, uc.address);
        const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

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
                    , p.countBlocks
                    , p.healthFactor2
                ),
                new RepayAction(
                    collateralToken
                    , borrowToken
                    , amountToRepay
                )
            ]
        );

        return getSingleBorrowSingleRepayResults(
            c0
            , b0
            , collateralAmount
            , userBalances
            , borrowBalances
            , await uc.totalBorrowedAmount()
            , await uc.totalRepaidAmount()
        );
    }

    async function makeTestSingleBorrowInstantRepay(
        p: TestSingleBorrowParams,
        fabric: ILendingPlatformFabric,
        checkGasUsed: boolean = false
    ) : Promise<{sret: string, sexpected: string, gasUsed?: BigNumber}> {
        const {tc, controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
        const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.healthFactor2, p.countBlocks);

        const collateralToken = await TokenWrapper.Build(deployer, p.collateral.asset);
        const borrowToken = await TokenWrapper.Build(deployer, p.borrow.asset);

        const amountToRepay = undefined; //full repay

        const c0 = await setInitialBalance(collateralToken.address
            , p.collateral.holder, p.collateral.initialLiquidity, uc.address);
        const b0 = await setInitialBalance(borrowToken.address
            , p.borrow.holder, p.borrow.initialLiquidity, uc.address);
        const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

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
                    , p.countBlocks
                    , p.healthFactor2
                    , undefined
                    , checkGasUsed
                ),
                new RepayAction(
                    collateralToken
                    , borrowToken
                    , amountToRepay
                    , undefined
                    , checkGasUsed
                )
            ]
        );

        const ret = getSingleBorrowSingleRepayResults(
            c0
            , b0
            , collateralAmount
            , userBalances
            , borrowBalances
            , await uc.totalBorrowedAmount()
            , await uc.totalRepaidAmount()
        );

        let gasUsed: BigNumber | undefined;
        if (checkGasUsed) {
            gasUsed = userBalances.reduce(
                (prev, cur) => {
                    if (cur.gasUsed) {
                        return cur.gasUsed.add(prev);
                    } else {
                        throw "gas used is null";
                    }
                }, BigNumber.from(0)
            )
        }

        return {sret: ret.sret, sexpected: ret.sexpected, gasUsed};
    }
//endregion Test single borrow, single repay

//region Test two borrows, two repays
    async function makeTestTwoBorrowsTwoRepays_Mock(
        p: TestTwoBorrowsParams,
        m: MockTestInputParams
    ) : Promise<{sret: string, sexpected: string}> {
        const collateralToken = await TokenWrapper.Build(deployer, p.collateral.asset);
        const borrowToken = await TokenWrapper.Build(deployer, p.borrow.asset);

        const amountToRepay1 = getBigNumberFrom(p.repayAmount1, borrowToken.decimals);
        const amountToRepay2 = undefined; //full repay

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
        const {tc, controller, pools} = await TetuConverterApp.buildApp(deployer, [fabric]);
        const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.healthFactor2, p.countBlocks);

        const c0 = await setInitialBalance(collateralToken.address
            , p.collateral.holder, p.collateral.initialLiquidity, uc.address);
        const b0 = await setInitialBalance(borrowToken.address
            , p.borrow.holder, p.borrow.initialLiquidity, uc.address);

        const collateralAmount1 = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);
        const collateralAmount2 = getBigNumberFrom(p.collateralAmount2, collateralToken.decimals);

        // we need an address of the mock pool adapter, so let's initialize the pool adapter right now
        const bm = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
        const platformAdapter = IPlatformAdapter__factory.connect(await bm.platformAdapters(0), deployer);
        const converter = (await platformAdapter.converters())[0];
        await bm.registerPoolAdapter(converter
            , uc.address
            , collateralToken.address
            , borrowToken.address
        );
        const poolAdapter = await bm.getPoolAdapter(converter
            , uc.address
            , collateralToken.address
            , borrowToken.address
        );

        const {
            userBalances,
            borrowBalances
        } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer
            , uc
            , [
                new BorrowMockAction(
                    collateralToken
                    , collateralAmount1
                    , borrowToken
                    , p.countBlocks
                    , p.healthFactor2
                    , p.deltaBlocksBetweenBorrows
                    , poolAdapter
                ),
                new BorrowMockAction(
                    collateralToken
                    , collateralAmount2
                    , borrowToken
                    , p.countBlocks
                    , p.healthFactor2
                ),
                new RepayMockAction(
                    collateralToken
                    , borrowToken
                    , amountToRepay1
                    , p.deltaBlocksBetweenRepays
                    , poolAdapter
                ),
                new RepayMockAction(
                    collateralToken
                    , borrowToken
                    , amountToRepay2
                ),
            ]
        );

        return getTwoBorrowsTwoRepaysResults(
            c0
            , b0
            , collateralAmount1.add(collateralAmount2)
            , userBalances
            , borrowBalances
            , await uc.totalBorrowedAmount()
            , await uc.totalRepaidAmount()
        );
    }

    async function makeTestTwoBorrowsTwoRepays(
        p: TestTwoBorrowsParams,
        fabric: ILendingPlatformFabric
    ) : Promise<{sret: string, sexpected: string}> {
        const {tc, controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
        const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.healthFactor2, p.countBlocks);

        const collateralToken = await TokenWrapper.Build(deployer, p.collateral.asset);
        const borrowToken = await TokenWrapper.Build(deployer, p.borrow.asset);

        const amountToRepay1 = getBigNumberFrom(p.repayAmount1, borrowToken.decimals);
        const amountToRepay2 = undefined; //full repay

        const c0 = await setInitialBalance(collateralToken.address
            , p.collateral.holder, p.collateral.initialLiquidity, uc.address);
        const b0 = await setInitialBalance(borrowToken.address
            , p.borrow.holder, p.borrow.initialLiquidity, uc.address);

        const collateralAmount1 = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);
        const collateralAmount2 = getBigNumberFrom(p.collateralAmount2, collateralToken.decimals);

        const {
            userBalances,
            borrowBalances
        } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer
            , uc
            , [
                new BorrowAction(
                    collateralToken
                    , collateralAmount1
                    , borrowToken
                    , p.countBlocks
                    , p.healthFactor2
                    , p.deltaBlocksBetweenBorrows
                ),
                new BorrowAction(
                    collateralToken
                    , collateralAmount2
                    , borrowToken
                    , p.countBlocks
                    , p.healthFactor2
                ),
                new RepayAction(
                    collateralToken
                    , borrowToken
                    , amountToRepay1
                    , p.deltaBlocksBetweenRepays
                ),
                new RepayAction(
                    collateralToken
                    , borrowToken
                    , amountToRepay2
                ),
            ]
        );

        return getTwoBorrowsTwoRepaysResults(
            c0
            , b0
            , collateralAmount1.add(collateralAmount2)
            , userBalances
            , borrowBalances
            , await uc.totalBorrowedAmount()
            , await uc.totalRepaidAmount()
        );
    }
//endregion Test two borrows, two repays

//region Unit tests
    describe("Borrow & repay", async () => {
        describe("Good paths", () => {
            describe("Single borrow, single instant complete repay", () => {
                describe("Dai=>USDC", () => {
                    const ASSET_COLLATERAL = MaticAddresses.DAI;
                    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
                    const ASSET_BORROW = MaticAddresses.USDC;
                    const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
                    const AMOUNT_COLLATERAL = 1_000;
                    const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
                    const INITIAL_LIQUIDITY_BORROW = 80_000;
                    const HEALTH_FACTOR2 = 200;
                    const COUNT_BLOCKS = 1;
                    describe("Mock", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay_Mock(
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
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("AAVE.v3", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new Aave3PlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("Hundred finance", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new HundredFinancePlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("dForce", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new DForcePlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("AAVE.v2", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new AaveTwoPlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                });
                describe("Dai=>Matic", () => {
                    const ASSET_COLLATERAL = MaticAddresses.DAI;
                    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
                    const ASSET_BORROW = MaticAddresses.WMATIC;
                    const HOLDER_BORROW = MaticAddresses.HOLDER_WMATIC;
                    const AMOUNT_COLLATERAL = 1_000;
                    const INITIAL_LIQUIDITY_COLLATERAL = 10_000;
                    const INITIAL_LIQUIDITY_BORROW = 80_000;
                    const HEALTH_FACTOR2 = 200;
                    const COUNT_BLOCKS = 1;
                    describe("Mock", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay_Mock(
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
                                        liquidity: INITIAL_LIQUIDITY_COLLATERAL * 10
                                        , collateralFactor: 0.5
                                        , borrowRate: getBigNumberFrom(1, 10)
                                        , decimals: 6
                                    }, borrow: {
                                        liquidity: INITIAL_LIQUIDITY_COLLATERAL * 10
                                        , collateralFactor: 0.8
                                        , borrowRate: getBigNumberFrom(1, 8)
                                        , decimals: 24
                                    }
                                }
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("AAVE.v3", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new Aave3PlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("Hundred finance", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new HundredFinancePlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("dForce", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new DForcePlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("AAVE.v2", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new AaveTwoPlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                });
                describe("Matic=>USDC", () => {
                    const ASSET_COLLATERAL = MaticAddresses.WMATIC;
                    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_WMATIC;
                    const ASSET_BORROW = MaticAddresses.USDC;
                    const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
                    const AMOUNT_COLLATERAL = 1_000;
                    const INITIAL_LIQUIDITY_COLLATERAL = 1_000_000;
                    const INITIAL_LIQUIDITY_BORROW = 80_000;
                    const HEALTH_FACTOR2 = 200;
                    const COUNT_BLOCKS = 1;
                    describe("Mock", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay_Mock(
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
                                        liquidity: INITIAL_LIQUIDITY_COLLATERAL * 10
                                        , collateralFactor: 0.5
                                        , borrowRate: getBigNumberFrom(1, 10)
                                        , decimals: 6
                                    }, borrow: {
                                        liquidity: INITIAL_LIQUIDITY_COLLATERAL * 10
                                        , collateralFactor: 0.8
                                        , borrowRate: getBigNumberFrom(1, 8)
                                        , decimals: 24
                                    }
                                }
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("AAVE.v3", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new Aave3PlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("Hundred finance", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new HundredFinancePlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("dForce", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new DForcePlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("AAVE.v2", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new AaveTwoPlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                });
                describe("USDC=>USDT", () => {
                    const ASSET_COLLATERAL = MaticAddresses.USDC;
                    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_USDC;
                    const ASSET_BORROW = MaticAddresses.USDT;
                    const HOLDER_BORROW = MaticAddresses.HOLDER_USDT;
                    const AMOUNT_COLLATERAL = 100_000;
                    const INITIAL_LIQUIDITY_COLLATERAL = 1_000_000;
                    const INITIAL_LIQUIDITY_BORROW = 80_000;
                    const HEALTH_FACTOR2 = 200;
                    const COUNT_BLOCKS = 1;
                    describe("Mock", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay_Mock(
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
                                        liquidity: INITIAL_LIQUIDITY_COLLATERAL * 10
                                        , collateralFactor: 0.5
                                        , borrowRate: getBigNumberFrom(1, 10)
                                        , decimals: 6
                                    }, borrow: {
                                        liquidity: INITIAL_LIQUIDITY_COLLATERAL * 10
                                        , collateralFactor: 0.8
                                        , borrowRate: getBigNumberFrom(1, 8)
                                        , decimals: 24
                                    }
                                }
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("AAVE.v3", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new Aave3PlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("Hundred finance", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new HundredFinancePlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("dForce", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new DForcePlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("AAVE.v2", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestSingleBorrowInstantRepay(
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
                                }, new AaveTwoPlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                });
            });

            describe("Borrow-time-borrow, repay-time-complete repay", () => {
                describe("Dai=>USDC", () => {
                    const ASSET_COLLATERAL = MaticAddresses.DAI;
                    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
                    const ASSET_BORROW = MaticAddresses.USDC;
                    const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
                    const AMOUNT_COLLATERAL = 1_000;
                    const AMOUNT_COLLATERAL2 = 3_000;
                    const AMOUNT_REPAY1 = 10;
                    const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
                    const INITIAL_LIQUIDITY_BORROW = 80_000;
                    const HEALTH_FACTOR2 = 200;
                    const COUNT_BLOCKS = 1;
                    const DELTA_BLOCKS_BORROW = 100;
                    const DELTA_BLOCKS_REPAY = 10;
                    describe("Mock", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestTwoBorrowsTwoRepays_Mock(
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
                                    , collateralAmount2: AMOUNT_COLLATERAL2
                                    , deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW
                                    , deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY
                                    , repayAmount1: AMOUNT_REPAY1
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
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("AAVE.v3", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestTwoBorrowsTwoRepays(
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
                                    , collateralAmount2: AMOUNT_COLLATERAL2
                                    , deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW
                                    , deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY
                                    , repayAmount1: AMOUNT_REPAY1
                                }, new Aave3PlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("Hundred finance", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestTwoBorrowsTwoRepays(
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
                                    , collateralAmount2: AMOUNT_COLLATERAL2
                                    , deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW
                                    , deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY
                                    , repayAmount1: AMOUNT_REPAY1
                                }, new HundredFinancePlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("dForce", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestTwoBorrowsTwoRepays(
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
                                    , collateralAmount2: AMOUNT_COLLATERAL2
                                    , deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW
                                    , deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY
                                    , repayAmount1: AMOUNT_REPAY1
                                }, new DForcePlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                    describe("AAVE.v2", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const ret = await makeTestTwoBorrowsTwoRepays(
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
                                    , collateralAmount2: AMOUNT_COLLATERAL2
                                    , deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW
                                    , deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY
                                    , repayAmount1: AMOUNT_REPAY1
                                }, new AaveTwoPlatformFabric()
                            );
                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                });
            });

            describe("Check gas limits - single borrow, single instant complete repay", () => {
                describe("Dai=>USDC", () => {
                    const ASSET_COLLATERAL = MaticAddresses.DAI;
                    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
                    const ASSET_BORROW = MaticAddresses.USDC;
                    const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
                    const AMOUNT_COLLATERAL = 1_000;
                    const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
                    const INITIAL_LIQUIDITY_BORROW = 80_000;
                    const HEALTH_FACTOR2 = 200;
                    const COUNT_BLOCKS = 1;
                    describe("AAVE.v3", () => {
                        it("should not exceed gas limit", async () => {

                            const r = await makeTestSingleBorrowInstantRepay(
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
                                }, new Aave3PlatformFabric()
                                , true
                            );
                            controlGasLimitsEx(r.gasUsed!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_AAVE3, (u, t) => {
                                expect(u).to.be.below(t);
                            });
                        });
                    });
                    describe("Hundred finance", () => {
                        it("should not exceed gas limit", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const r = await makeTestSingleBorrowInstantRepay(
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
                                }, new HundredFinancePlatformFabric()
                                , true
                            );
                            controlGasLimitsEx(r.gasUsed!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_HUNDRED_FINANCE, (u, t) => {
                                expect(u).to.be.below(t);
                            });
                        });
                    });
                    describe("dForce", () => {
                        it("should not exceed gas limit", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const r = await makeTestSingleBorrowInstantRepay(
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
                                }, new DForcePlatformFabric()
                                , true
                            );
                            controlGasLimitsEx(r.gasUsed!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_DFORCE, (u, t) => {
                                expect(u).to.be.below(t);
                            });
                        });
                    });
                    describe("AAVE.v2", () => {
                        it("should not exceed gas limit", async () => {
                            if (!await isPolygonForkInUse()) return;
                            const r = await makeTestSingleBorrowInstantRepay(
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
                                }, new AaveTwoPlatformFabric()
                                , true
                            );
                            controlGasLimitsEx(r.gasUsed!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_AAVE_TWO, (u, t) => {
                                expect(u).to.be.below(t);
                            });
                        });
                    });
                });
            });
        });
        describe("Bad paths", () => {
        });
    });
//endregion Unit tests

});