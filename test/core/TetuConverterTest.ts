import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BorrowManager, IERC20__factory, MockERC20, MockERC20__factory, TetuConverter} from "../../typechain";
import {IBmInputParams, BorrowManagerHelper, PoolInstanceInfo} from "../baseUT/BorrowManagerHelper";
import {ConversionUsesCases, IParamsUS11} from "../uses-cases/ConversionUsesCases";
import {CoreContracts} from "../uses-cases/CoreContracts";
import {CoreContractsHelper} from "../baseUT/CoreContractsHelper";
import {BigNumber} from "ethers";
import exp from "constants";
import {MocksHelper} from "../baseUT/MocksHelper";

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

    async function getBalances(
        contracts: string[],
        tokens: string[]
    ) : Promise<BigNumber[]> {
        const dest: BigNumber[] = [];
        for (const contract of contracts) {
            for (const token of tokens) {
                dest.push(
                    await IERC20__factory.connect(token, deployer).balanceOf(contract)
                )
            }
        }
        return dest;
    }

    function toString(n: number | BigNumber) : string {
        return typeof n === "object" ? n.toString() : "" + n;
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
                        const input = {
                            targetCollateralFactor: 0.8,
                            priceSourceUSD: 0.1,
                            priceTargetUSD: 4,
                            sourceDecimals: 24,
                            targetDecimals: targetDecimals,
                            sourceAmount: 100_000,
                            healthFactor: 4,
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

                        const ret = await data.tetuConveter.findBestConversionStrategy(
                            data.sourceToken.address,
                            getBigNumberFrom(input.sourceAmount, input.sourceDecimals),
                            data.targetToken.address,
                            getBigNumberFrom(healthFactor, 18),
                            period
                        );

                        const sret = [
                            ret.outPool,
                            ret.outMaxTargetAmount,
                            //TODO ret.outInterest
                        ].join();

                        const expectedTargetAmount =
                            input.targetCollateralFactor
                            * input.sourceAmount * input.priceSourceUSD
                            / (input.priceTargetUSD)
                            / healthFactor;

                        const sexpected = [
                            data.pools[0].pool,
                            getBigNumberFrom(expectedTargetAmount, input.targetDecimals),
                            //TODO bestBorrowRate.mul(period).mul(expectedTargetAmount)
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
            describe("US11, mock", () => {
                it("should update balances in proper way", async () => {
                    const period = BLOCKS_PER_DAY * 31;
                    const targetDecimals = 12;
                    const sourceDecimals = 24;
                    const user = ethers.Wallet.createRandom().address;
                    const receiver = ethers.Wallet.createRandom().address;
                    const sourceAmountNumber = 100_000;
                    const sourceAmount = getBigNumberFrom(sourceAmountNumber, sourceDecimals);
                    const availableBorrowLiquidityNumber = 200_000_000;
                    const availableBorrowLiquidity = getBigNumberFrom(availableBorrowLiquidityNumber, targetDecimals);
                    const healthFactor = 1.8;

                    const tt: IBmInputParams = {
                        targetCollateralFactor: 0.8,
                        priceSourceUSD: 0.1,
                        priceTargetUSD: 4,
                        sourceDecimals: sourceDecimals,
                        targetDecimals: targetDecimals,
                        sourceAmount: sourceAmountNumber,
                        healthFactor: 4,
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

                    const {bm, sourceToken, targetToken, pools, controller}
                        = await BorrowManagerHelper.createBmTwoUnderlines(deployer, tt);
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

                    const contractsToInvestigate = [userContract.address, user, pool, core.tc.address];
                    const tokensToInvestigate = [sourceToken.address, targetToken.address, cToken];

                    // initialize balances
                    await MockERC20__factory.connect(sourceToken.address, deployer)
                        .mint(userContract.address, sourceAmount);
                    await MockERC20__factory.connect(targetToken.address, deployer)
                        .mint(pool, availableBorrowLiquidity);

                    const before = await getBalances(contractsToInvestigate, tokensToInvestigate);
                    console.log("before", before);

                    await userContract.makeBorrowUS11(
                        sourceToken.address,
                        sourceAmount,
                        targetToken.address,
                        BigNumber.from(period),
                        getBigNumberFrom(healthFactor * 10, 17),
                        user
                    );

                    //now we can take address of pool adapter - to check its balances
                    const poolAdapter = await core.bm.getPoolAdapter(pool, user, sourceToken.address);
                    console.log("poolAdapter", poolAdapter);
                    contractsToInvestigate.push(poolAdapter);

                    const after = await getBalances(contractsToInvestigate, tokensToInvestigate);
                    console.log("after", after);

                    const ret = [...before, ...after].map(x => toString(x)).join("\r");

                    const expectedTargetAmount = getBigNumberFrom(
                        tt.targetCollateralFactor
                        * tt.sourceAmount * tt.priceSourceUSD
                        / (tt.priceTargetUSD)
                        / healthFactor
                        , targetDecimals
                    );

                    const expected = [
                        //before
                        //userContract: source, target, cToken
                        sourceAmount, 0, 0,
                        //user: source, target, cToken
                        0, 0, 0,
                        //pool: source, target, cToken
                        0, availableBorrowLiquidity, 0,
                        //tc: source, target, cToken
                        0, 0, 0,

                        //after borrowing
                        //userContract: source, target, cToken
                        0, 0, 0,
                        //user: source, target, cToken
                        0, expectedTargetAmount, 0,
                        //pool: source, target, cToken
                        sourceAmount, availableBorrowLiquidity.sub(expectedTargetAmount), 0,
                        //tc: source, target, cToken
                        0, 0, 0,
                        //pa: source, target, cToken
                        0, 0, sourceAmount //!TODO: we assume exchange rate 1:1

                    ].map(x => toString(x)).join("\r");

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