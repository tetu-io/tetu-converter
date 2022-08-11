import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
    IAaveToken__factory,
    IERC20Extended
} from "../../../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {AdaptersHelper} from "../../../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {Aave3Helper} from "../../../../../scripts/integration/helpers/Aave3Helper";
import {BalanceUtils} from "../../../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {AprUtils} from "../../../../baseUT/utils/aprUtils";
import {CoreContractsHelper} from "../../../../baseUT/helpers/CoreContractsHelper";

describe("Aave-v3 integration tests, platform adapter", () => {
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
            highEfficientModeEnabled: boolean,
            isolationModeEnabled: boolean
        ) : Promise<{sret: string, sexpected: string}> {
            const controller = await CoreContractsHelper.createController(deployer);
            const templateAdapterNormalStub = ethers.Wallet.createRandom();
            const templateAdapterEModeStub = ethers.Wallet.createRandom();

            const h: Aave3Helper = new Aave3Helper(deployer);
            const aavePool = await Aave3Helper.getAavePool(deployer);
            const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
                deployer,
                controller.address,
                aavePool.address,
                templateAdapterNormalStub.address,
                templateAdapterEModeStub.address
            );

            const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);

            const collateralAssetData = await h.getReserveInfo(deployer, aavePool, dp, collateralAsset);
            const borrowAssetData = await h.getReserveInfo(deployer, aavePool, dp, borrowAsset);

            const ret = await aavePlatformAdapter.getConversionPlan(collateralAsset, borrowAsset);

            const sret = [
                ret.aprPerBlock18,
                ret.ltv18,
                ret.liquidationThreshold18,
                ret.maxAmountToBorrowBT,
                ret.maxAmountToSupplyCT,
                // ensure that high efficiency mode is not available
                highEfficientModeEnabled
                    ? collateralAssetData.data.emodeCategory != 0
                      && borrowAssetData.data.emodeCategory == collateralAssetData.data.emodeCategory
                    : collateralAssetData.data.emodeCategory == 0 || borrowAssetData.data.emodeCategory == 0,
            ].map(x => BalanceUtils.toString(x)) .join("\n");

            let expectedMaxAmountToSupply = BigNumber.from(2).pow(256).sub(1); // == type(uint).max
            if (! collateralAssetData.data.supplyCap.eq(0)) {
                // see sources of AAVE3\ValidationLogic.sol\validateSupply
                const totalSupply =
                    (await IAaveToken__factory.connect(collateralAssetData.aTokenAddress, deployer).scaledTotalSupply())
                        .mul(collateralAssetData.data.liquidityIndex)
                        .add(getBigNumberFrom(5, 26)) //HALF_RAY = 0.5e27
                        .div(getBigNumberFrom(1, 27)); //RAY = 1e27
                const supplyCap = collateralAssetData.data.supplyCap
                    .mul(getBigNumberFrom(1, collateralAssetData.data.decimals));
                expectedMaxAmountToSupply = supplyCap.gt(totalSupply)
                    ? supplyCap.sub(totalSupply)
                    : BigNumber.from(0);
            }

            const sexpected = [
                AprUtils.aprPerBlock18(BigNumber.from(borrowAssetData.data.currentVariableBorrowRate)),
                BigNumber.from(highEfficientModeEnabled
                    ? borrowAssetData.category?.ltv
                    : borrowAssetData.data.ltv
                )
                    .mul(getBigNumberFrom(1, 18))
                    .div(getBigNumberFrom(1, 4)),
                BigNumber.from(highEfficientModeEnabled
                    ? collateralAssetData.category?.liquidationThreshold
                    : collateralAssetData.data.liquidationThreshold
                )
                    .mul(getBigNumberFrom(1, 18))
                    .div(getBigNumberFrom(1, 4)),
                BigNumber.from(borrowAssetData.liquidity.totalAToken)
                    .sub(borrowAssetData.liquidity.totalVariableDebt)
                    .sub(borrowAssetData.liquidity.totalStableDebt),
                expectedMaxAmountToSupply,
                true,
            ].map(x => BalanceUtils.toString(x)) .join("\n");

            return {sret, sexpected};
        }
        describe("Good paths", () => {
            describe("DAI : matic", () => {
                it("should return expected values", async () => {
                    if (!await isPolygonForkInUse()) return;

                    const collateralAsset = MaticAddresses.DAI;
                    const borrowAsset = MaticAddresses.WMATIC;

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
                    it("should return expected values", async () =>{
                        if (!await isPolygonForkInUse()) return;

                        const collateralAsset = MaticAddresses.EURS;
                        const borrowAsset = MaticAddresses.USDT;

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
                    if (!await isPolygonForkInUse()) return;

                    const collateralAsset = MaticAddresses.DAI;
                    const borrowAsset = MaticAddresses.USDC;

                    const r = await makeTest(
                        collateralAsset,
                        borrowAsset,
                        true,
                        false
                    );

                    expect(r.sret).eq(r.sexpected);
                });
            });
            describe("Borrow cap > available liquidity to borrow", () => {
                it("should return expected values", async () => {
                    expect.fail("TODO");
                });
            });
            describe("Supply cap not 0", () => {
                it("should return expected values", async () => {
                    expect.fail("TODO");
                });
            });
            describe("Borrow exists, AAVE changes parameters of the reserve, make new borrow", () => {
                it("TODO", async () => {
                    expect.fail("TODO");
                });
            });
        });
        describe("Bad paths", () => {
            describe("inactive", () => {
                describe("collateral token is inactive", () => {
                    it("should revert", async () =>{
                        expect.fail("TODO");
                    });
                });
                describe("borrow token is inactive", () => {
                    it("should revert", async () =>{
                        expect.fail("TODO");
                    });
                });
            });
            describe("paused", () => {
                describe("collateral token is paused", () => {
                    it("should revert", async () =>{
                        expect.fail("TODO");
                    });
                });
                describe("borrow token is paused", () => {
                    it("should revert", async () =>{
                        expect.fail("TODO");
                    });
                });
            });
            describe("Borrow token is frozen", () => {
                describe("collateral token is frozen", () => {
                    it("should revert", async () =>{
                        expect.fail("TODO");
                    });
                });
                describe("borrow token is frozen", () => {
                    it("should revert", async () =>{
                        expect.fail("TODO");
                    });
                });
            });
            describe("Not borrowable", () => {
                it("should revert", async () =>{
                    expect.fail("TODO");
                });
            });
            describe("Not usable as collateral", () => {
                it("should revert", async () =>{
                    expect.fail("TODO");
                });
            });
            describe("Isolation mode is enabled for collateral, borrow token is not borrowable", () => {
                describe("STASIS EURS-2 : SushiToken (PoS)", () => {
                    it("should revert", async () =>{
                        expect.fail("TODO");
                    });
                });
            });
            describe("Try to supply more than allowed by supply cap", () => {
                it("should revert", async () =>{
                    expect.fail("TODO");
                });
            });
            describe("Try to borrow more than allowed by borrow cap", () => {
                it("should revert", async () =>{
                    expect.fail("TODO");
                });
            });
        });

    });

//endregion Unit tests

});