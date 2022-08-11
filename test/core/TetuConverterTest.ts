import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {
    BorrowManager,
    IERC20__factory,
    MockERC20,
    MockERC20__factory,
    TetuConverter, Borrower
} from "../../typechain";
import {IBmInputParams, BorrowManagerHelper, PoolInstanceInfo} from "../baseUT/helpers/BorrowManagerHelper";
import {CoreContracts} from "../baseUT/CoreContracts";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {BigNumber} from "ethers";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BalanceUtils, ContractToInvestigate} from "../baseUT/utils/BalanceUtils";

describe("BorrowManager", () => {
//region Constants
    const BLOCKS_PER_DAY = 6456;
//endregion Constants

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
    async function createTetuConverter(
        tt: IBmInputParams
    ) : Promise<{
        tetuConveter: TetuConverter,
        sourceToken: MockERC20,
        targetToken: MockERC20,
        borrowManager: BorrowManager,
        pools: PoolInstanceInfo[]
    }> {
        const {bm, sourceToken, targetToken, pools, controller}
            = await BorrowManagerHelper.createBmTwoUnderlines(deployer, tt);

        const tetuConveter = await DeployUtils.deployContract(deployer
            , "TetuConverter", controller.address) as TetuConverter;

        return {tetuConveter, sourceToken, targetToken, borrowManager: bm, pools};
    }

    async function prepareContracts(
        tt: IBmInputParams,
        user: string,
    ) : Promise<{
        core: CoreContracts,
        pool: string,
        cToken: string,
        userContract: Borrower,
        sourceToken: MockERC20,
        targetToken: MockERC20,
        poolAdapter: string
    }>{
        const healthFactor2 = 200;
        const periodInBlocks = 117;
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
        const userContract = await MocksHelper.deployBorrower(user, core.controller, healthFactor2, periodInBlocks);

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

        console.log("poolAdapter-mock is configured:", poolAdapter, targetToken.address);

        return {core,  pool, cToken, userContract, sourceToken, targetToken, poolAdapter};
    }
//endregion Utils

//region Unit tests
    describe("findBestConversionStrategy", () => {
        describe("Good paths", () => {
            describe("Lending is more efficient", () => {
                describe("Single suitable lending pool", () => {
                    it("should return expected data", async () => {
                        const period = BLOCKS_PER_DAY * 31;
                        const targetDecimals = 12;
                        const bestBorrowRate = getBigNumberFrom(1, targetDecimals - 8);

                        const healthFactor = 2;
                        const sourceAmount = 100_000;
                        const input: IBmInputParams = {
                            collateralFactor: 0.8,
                            priceSourceUSD: 0.1,
                            priceTargetUSD: 4,
                            sourceDecimals: 24,
                            targetDecimals: targetDecimals,
                            availablePools: [
                                {   // source, target
                                    borrowRateInTokens: [
                                        getBigNumberFrom(0, targetDecimals),
                                        bestBorrowRate
                                    ],
                                    availableLiquidityInTokens: [0, 200_000]
                                }
                            ]
                        };

                        const data = await createTetuConverter(input);

                        const ret = await data.tetuConveter.findConversionStrategy(
                            data.sourceToken.address,
                            getBigNumberFrom(sourceAmount, input.sourceDecimals),
                            data.targetToken.address,
                            getBigNumberFrom(healthFactor, 2),
                            period
                        );

                        const sret = [
                            ret.converter,
                            ret.maxTargetAmount,
                            ret.aprForPeriod18
                        ].join();

                        const expectedTargetAmount =
                            input.collateralFactor
                            * sourceAmount * input.priceSourceUSD
                            / (input.priceTargetUSD)
                            / healthFactor;

                        const sexpected = [
                            data.pools[0].converter,
                            getBigNumberFrom(expectedTargetAmount, input.targetDecimals),
                            bestBorrowRate.mul(period)
                        ].join();

                        expect(sret).equal(sexpected);
                    });
                });
            });
            describe("Swap is more efficient", () => {
                it("TODO", async () => {
                    expect.fail();
                });
            });
        });
        describe("Bad paths", () => {
            describe("Unsupported source asset", () => {
                it("should return 0", async () => {
                    expect.fail();
                });
            });
            describe("Pool don't have enough liquidity", () => {
                it("should return 0", async () => {
                    expect.fail();
                });
            });
        });
    });

    describe("convert", () => {
        describe("Good paths", () => {
            describe("UC11, mock", () => {
                it("should update balances in proper way", async () => {
                    const user = ethers.Wallet.createRandom().address;
                    const period = BLOCKS_PER_DAY * 31;
                    const targetDecimals = 12;
                    const sourceDecimals = 24;
                    const sourceAmountNumber = 100_000;
                    const availableBorrowLiquidityNumber = 200_000_000;
                    const healthFactor = 2;
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
                    const sourceAmount = getBigNumberFrom(sourceAmountNumber, sourceDecimals);
                    const availableBorrowLiquidity = getBigNumberFrom(availableBorrowLiquidityNumber, targetDecimals);

                    const {core,  pool, cToken, userContract, sourceToken, targetToken, poolAdapter} =
                        await prepareContracts(tt, user);
                    console.log("cToken is", cToken);

                    const contractsToInvestigate: ContractToInvestigate[] = [
                        {name: "userContract", contract: userContract.address},
                        {name: "user", contract: user},
                        {name: "pool", contract: pool},
                        {name: "tc", contract: core.tc.address},
                        {name: "poolAdapter", contract: poolAdapter},
                    ];
                    const tokensToInvestigate = [sourceToken.address, targetToken.address, cToken];

                    // initialize balances
                    await MockERC20__factory.connect(sourceToken.address, deployer)
                        .mint(userContract.address, sourceAmount);
                    await MockERC20__factory.connect(targetToken.address, deployer)
                        .mint(pool, availableBorrowLiquidity);

                    // get balances before start
                    const before = await BalanceUtils.getBalances(deployer, contractsToInvestigate, tokensToInvestigate);
                    console.log("before", before);

                    // borrow
                    await userContract.makeBorrowUC1_1(
                        sourceToken.address,
                        sourceAmount,
                        targetToken.address,
                        BigNumber.from(period),
                        BigNumber.from(healthFactor * 100),
                        user
                    );

                    // get result balances
                    const after = await BalanceUtils.getBalances(deployer, contractsToInvestigate, tokensToInvestigate);
                    console.log("after", after);

                    const ret = [...before, "after", ...after].map(x => BalanceUtils.toString(x)).join("\r");

                    const expectedTargetAmount = getBigNumberFrom(
                        tt.collateralFactor
                        * sourceAmountNumber * tt.priceSourceUSD
                        / (tt.priceTargetUSD)
                        / healthFactor
                        , targetDecimals
                    );

                    const expected = [
                        //before
                        //userContract, source, target, cToken
                        "userContract", sourceAmount, 0, 0,
                        //user: source, target, cToken
                        "user", 0, 0, 0,
                        //pool: source, target, cToken
                        "pool", 0, availableBorrowLiquidity, 0,
                        //tc: source, target, cToken
                        "tc", 0, 0, 0,
                        //pa: source, target, cToken
                        "poolAdapter", 0, 0, 0,
                        "after",
                        //after borrowing
                        //userContract: source, target, cToken
                        "userContract", 0, 0, 0,
                        //user: source, target, cToken
                        "user", 0, expectedTargetAmount, 0,
                        //pool: source, target, cToken
                        "pool", sourceAmount, availableBorrowLiquidity.sub(expectedTargetAmount), 0,
                        //tc: source, target, cToken
                        "tc", 0, 0, 0,
                        //pa: source, target, cToken
                        "poolAdapter", 0, 0, sourceAmount //!TODO: we assume exchange rate 1:1

                    ].map(x => BalanceUtils.toString(x)).join("\r");

                    expect(ret).equal(expected);
                });
            });
            describe("UC12, mock", () => {
                it("should update balances in proper way", async () => {
                    const user = ethers.Wallet.createRandom().address;
                    const period = BLOCKS_PER_DAY * 31;
                    const targetDecimals = 12;
                    const sourceDecimals = 24;
                    const sourceAmountNumber = 100_000;
                    const availableBorrowLiquidityNumber = 200_000_000;
                    const healthFactor = 2;
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
                    const sourceAmount = getBigNumberFrom(sourceAmountNumber, sourceDecimals);
                    const availableBorrowLiquidity = getBigNumberFrom(availableBorrowLiquidityNumber, targetDecimals);

                    const {core,  pool, cToken, userContract, sourceToken, targetToken, poolAdapter} =
                        await prepareContracts(tt, user);

                    const contractsToInvestigate: ContractToInvestigate[] = [
                        {name: "userContract", contract: userContract.address},
                        {name: "user", contract: user},
                        {name: "pool", contract: pool},
                        {name: "tc", contract: core.tc.address},
                        {name: "poolAdapter", contract: poolAdapter},
                    ];
                    const tokensToInvestigate = [sourceToken.address, targetToken.address, cToken];

                    // initialize balances
                    await MockERC20__factory.connect(sourceToken.address, deployer)
                        .mint(userContract.address, sourceAmount);
                    await MockERC20__factory.connect(targetToken.address, deployer)
                        .mint(pool, availableBorrowLiquidity);

                    // get balances before start
                    const before = await BalanceUtils.getBalances(deployer, contractsToInvestigate, tokensToInvestigate);
                    console.log("before", before);

                    // borrow
                    await userContract.makeBorrowUC1_1(
                        sourceToken.address,
                        sourceAmount,
                        targetToken.address,
                        BigNumber.from(period),
                        BigNumber.from(healthFactor * 100),
                        user
                    );

                    // repay back immediately
                    const targetTokenAsUser = IERC20__factory.connect(targetToken.address
                        , await DeployerUtils.startImpersonate(user)
                    );
                    await targetTokenAsUser.transfer(userContract.address
                        , targetTokenAsUser.balanceOf(user)
                    );

                    // user receives collateral and transfers it back to UserContract to restore same state as before
                    await userContract.makeRepayUC1_2(
                        sourceToken.address,
                        targetToken.address,
                        user
                    );
                    const sourceTokenAsUser = IERC20__factory.connect(sourceToken.address
                        , await DeployerUtils.startImpersonate(user)
                    );
                    await sourceTokenAsUser.transfer(userContract.address
                        , sourceAmount
                    );

                    // get result balances
                    const after = await BalanceUtils.getBalances(deployer, contractsToInvestigate, tokensToInvestigate);
                    console.log("after", after);

                    const ret = [...before, "after", ...after].map(x => BalanceUtils.toString(x)).join("\r");

                    const beforeExpected = [
                        //before
                        //userContract, source, target, cToken
                        "userContract", sourceAmount, 0, 0,
                        //user: source, target, cToken
                        "user", 0, 0, 0,
                        //pool: source, target, cToken
                        "pool", 0, availableBorrowLiquidity, 0,
                        //tc: source, target, cToken
                        "tc", 0, 0, 0,
                        //pa: source, target, cToken
                        "poolAdapter", 0, 0, 0,
                    ];

                    // balances should be restarted in exactly same state as they were before the borrow
                    const expected = [...beforeExpected, "after", ...beforeExpected]
                        .map(x => BalanceUtils.toString(x)).join("\r");

                    expect(ret).equal(expected);
                });
            });
        });

        describe("Bad paths", () => {
            describe("TODO", () => {
                it("TODO", async () => {
                    expect.fail();
                });
            });
        });
    });

    describe("findBorrows", () => {
        describe("Good paths", () => {
            describe("TODO", () => {
                it("should update balance in proper way", async () => {
                    expect.fail();
                });
            });
        });

        describe("Bad paths", () => {
            describe("TODO", () => {
                it("TODO", async () => {
                    expect.fail();
                });
            });
        });
    });
//endregion Unit tests
});