import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
    CTokenMock__factory, IERC20__factory, IERC20Extended__factory, IHfCToken__factory,
    IPoolAdapter,
    IPoolAdapter__factory, MockERC20__factory,
    PoolAdapterMock__factory
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BorrowManagerHelper} from "../baseUT/BorrowManagerHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {CoreContractsHelper} from "../baseUT/CoreContractsHelper";
import {MocksHelper} from "../baseUT/MocksHelper";
import {BalanceUtils, ContractToInvestigate, IUserBalances} from "../baseUT/BalanceUtils";
import {TokenWrapper} from "../baseUT/TokenWrapper";
import {AdaptersHelper} from "../baseUT/AdaptersHelper";
import {HundredFinanceHelper} from "../../scripts/integration/helpers/HundredFinanceHelper";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {ILendingPlatformFabric, TetuConverterApp} from "../baseUT/TetuConverterApp";
import {BorrowRepayUsesCase} from "../baseUT/BorrowRepayUsesCase";
import {BorrowAction} from "../baseUT/actions/BorrowAction";
import {RepayAction} from "../baseUT/actions/RepayAction";
import {MockPlatformFabric} from "../baseUT/fabrics/MockPlatformFabric";
import {isPolygonForkInUse} from "../baseUT/NetworkUtils";
import {HundredFinancePlatformFabric} from "../baseUT/fabrics/HundredFinancePlatformFabric";
import {DForcePlatformFabric} from "../baseUT/fabrics/DForcePlatformFabric";

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
            , borrowBalances[0].sub(totalBorrowedAmount).div(totalBorrowedAmount).abs().mul(1e6).toNumber() == 0,

            // after repay
            // collateral >= initial collateral
            userBalances[1].collateral.gte(c0)
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
//endregion Utils

//region Data types
    interface TokenParams {
        asset: string;
        holder: string;
        initialLiquidity: number;
    }

    interface TestInputParams {
        collateral: TokenParams;
        borrow: TokenParams;
        collateralAmount: number;
        healthFactor2: number;
        countBlocks: number;
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

//region Test impl
    async function makeTestSingleBorrowInstantRepay_Mock(
        p: TestInputParams,
        m: MockTestInputParams
    ) : Promise<{sret: string, sexpected: string}> {
        const collateralToken = await TokenWrapper.Build(deployer, p.collateral.asset);
        const borrowToken = await TokenWrapper.Build(deployer, p.borrow.asset);

        const amountToRepay = undefined; //full repay

        const underlines = [p.collateral.asset, p.borrow.asset];
        const cTokenDecimals = [m.collateral.decimals, m.borrow.decimals];
        const cTokens = await MocksHelper.createCTokensMocks(deployer, cTokenDecimals, underlines);

        const fabric = new MockPlatformFabric(
            underlines,
            [m.collateral.borrowRate, m.borrow.borrowRate],
            [m.collateral.collateralFactor, m.borrow.collateralFactor],
            [m.collateral.liquidity, m.borrow.liquidity],
            [p.collateral.holder, p.borrow.holder],
            cTokens
        );
        const {tc, controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
        const uc = await MocksHelper.deployUserBorrowRepayUCs(deployer.address, controller);

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
        p: TestInputParams,
        fabric: ILendingPlatformFabric
    ) : Promise<{sret: string, sexpected: string}> {
        const {tc, controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
        const uc = await MocksHelper.deployUserBorrowRepayUCs(deployer.address, controller);

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
//endregion Test impl

//region Unit tests
    describe("Borrow & repay", () => {
        describe("Good paths", () => {
            describe("Single borrow, single instant complete repay", () => {
                describe("Dai=>USDC", () => {
                    const ASSET_COLLATERAL = MaticAddresses.DAI;
                    const HOLDER_COLLATERAL =  MaticAddresses.HOLDER_DAI;
                    const ASSET_BORROW  = MaticAddresses.USDC;
                    const HOLDER_BORROW  = MaticAddresses.HOLDER_USDC;
                    const AMOUNT_COLLATERAL = 1_000;
                    const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
                    const INITIAL_LIQUIDITY_BORROW = 80_000;
                    const HEALTH_FACTOR2 = 0;
                    const COUNT_BLOCKS = 1;
                    describe("Mock", () => {
                        it("should return expected balances", async () => {
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
                });
                describe("Dai=>Matic", () => {
                    const ASSET_COLLATERAL = MaticAddresses.DAI;
                    const HOLDER_COLLATERAL =  MaticAddresses.HOLDER_DAI;
                    const ASSET_BORROW  = MaticAddresses.WMATIC;
                    const HOLDER_BORROW  = MaticAddresses.HOLDER_WMATIC;
                    const AMOUNT_COLLATERAL = 1_000;
                    const INITIAL_LIQUIDITY_COLLATERAL = 1_000_000;
                    const INITIAL_LIQUIDITY_BORROW = 80_000;
                    const HEALTH_FACTOR2 = 0;
                    const COUNT_BLOCKS = 1;
                    describe("Mock", () => {
                        it("should return expected balances", async () => {
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
                });
                describe("USDC=>Matic", () => {
                    const ASSET_COLLATERAL = MaticAddresses.USDC;
                    const HOLDER_COLLATERAL =  MaticAddresses.HOLDER_USDC;
                    const ASSET_BORROW  = MaticAddresses.WMATIC;
                    const HOLDER_BORROW  = MaticAddresses.HOLDER_WMATIC;
                    const AMOUNT_COLLATERAL = 1_000;
                    const INITIAL_LIQUIDITY_COLLATERAL = 1_000_000;
                    const INITIAL_LIQUIDITY_BORROW = 80_000;
                    const HEALTH_FACTOR2 = 0;
                    const COUNT_BLOCKS = 1;
                    describe("Mock", () => {
                        it("should return expected balances", async () => {
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
                });
                describe("USDC=>USDT", () => {
                    const ASSET_COLLATERAL = MaticAddresses.USDC;
                    const HOLDER_COLLATERAL =  MaticAddresses.HOLDER_USDC;
                    const ASSET_BORROW  = MaticAddresses.USDT;
                    const HOLDER_BORROW  = MaticAddresses.HOLDER_USDT;
                    const AMOUNT_COLLATERAL = 1_000;
                    const INITIAL_LIQUIDITY_COLLATERAL = 1_000_000;
                    const INITIAL_LIQUIDITY_BORROW = 80_000;
                    const HEALTH_FACTOR2 = 0;
                    const COUNT_BLOCKS = 1;
                    describe("Mock", () => {
                        it("should return expected balances", async () => {
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
                });
            });
        });
        describe("Bad paths", () => {
        });
    });
//endregion Unit tests

});