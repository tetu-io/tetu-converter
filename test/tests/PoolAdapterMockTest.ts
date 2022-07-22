import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
    CTokenMock__factory,
    DebtMonitor,
    DebtMonitor__factory,
    IPoolAdapter,
    IPoolAdapter__factory, IPriceOracle__factory, MockERC20__factory,
    PoolAdapterMock__factory
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BorrowManagerHelper} from "../baseUT/BorrowManagerHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {CoreContractsHelper} from "../baseUT/CoreContractsHelper";
import {MocksHelper} from "../baseUT/MocksHelper";
import {Misc} from "../../scripts/utils/Misc";

describe("PoolAdapterMock", () => {
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


//endregion Utils

//region Unit tests
    describe("", () => {
        describe("Good paths", () => {
            describe("Borrow and repay", () => {
                it("should set expected state", async () => {
                    // create template-pool-adapter
                    const priceSourceUSD = 0.1;
                    const priceTargetUSD = 2;
                    const blocksBetweenBorrowAndRepay = 20;
                    const templatePoolAdapter = await MocksHelper.createPoolAdapterMock(deployer);
                    const collateralFactor18 = getBigNumberFrom(5, 17); // 0.5
                    const borrowRatePerBlock18 = getBigNumberFrom(1, 10); // 0.01
                    const tt = BorrowManagerHelper.getBmInputParamsSinglePool(1
                        , priceSourceUSD, priceTargetUSD);
                    const amountCollateral = getBigNumberFrom(10000, tt.sourceDecimals);
                    const amountBorrowLiquidityInPool = getBigNumberFrom(1e10, tt.targetDecimals);
                    const amountToBorrow = getBigNumberFrom(100, tt.targetDecimals);
                    const amountBorrowedUserInitial = getBigNumberFrom(1000, tt.targetDecimals);

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
                    const user = ethers.Wallet.createRandom().address;
                    const collateral = sourceToken.address;

                    await bm.registerPoolAdapter(pool, user, collateral);

                    // pool adapter is a copy of templatePoolAdapter, created using minimal-proxy pattern
                    // this is a mock, we need to configure it
                    const poolAdapterAddress = await bm.getPoolAdapter(pool, user, collateral);
                    const poolAdapterMock = await PoolAdapterMock__factory.connect(poolAdapterAddress, deployer);
                    const cToken = CTokenMock__factory.connect(
                        pools[0].underlineTocTokens.get(sourceToken.address) || ""
                        , deployer
                    );
                    await poolAdapterMock.setUpMock(
                        cToken.address,
                        await controller.priceOracle(),
                        await controller.debtMonitor(),
                        collateralFactor18,
                        [targetToken.address],
                        [borrowRatePerBlock18]
                    );

                    // get data from the pool adapter
                    const pa: IPoolAdapter = IPoolAdapter__factory.connect(
                        poolAdapterAddress, await DeployerUtils.startImpersonate(user)
                    );
                    console.log("Pool adapter", pa.address);
                    console.log("User", user);

                    // prepare initial balances
                    await targetToken.mint(pa.address, amountBorrowLiquidityInPool);

                    await sourceToken.mint(user, amountCollateral);
                    console.log("Mint collateral to user", amountCollateral);
                    await targetToken.mint(user, amountBorrowedUserInitial);
                    console.log("Mint borrowed token to user", amountBorrowedUserInitial);

                    const before = [
                        await sourceToken.balanceOf(user), await sourceToken.balanceOf(pa.address),
                        await targetToken.balanceOf(user), await targetToken.balanceOf(pa.address),
                        await cToken.balanceOf(user), await cToken.balanceOf(pa.address),
                    ];
                    console.log("Before borrow", before);

                    // borrow
                    await MockERC20__factory.connect(sourceToken.address, await DeployerUtils.startImpersonate(user))
                        .transfer(pa.address, amountCollateral); // user transfers collateral to pool adapter
                    console.log("Transfer collateral to PA", amountCollateral);
                    await pa.borrow(amountCollateral, targetToken.address, amountToBorrow, user);
                    console.log("Borrow", amountToBorrow);

                    const afterBorrow = [
                        await sourceToken.balanceOf(user), await sourceToken.balanceOf(pa.address),
                        await targetToken.balanceOf(user), await targetToken.balanceOf(pa.address),
                        await cToken.balanceOf(user), await cToken.balanceOf(pa.address),
                    ];
                    console.log("After borrow", afterBorrow);

                    // assume, that some time is passed and the borrow debt is increased
                    await PoolAdapterMock__factory.connect(pa.address, deployer)
                        .setPassedBlocks(targetToken.address, blocksBetweenBorrowAndRepay);
                    const expectedDebt = amountToBorrow
                        .mul(blocksBetweenBorrowAndRepay)
                        .mul(borrowRatePerBlock18)
                        .div(BigNumber.from(10).pow(18));
                    console.log("Time passed, blocks=", blocksBetweenBorrowAndRepay, "+debt", expectedDebt);

                    // repay immediately
                    // how much we should repay?
                    const amountToRepay = await pa.getAmountToRepay(targetToken.address);
                    console.log("We need to repay", amountToRepay);
                    await MockERC20__factory.connect(targetToken.address, await DeployerUtils.startImpersonate(user))
                        .transfer(pa.address, amountToRepay); // user transfers collateral to pool adapter
                    console.log("Transfer borrowed token to PA", amountToRepay);
                    await pa.repay(targetToken.address, amountToRepay, user);

                    const afterRepay = [
                        await sourceToken.balanceOf(user), await sourceToken.balanceOf(pa.address),
                        await targetToken.balanceOf(user), await targetToken.balanceOf(pa.address),
                        await cToken.balanceOf(user), await cToken.balanceOf(pa.address),
                    ];
                    console.log("After repay", afterRepay);

                    const ret = [
                        ...before.map(x => x.toString())
                        , ...afterBorrow.map(x => x.toString())
                        , ...afterRepay.map(x => x.toString())
                    ].join("\r");

                    const expectedAmounts = [
                        // before
                        amountCollateral, 0, //sourceToken
                        amountBorrowedUserInitial, amountBorrowLiquidityInPool, //targetToken
                        0, 0, //cToken

                        // afterBorrow
                        0, amountCollateral, //sourceToken
                        amountBorrowedUserInitial.add(amountToBorrow), amountBorrowLiquidityInPool.sub(amountToBorrow), //targetToken
                        0, amountCollateral, //cToken

                        // afterRepay
                        amountCollateral, 0, //sourceToken
                        amountBorrowedUserInitial.sub(expectedDebt), amountBorrowLiquidityInPool.add(expectedDebt), //targetToken
                        0, 0, //cToken
                    ];
                    const expected = expectedAmounts.map(x => x.toString()).join("\r");

                    expect(ret).equal(expected);
                });
            });
        });
        describe("Bad paths", () => {
        });
    });
//endregion Unit tests

});