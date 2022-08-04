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
import {TetuConverterApp} from "../baseUT/TetuConverterApp";
import {BorrowRepayUsesCase} from "../baseUT/BorrowRepayUsesCase";
import {BorrowAction} from "../baseUT/actions/BorrowAction";
import {RepayAction} from "../baseUT/actions/RepayAction";
import {MockPlatformFabric} from "../baseUT/fabrics/MockPlatformFabric";
import {isPolygonForkInUse} from "../baseUT/NetworkUtils";

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
        borrowBalances: BigNumber[]
    ) : {sret: string, sexpected: string} {
        const borrowedAmount = userBalances[0].borrow.sub(b0);

        const sret = [
            // collateral after borrow
            userBalances[0].collateral
            // borrowed amount > 0
            , !borrowedAmount.eq(BigNumber.from(0))
            // contract borrow balance >= borrowed amount
            , borrowBalances[0].gte(borrowedAmount),

            // after repay
            // collateral >= initial collateral
            userBalances[1].collateral.gte(c0)
            // borrowed balance <= initial borrowed balance
            , b0.gte(userBalances[1].borrow)
            // contract borrowed balance is 0
            , borrowBalances[1].eq(BigNumber.from(0))
        ].map(x => BalanceUtils.toString(x)).join("\n");

        const sexpected = [
            // collateral after borrow
            c0.sub(collateralAmount)
            // borrowed amount > 0
            , true
            // contract borrow balance >= b0 + borrowed amount
            , true

            //after repay
            // collateral >= initial collateral
            , true
            // borrowed balance <= initial borrowed balance
            , true
            // contract borrowed balance is 0
            , true
        ].map(x => BalanceUtils.toString(x)).join("\n");

        return {sret, sexpected};
    }
//endregion Utils

//region Unit tests
    describe("Single borrow, single full repay", () => {
        describe("Borrow and repay immediately", () => {
            describe("Good paths", () => {
                describe("Mock", () => {
                    describe("Dai=>Matic, full repay", () => {
                        it("should return expected balances", async () => {
                            const collateralAsset = MaticAddresses.DAI;
                            const collateralHolder = MaticAddresses.HOLDER_DAI;
                            const borrowAsset = MaticAddresses.WMATIC;
                            const borrowHolder = MaticAddresses.HOLDER_WMATIC;

                            const collateralToken = await TokenWrapper.Build(deployer, collateralAsset);
                            const borrowToken = await TokenWrapper.Build(deployer, borrowAsset);

                            const collateralAmount = getBigNumberFrom(1_000, collateralToken.decimals);

                            const countBlocks = 1;
                            const healthFactor2 = 0;

                            const amountToRepay = undefined; //full repay

                            const underlines = [collateralAsset, borrowAsset];
                            const cTokenDecimals = [6, 24];
                            const cTokens = await MocksHelper.createCTokensMocks(deployer, cTokenDecimals, underlines);

                            const fabric = new MockPlatformFabric(
                                underlines,
                                [getBigNumberFrom(1, 10), getBigNumberFrom(1, 10)],
                                [0.5, 0.8],
                                [1_000_000, 1_000_000],
                                [collateralHolder, borrowHolder],
                                cTokens
                            );
                            const {tc, controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
                            const uc = await MocksHelper.deployUserBorrowRepayUCs(deployer.address, controller);

                            const c0 = await setInitialBalance(collateralToken.address
                                , collateralHolder, 1_000_000, uc.address);
                            const b0 = await setInitialBalance(borrowToken.address
                                , borrowHolder, 80_000, uc.address);

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
                                        , countBlocks
                                        , healthFactor2
                                    ),
                                    new RepayAction(
                                        collateralToken
                                        , borrowToken
                                        , amountToRepay
                                    )
                                ]
                            );

                            const ret = getSingleBorrowSingleRepayResults(
                                c0
                                , b0
                                , collateralAmount
                                , userBalances
                                , borrowBalances
                            );

                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                })
                describe("AAVE.v3", () => {
                    describe("Dai=>Matic, full repay", () => {
                        it("should return expected balances", async () => {
                            if (!await isPolygonForkInUse()) return;

                            const fabric = new Aave3PlatformFabric();
                            const {tc, controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
                            const uc = await MocksHelper.deployUserBorrowRepayUCs(deployer.address, controller);

                            const collateralAsset = MaticAddresses.DAI;
                            const collateralHolder = MaticAddresses.HOLDER_DAI;
                            const borrowAsset = MaticAddresses.WMATIC;
                            const borrowHolder = MaticAddresses.HOLDER_WMATIC;

                            const collateralToken = await TokenWrapper.Build(deployer, collateralAsset);
                            const borrowToken = await TokenWrapper.Build(deployer, borrowAsset);

                            const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);

                            const countBlocks = 1;
                            const healthFactor2 = 0;

                            const amountToRepay = undefined; //full repay

                            const c0 = await setInitialBalance(collateralToken.address
                                , collateralHolder, 1_000_000, uc.address);
                            const b0 = await setInitialBalance(borrowToken.address
                                , borrowHolder, 80_000, uc.address);

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
                                        , countBlocks
                                        , healthFactor2
                                    ),
                                    new RepayAction(
                                        collateralToken
                                        , borrowToken
                                        , amountToRepay
                                    )
                                ]
                            );

                            const ret = getSingleBorrowSingleRepayResults(
                                c0
                                , b0
                                , collateralAmount
                                , userBalances
                                , borrowBalances
                            );
                            console.log(`after borrow: collateral=${userBalances[0].collateral.toString()} borrow=${userBalances[0].borrow.toString()} borrowBalance=${borrowBalances[0].toString()}`);
                            console.log(`after repay: collateral=${userBalances[1].collateral.toString()} borrow=${userBalances[1].borrow.toString()} borrowBalance=${borrowBalances[1].toString()}`);

                            expect(ret.sret).eq(ret.sexpected);
                        });
                    });
                });
                describe("HundredFinance", () => {
                });
            });
            describe("Bad paths", () => {
            });
        });
    });
//endregion Unit tests

});