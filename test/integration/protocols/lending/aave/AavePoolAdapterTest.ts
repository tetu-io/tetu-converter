import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
    IERC20Extended, IERC20Extended__factory
} from "../../../../../typechain";
import {expect, use} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {AdaptersHelper} from "../../../../baseUT/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/NetworkUtils";
import {AaveHelper} from "../../../../../scripts/integration/helpers/AaveHelper";
import {BalanceUtils} from "../../../../baseUT/BalanceUtils";
import {CoreContractsHelper} from "../../../../baseUT/CoreContractsHelper";

describe("Aave integration tests, pool adapter", () => {
//region Constants

//endregion Constants

//region Global vars for all tests
    let snapshot: string;
    let snapshotForEach: string;
    let deployer: SignerWithAddress;
    let investor: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
    before(async function () {
        this.timeout(1200000);
        snapshot = await TimeUtils.snapshot();
        const signers = await ethers.getSigners();
        deployer = signers[0];
        investor = signers[0];
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
    describe("borrow", () => {
        describe("Good paths", () => {
            describe("Modest amounts", () => {
                describe("DAI-18 : matic-18", () => {
                    it("should return expected values", async () => {
                        if (!await isPolygonForkInUse()) return;
                        const user = ethers.Wallet.createRandom();
                        const tetuConveterStab = ethers.Wallet.createRandom();

                        const h: AaveHelper = new AaveHelper(deployer);
                        const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(deployer);
                        const aavePoolAdapterAsTC = await AdaptersHelper.createAave3PoolAdapter(
                            await DeployerUtils.startImpersonate(tetuConveterStab.address)
                        );

                        const controller = await CoreContractsHelper.createControllerWithPrices(deployer);
                        await controller.assignBatch(
                            [await controller.tetuConverterKey()]
                            , [tetuConveterStab.address]
                        );

                        const aavePool = await AaveHelper.getAavePool(deployer);
                        const dp = await AaveHelper.getAaveProtocolDataProvider(deployer);

                        const collateralAsset = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"; //dai
                        const collateralHolder = "0xf04adbf75cdfc5ed26eea4bbbb991db002036bdd"; //dai holder
                        const collateralToken = IERC20Extended__factory.connect(collateralAsset, deployer);
                        const collateralDecimals = await collateralToken.decimals();
                        const collateralAmount = getBigNumberFrom(100_000, collateralDecimals);
                        await collateralToken
                            .connect(await DeployerUtils.startImpersonate(collateralHolder))
                            .transfer(investor.address, collateralAmount);

                        const borrowAsset = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"; //matic
                        const borrowToken = IERC20Extended__factory.connect(borrowAsset, deployer);
                        const borrowDecimals = await borrowToken.decimals();
                        const borrowAmount = getBigNumberFrom(10, borrowDecimals);

                        const pi = await aavePlatformAdapter.getPoolInfo(aavePool.address, collateralAsset, borrowAsset);
                        console.log(pi);

                        await collateralToken.transfer(aavePoolAdapterAsTC.address, collateralAmount);
                        await aavePoolAdapterAsTC.initialize(
                            controller.address,
                            aavePool.address,
                            user.address,
                            collateralAsset,
                            borrowAsset
                        );
                        await aavePoolAdapterAsTC.sync();
                        await aavePoolAdapterAsTC.borrow(
                            collateralAmount,
                            borrowAmount,
                            user.address
                        );

                        const ret = await aavePool.getUserAccountData(aavePoolAdapterAsTC.address);

                        const sret = [
                            await borrowToken.balanceOf(user.address),
                            ret.totalCollateralBase,
                            ret.totalDebtBase
                        ].map(x => BalanceUtils.toString(x)).join();

                        const sexpected = [
                            borrowAmount,
                            0,
                            0,
                        ].map(x => BalanceUtils.toString(x)).join();

                        expect(sret).eq(sexpected);
                    });
                });
                describe("", () => {
                    it("should return expected values", async () => {
                        it("", async () => {
                            expect.fail("TODO");
                        });
                    });
                });
            });
            describe("Extreme amounts", () => {
                describe("DAI : matic", () => {
                    it("should return expected values", async () => {
                        expect.fail("TODO");                    });
                });
                describe("", () => {
                    it("should return expected values", async () => {
                        it("", async () => {
                            expect.fail("TODO");
                        });
                    });
                });
            });
        });
        describe("Bad paths", () => {
            describe("Not borrowable", () => {
                it("", async () =>{
                    expect.fail("TODO");
                });
            });
            describe("Not usable as collateral", () => {
                it("", async () =>{
                    expect.fail("TODO");
                });
            });
        });

    });

//endregion Unit tests

});