import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
    IERC20Extended, IERC20Extended__factory
} from "../../../../../typechain";
import {expect, use} from "chai";
import {BigNumber, BigNumberish} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {AdaptersHelper} from "../../../../baseUT/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/NetworkUtils";
import {AaveHelper} from "../../../../../scripts/integration/helpers/AaveHelper";
import {BalanceUtils} from "../../../../baseUT/BalanceUtils";
import {CoreContractsHelper} from "../../../../baseUT/CoreContractsHelper";
import {TokenWrapper} from "../../../../baseUT/TokenWrapper";

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
        async function makeTest(
            collateralToken: TokenWrapper,
            collateralHolder: string,
            collateralAmount: BigNumber,
            borrowToken: TokenWrapper,
            borrowAmount: BigNumber
        ) : Promise<{sret: string, sexpected: string}>{
            const user = ethers.Wallet.createRandom();
            const tetuConveterStab = ethers.Wallet.createRandom();

            // initialize pool, adapters and helper for the adapters
            const h: AaveHelper = new AaveHelper(deployer);
            //const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(deployer);
            const aavePoolAdapterAsTC = await AdaptersHelper.createAave3PoolAdapter(
                await DeployerUtils.startImpersonate(tetuConveterStab.address)
            );
            const aavePool = await AaveHelper.getAavePool(deployer);
            const dp = await AaveHelper.getAaveProtocolDataProvider(deployer);
            const aavePrices = await AaveHelper.getAavePriceOracle(deployer);

            // controller: we need TC (as a caller) and DM (to register borrow position)
            const controller = await CoreContractsHelper.createControllerWithPrices(deployer);
            await controller.assignBatch(
                [await controller.tetuConverterKey()]
                , [tetuConveterStab.address]
            );


            // collateral asset
            await collateralToken.token
                .connect(await DeployerUtils.startImpersonate(collateralHolder))
                .transfer(investor.address, collateralAmount);
            const collateralData = await h.getReserveInfo(deployer, aavePool, dp, collateralToken.address);

            // make borrow
            await collateralToken.token.transfer(aavePoolAdapterAsTC.address, collateralAmount);
            await aavePoolAdapterAsTC.initialize(
                controller.address,
                aavePool.address,
                user.address,
                collateralToken.address,
                borrowToken.address
            );
            await aavePoolAdapterAsTC.sync();
            await aavePoolAdapterAsTC.borrow(
                collateralAmount,
                borrowAmount,
                user.address
            );

            // prices of assets in base currency
            const prices = await aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);

            // check results
            const ret = await aavePool.getUserAccountData(aavePoolAdapterAsTC.address);

            const sret = [
                await borrowToken.token.balanceOf(user.address),
                await IERC20Extended__factory.connect(collateralData.data.aTokenAddress, deployer)
                    .balanceOf(aavePoolAdapterAsTC.address),
                ret.totalCollateralBase,
                ret.totalDebtBase
            ].map(x => BalanceUtils.toString(x)).join();


            const sexpected = [
                borrowAmount, // borrowed amount on user's balance
                collateralAmount, // amount of collateral tokens on pool-adapter's balance
                collateralAmount.mul(prices[0])  // registered collateral in the pool
                    .div(getBigNumberFrom(1, collateralToken.decimals)),
                borrowAmount.mul(prices[1]) // registered debt in the pool
                    .div(getBigNumberFrom(1, borrowToken.decimals)),
            ].map(x => BalanceUtils.toString(x)).join();

            return {sret, sexpected};
        }
        describe("Good paths", () => {
            describe("Borrow modest amount", () => {
                describe("DAI-18 : matic-18", () => {
                    it("should return expected balances", async () => {
                        if (!await isPolygonForkInUse()) return;

                        const collateralAsset = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"; //dai
                        const collateralHolder = "0xf04adbf75cdfc5ed26eea4bbbb991db002036bdd"; //dai holder
                        const borrowAsset = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"; //matic

                        const collateralToken = await TokenWrapper.Build(deployer, collateralAsset);
                        const borrowToken = await TokenWrapper.Build(deployer, borrowAsset);

                        const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
                        const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

                        const r = await makeTest(
                            collateralToken
                            , collateralHolder
                            , collateralAmount
                            , borrowToken
                            , borrowAmount
                        );
                        expect(r.sret).eq(r.sexpected);
                    });
                });
                describe("DAI-18 : USDC-6", () => {
                    it("should return expected balances", async () => {
                        if (!await isPolygonForkInUse()) return;

                        const collateralAsset = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"; //dai
                        const collateralHolder = "0xf04adbf75cdfc5ed26eea4bbbb991db002036bdd"; //dai holder
                        const borrowAsset = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; //usdc

                        const collateralToken = await TokenWrapper.Build(deployer, collateralAsset);
                        const borrowToken = await TokenWrapper.Build(deployer, borrowAsset);

                        const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
                        const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

                        const r = await makeTest(
                            collateralToken
                            , collateralHolder
                            , collateralAmount
                            , borrowToken
                            , borrowAmount
                        );
                        expect(r.sret).eq(r.sexpected);
                    });
                });
                describe("STASIS EURS-2 : Tether-6", () => {
                    it("should return expected balances", async () => {
                        if (!await isPolygonForkInUse()) return;

                        const collateralAsset = "0xE111178A87A3BFf0c8d18DECBa5798827539Ae99"; // STASIS EURS
                        const collateralHolder = "0x6de2865067b65d4571c17f6b9eeb8dbdd5e36584"; // STASIS EURS holder
                        const borrowAsset = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"; // Tether

                        const collateralToken = await TokenWrapper.Build(deployer, collateralAsset);
                        const borrowToken = await TokenWrapper.Build(deployer, borrowAsset);

                        const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
                        const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

                        const r = await makeTest(
                            collateralToken
                            , collateralHolder
                            , collateralAmount
                            , borrowToken
                            , borrowAmount
                        );
                        expect(r.sret).eq(r.sexpected);
                    });
                });
                describe("USDC-6 : DAI-18", () => {
                    it("should return expected balances", async () => {
                        if (!await isPolygonForkInUse()) return;

                        const collateralAsset = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; //usdc
                        const collateralHolder = "0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245"; //usdc holder
                        const borrowAsset = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"; //dai

                        const collateralToken = await TokenWrapper.Build(deployer, collateralAsset);
                        const borrowToken = await TokenWrapper.Build(deployer, borrowAsset);

                        const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
                        const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

                        const r = await makeTest(
                            collateralToken
                            , collateralHolder
                            , collateralAmount
                            , borrowToken
                            , borrowAmount
                        );
                        expect(r.sret).eq(r.sexpected);
                    });
                });
            });
            describe("Borrow extremely huge amount", () => {
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