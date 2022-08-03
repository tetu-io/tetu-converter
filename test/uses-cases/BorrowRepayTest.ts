import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
    CTokenMock__factory, IERC20Extended__factory, IHfCToken__factory,
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
import {SetupTetuConverterApp} from "../baseUT/SetupTetuConverterApp";
import {BorrowRepayUsesCase} from "../baseUT/BorrowRepayUsesCase";
import {BorrowAction} from "../baseUT/actions/BorrowAction";
import {RepayAction} from "../baseUT/actions/RepayAction";

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

//region Unit tests
    describe("Single borrow, single repay", () => {
        describe("Borrow and repay immediately", () => {
            describe("Good paths", () => {
                describe("AAVE.v3", () => {
                    describe("Dai=>Matic, full repay", () => {
                        it("", async () => {
                            const fabric = new Aave3PlatformFabric();
                            const {tc, controller} = await SetupTetuConverterApp.buildApp(deployer, [fabric]);
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

                            await BalanceUtils.transferFromHolder(
                              collateralToken.address
                              , collateralHolder
                              , uc.address
                              , 1_000_000
                            );

                            await BalanceUtils.transferFromHolder(
                                borrowToken.address
                                , borrowHolder
                                , uc.address
                                , 1_000
                            );

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