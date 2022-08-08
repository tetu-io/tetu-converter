import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
    IHfCToken__factory
} from "../../../../../typechain";
import {expect} from "chai";
import {AdaptersHelper} from "../../../../baseUT/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/NetworkUtils";
import {Aave3Helper} from "../../../../../scripts/integration/helpers/Aave3Helper";
import {BalanceUtils} from "../../../../baseUT/BalanceUtils";
import {HundredFinanceHelper} from "../../../../../scripts/integration/helpers/HundredFinanceHelper";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";

describe("Hundred finance integration tests, platform adapter", () => {
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
                [cTokenCollateral, cTokenBorrow],
                MaticAddresses.HUNDRED_FINANCE_ORACLE
            );

            const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);

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

                    const collateralAsset = MaticAddresses.DAI;
                    const borrowAsset = MaticAddresses.USDC;
                    const collateralCToken = MaticAddresses.hDAI;
                    const borrowCToken = MaticAddresses.hUSDC;

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