import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
    IERC20Extended, IHfCToken__factory
} from "../../../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {AdaptersHelper} from "../../../../baseUT/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/NetworkUtils";
import {AaveHelper} from "../../../../../scripts/integration/helpers/AaveHelper";
import {BalanceUtils} from "../../../../baseUT/BalanceUtils";
import {HundredFinanceHelper} from "../../../../../scripts/integration/helpers/HundredFinanceHelper";

describe("Hundred finance integration tests, platform adapter", () => {
//region Constants
    /** https://docs.hundred.finance/developers/protocol-contracts/polygon */
    const hundredFinanceComptroller = "0xEdBA32185BAF7fEf9A26ca567bC4A6cbe426e499";

    const DAI = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
    const USDC = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";

    const hETH = "0x243E33aa7f6787154a8E59d3C27a66db3F8818ee";
    const hDAI = "0xE4e43864ea18d5E5211352a4B810383460aB7fcC";
    const hUSDC = "0x607312a5C671D0C511998171e634DE32156e69d0";
    const hUSDT = "0x103f2CA2148B863942397dbc50a425cc4f4E9A27";
    const hMATIC = "0xEbd7f3349AbA8bB15b897e03D6c1a4Ba95B55e31";
    const hWBTC = "0xb4300e088a3AE4e624EE5C71Bc1822F68BB5f2bc";
    const hFRAX = "0x2c7a9d9919f042C4C120199c69e126124d09BE7c";
    const hLINK = "0x5B9451B1bFAE2A74D7b9D0D45BdD0E9a27F7bB22";

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
    describe("getConversionPlan", () => {
        async function makeTest(
            collateralAsset: string,
            borrowAsset: string,
            cTokenCollateral: string,
            cTokenBorrow: string
        ) : Promise<{sret: string, sexpected: string}> {
            const controllerStub = ethers.Wallet.createRandom();
            const templateAdapterNormalStub = ethers.Wallet.createRandom();

            const comptroller = await HundredFinanceHelper.getComptroller(deployer);
            const hfPlatformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
                deployer,
                controllerStub.address,
                comptroller.address,
                templateAdapterNormalStub.address,
                [cTokenCollateral, cTokenBorrow]
            );

            const dp = await AaveHelper.getAaveProtocolDataProvider(deployer);

            const collateralAssetData = await HundredFinanceHelper.getCTokenData(deployer, comptroller
                , IHfCToken__factory.connect(cTokenCollateral, deployer)
            );
            const borrowAssetData = await HundredFinanceHelper.getCTokenData(deployer, comptroller
                , IHfCToken__factory.connect(cTokenBorrow, deployer));

            const ret = await hfPlatformAdapter.getConversionPlan(collateralAsset, borrowAsset);

            const sret = [
                ret.borrowRateKind,
                ret.borrowRate,
                ret.ltvWAD,
                ret.liquidationThreshold18,
                ret.maxAmountToBorrowBT,
                ret.maxAmountToSupplyCT,
            ].map(x => BalanceUtils.toString(x)) .join();

            const sexpected = [
                1, // per block
                borrowAssetData.borrowRatePerBlock,
                borrowAssetData.collateralFactorMantissa,
                borrowAssetData.collateralFactorMantissa,
                borrowAssetData.cash,
                0
            ].map(x => BalanceUtils.toString(x)) .join();

            return {sret, sexpected};
        }
        describe("Good paths", () => {
            describe("DAI : usdc", () => {
                it("should return expected values", async () => {
                    if (!await isPolygonForkInUse()) return;

                    const collateralAsset = DAI;
                    const borrowAsset = USDC;
                    const collateralCToken = hDAI;
                    const borrowCToken = hUSDC;

                    const r = await makeTest(
                        collateralAsset,
                        borrowAsset,
                        collateralCToken,
                        borrowCToken
                    );

                    expect(r.sret).eq(r.sexpected);
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
            });
        });
    });

//endregion Unit tests

});