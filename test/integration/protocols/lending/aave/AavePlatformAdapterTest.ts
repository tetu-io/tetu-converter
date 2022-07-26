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

describe("Aave integration tests, platform adapter", () => {
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
    describe("getPoolInfo", () => {
        describe("Good paths", () => {
            describe("Get USDC info", () => {
                it("should return expected values", async () => {
                    if (!await isPolygonForkInUse()) return;

                    const aavePlatformAdapter = await AdaptersHelper.createAavePlatformAdapter(deployer);

                    // Following data can be changed in time
                    // https://app-v3.aave.com/reserve-overview/?underlyingAsset=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48&marketName=proto_mainnet
                    const liquidationThreshold = 82.50;
                    const totalSupplied = 1.21e9;
                    const apyVariable = 1.56;

                    const ret = await aavePlatformAdapter.getPoolInfo(aavePoolV3, usdcAddress);
                    const sret = [
                        ethers.utils.formatUnits(ret.collateralFactor.mul(100))
                    ].join();

                    const sexpected = [
                        ethers.utils.formatUnits(getBigNumberFrom(liquidationThreshold * 100, 16))
                    ].join();

                    expect(sret).equal(sexpected);
                });
            });
        });
        describe("Bad paths", () => {

        });

    });

//endregion Unit tests

});