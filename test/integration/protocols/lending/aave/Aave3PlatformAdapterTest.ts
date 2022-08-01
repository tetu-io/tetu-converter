import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
    IERC20Extended
} from "../../../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {AdaptersHelper} from "../../../../baseUT/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/NetworkUtils";
import {AaveHelper} from "../../../../../scripts/integration/helpers/AaveHelper";
import {BalanceUtils} from "../../../../baseUT/BalanceUtils";

describe("Aave-v3 integration tests, platform adapter", () => {
//region Constants
    /** https://docs.aave.com/developers/deployed-contracts/v3-mainnet/polygon */
    const aavePoolV3 = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";

    const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
    const usdcHolder = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245';

    const daiAddress = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063';
    const daiHolder = "0xf04adbf75cdfc5ed26eea4bbbb991db002036bdd";

    const eursAddress = '0xE111178A87A3BFf0c8d18DECBa5798827539Ae99';
    const eursHolder = "TODO";

    /** All available markets are here: https://app-v3.aave.com/markets/ */

    /** This token can be used as collateral but cannot be borrowed */
    const aaveAddress = "0xD6DF932A45C0f255f85145f286eA0b292B21C90B";

    /**
     * Tether assets cannot be used as collateral
     * https://app-v3.aave.com/reserve-overview/?underlyingAsset=0xdac17f958d2ee523a2206206994597c13d831ec7&marketName=proto_mainnet
     * */
    const usdTetherAddress_IsolationModeOnly = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";

    /**
     * jEUR cannot be used as collateral
     * https://app-v3.aave.com/reserve-overview/?underlyingAsset=0x4e3decbb3645551b8a19f0ea1678079fcb33fb4c&marketName=proto_polygon_v3
     */
    const jEUR_NotCollateral = "0x4e3Decbb3645551B8A19f0eA1678079FCB33fB4c";

    const wmaticAddress = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";

//endregion Constants

//region Global vars for all tests
    let snapshot: string;
    let snapshotForEach: string;
    let deployer: SignerWithAddress;
    let investor: SignerWithAddress;

    let usdc: IERC20Extended;
    let dai: IERC20Extended;
    let wmatic: IERC20Extended;
//endregion Global vars for all tests

//region before, after
    before(async function () {
        this.timeout(1200000);
        snapshot = await TimeUtils.snapshot();
        const signers = await ethers.getSigners();
        deployer = signers[0];
        investor = signers[0];

        usdc = (await ethers.getContractAt(
            'contracts/integrations/IERC20Extended.sol:IERC20Extended',
            usdcAddress
        )) as IERC20Extended;

        dai = (await ethers.getContractAt(
            'contracts/integrations/IERC20Extended.sol:IERC20Extended',
            daiAddress
        )) as IERC20Extended;
    });

    after(async function () {
        await TimeUtils.rollback(snapshot);
    });

    beforeEach(async function () {
        snapshotForEach = await TimeUtils.snapshot();

        await usdc
            .connect(await DeployerUtils.startImpersonate(usdcHolder))
            .transfer(
                investor.address,
                BigNumber.from(100_000).mul(BigNumber.from(10).pow(await usdc.decimals()))
            );

        await dai
            .connect(await DeployerUtils.startImpersonate(daiHolder))
            .transfer(
                investor.address,
                BigNumber.from(100_000).mul(BigNumber.from(10).pow(await dai.decimals()))
            );
    });

    afterEach(async function () {
        await TimeUtils.rollback(snapshotForEach);
    });
//endregion before, after

//region Unit tests
    describe("getConversionPlan", () => {
        async function makeTest(
            collateralAsset: string,
            borrowAsset: string,
            highEfficientModeEnabled: boolean,
            isolationModeEnabled: boolean
        ) : Promise<{sret: string, sexpected: string}> {
            const controllerStub = ethers.Wallet.createRandom();
            const templateAdapterNormalStub = ethers.Wallet.createRandom();
            const templateAdapterEModeStub = ethers.Wallet.createRandom();

            const h: AaveHelper = new AaveHelper(deployer);
            const aavePool = await AaveHelper.getAavePool(deployer);
            const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
                deployer,
                controllerStub.address,
                aavePool.address,
                templateAdapterNormalStub.address,
                templateAdapterEModeStub.address
            );

            const dp = await AaveHelper.getAaveProtocolDataProvider(deployer);

            const collateralAssetData = await h.getReserveInfo(deployer, aavePool, dp, collateralAsset);
            const borrowAssetData = await h.getReserveInfo(deployer, aavePool, dp, borrowAsset);

            const ret = await aavePlatformAdapter.getConversionPlan(collateralAsset, borrowAsset);

            const sret = [
                ret.borrowRateKind,
                ret.borrowRate,
                ret.ltvWAD,
                ret.liquidationThreshold18,
                ret.maxAmountToBorrowBT,
                ret.maxAmountToSupplyCT,
                // ensure that high efficiency mode is not available
                highEfficientModeEnabled
                    ? collateralAssetData.data.emodeCategory != 0
                      && borrowAssetData.data.emodeCategory == collateralAssetData.data.emodeCategory
                    : collateralAssetData.data.emodeCategory == 0 || borrowAssetData.data.emodeCategory == 0,
            ].map(x => BalanceUtils.toString(x)) .join();

            const sexpected = [
                2, // per second
                BigNumber.from(borrowAssetData.data.currentVariableBorrowRate)
                    .mul(getBigNumberFrom(1, 18))
                    .div(getBigNumberFrom(1, 27)),
                BigNumber.from(highEfficientModeEnabled
                    ? borrowAssetData.category?.ltv
                    : borrowAssetData.data.ltv
                )
                    .mul(getBigNumberFrom(1, 18))
                    .div(getBigNumberFrom(1, 5)),
                BigNumber.from(highEfficientModeEnabled
                    ? borrowAssetData.category?.liquidationThreshold
                    : borrowAssetData.data.liquidationThreshold
                )
                    .mul(getBigNumberFrom(1, 18))
                    .div(getBigNumberFrom(1, 5)),
                BigNumber.from(borrowAssetData.liquidity.totalAToken)
                    .sub(borrowAssetData.liquidity.totalVariableDebt)
                    .sub(borrowAssetData.liquidity.totalStableDebt),
                collateralAssetData.data.supplyCap,
                true,
            ].map(x => BalanceUtils.toString(x)) .join();

            return {sret, sexpected};
        }
        describe("Good paths", () => {
            describe("DAI : matic", () => {
                it("should return expected values", async () => {
                    if (!await isPolygonForkInUse()) return;

                    const collateralAsset = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"; //dai
                    const borrowAsset = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"; //matic

                    const r = await makeTest(
                        collateralAsset,
                        borrowAsset,
                        false,
                        false
                    );

                    expect(r.sret).eq(r.sexpected);
                });
            });
            describe("Isolation mode is enabled for collateral, borrow token is borrowable", () => {
                describe("STASIS EURS-2 : Tether USD", () => {
                    it("", async () =>{
                        if (!await isPolygonForkInUse()) return;

                        const collateralAsset = "0xE111178A87A3BFf0c8d18DECBa5798827539Ae99"; // STASIS EURS
                        const borrowAsset = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"; // Tether USD

                        const r = await makeTest(
                            collateralAsset,
                            borrowAsset,
                            true,
                            false
                        );

                        expect(r.sret).eq(r.sexpected);
                    });
                });
            });
            describe("Two assets from category 1", () => {
                it("should return values for high efficient mode", async () => {
                    it("should return expected values", async () =>{
                        if (!await isPolygonForkInUse()) return;

                        const collateralAsset = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"; //dai
                        const borrowAsset = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; //usdc

                        const r = await makeTest(
                            collateralAsset,
                            borrowAsset,
                            true,
                            false
                        );

                        expect(r.sret).eq(r.sexpected);
                    });
                });
            });
            describe("Borrow cap > available liquidity to borrow", () => {
                it("should return expected values", async () => {
                    it("", async () =>{
                        expect.fail("TODO");
                    });
                });
            });
            describe("Supply cap not 0", () => {
                it("should return expected values", async () => {
                    it("", async () =>{
                        expect.fail("TODO");
                    });
                });
            });
            describe("Borrow exists, AAVE changes parameters of the reserve, make new borrow", () => {
                it("TODO", async () => {
                    it("", async () =>{
                        expect.fail("TODO");
                    });
                });
            });
        });
        describe("Bad paths", () => {
            describe("inactive", () => {
                describe("collateral token is inactive", () => {
                    it("", async () =>{
                        expect.fail("TODO");
                    });
                });
                describe("borrow token is inactive", () => {
                    it("", async () =>{
                        expect.fail("TODO");
                    });
                });
            });
            describe("paused", () => {
                describe("collateral token is paused", () => {
                    it("", async () =>{
                        expect.fail("TODO");
                    });
                });
                describe("borrow token is paused", () => {
                    it("", async () =>{
                        expect.fail("TODO");
                    });
                });
            });
            describe("Borrow token is frozen", () => {
                describe("collateral token is frozen", () => {
                    it("", async () =>{
                        expect.fail("TODO");
                    });
                });
                describe("borrow token is frozen", () => {
                    it("", async () =>{
                        expect.fail("TODO");
                    });
                });
            });
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
            describe("Isolation mode is enabled for collateral, borrow token is not borrowable", () => {
                describe("STASIS EURS-2 : SushiToken (PoS)", () => {
                    it("", async () =>{
                        expect.fail("TODO");
                    });
                });
            });
        });

    });

//endregion Unit tests

});