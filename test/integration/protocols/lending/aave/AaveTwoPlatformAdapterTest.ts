import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {AdaptersHelper} from "../../../../baseUT/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/NetworkUtils";
import {BalanceUtils} from "../../../../baseUT/BalanceUtils";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {AaveTwoHelper} from "../../../../../scripts/integration/helpers/AaveTwoHelper";

describe("Aave-v2 integration tests, platform adapter", () => {
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
            borrowAsset: string
        ) : Promise<{sret: string, sexpected: string}> {
            const controllerStub = ethers.Wallet.createRandom();
            const templateAdapterNormalStub = ethers.Wallet.createRandom();

            const aavePool = await AaveTwoHelper.getAavePool(deployer);
            const aavePlatformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
                deployer,
                controllerStub.address,
                aavePool.address,
                templateAdapterNormalStub.address,
            );

            const dp = await AaveTwoHelper.getAaveProtocolDataProvider(deployer);

            const collateralAssetData = await AaveTwoHelper.getReserveInfo(deployer, aavePool, dp, collateralAsset);
            const borrowAssetData = await AaveTwoHelper.getReserveInfo(deployer, aavePool, dp, borrowAsset);

            const ret = await aavePlatformAdapter.getConversionPlan(collateralAsset, borrowAsset);

            const sret = [
                ret.borrowRateKind,
                ret.borrowRate,
                ret.ltv18,
                ret.liquidationThreshold18,
                ret.maxAmountToBorrowBT,
                ret.maxAmountToSupplyCT,
            ].map(x => BalanceUtils.toString(x)) .join("\n");

            const sexpected = [
                2, // per second
                BigNumber.from(borrowAssetData.data.currentVariableBorrowRate)
                    .mul(getBigNumberFrom(1, 18))
                    .div(getBigNumberFrom(1, 27)),
                BigNumber.from(borrowAssetData.data.ltv
                )
                    .mul(getBigNumberFrom(1, 18))
                    .div(getBigNumberFrom(1, 5)),
                BigNumber.from(collateralAssetData.data.liquidationThreshold
                )
                    .mul(getBigNumberFrom(1, 18))
                    .div(getBigNumberFrom(1, 5)),
                BigNumber.from(borrowAssetData.liquidity.availableLiquidity),
                BigNumber.from(2).pow(256).sub(1), // === type(uint).max
            ].map(x => BalanceUtils.toString(x)) .join("\n");

            return {sret, sexpected};
        }
        describe("Good paths", () => {
            describe("DAI : matic", () => {
                it("should return expected values", async () => {
                    if (!await isPolygonForkInUse()) return;

                    const collateralAsset = MaticAddresses.DAI;
                    const borrowAsset = MaticAddresses.WMATIC;

                    const r = await makeTest(collateralAsset, borrowAsset);

                    expect(r.sret).eq(r.sexpected);
                });
            });
            describe("WMATIC: USDT", () => {
                it("should return expected values", async () =>{
                    if (!await isPolygonForkInUse()) return;

                    const collateralAsset = MaticAddresses.WMATIC;
                    const borrowAsset = MaticAddresses.USDT;

                    const r = await makeTest(collateralAsset, borrowAsset);

                    expect(r.sret).eq(r.sexpected);
                });
            });
            describe("DAI:USDC", () => {
                it("should return expected values", async () => {
                    if (!await isPolygonForkInUse()) return;

                    const collateralAsset = MaticAddresses.DAI;
                    const borrowAsset = MaticAddresses.USDC;

                    const r = await makeTest(collateralAsset, borrowAsset);

                    expect(r.sret).eq(r.sexpected);
                });
            });
            describe("CRV:BALANCER", () => {
                it("should return expected values", async () => {
                    if (!await isPolygonForkInUse()) return;

                    const collateralAsset = MaticAddresses.CRV;
                    const borrowAsset = MaticAddresses.BALANCER;

                    const r = await makeTest(collateralAsset, borrowAsset);

                    expect(r.sret).eq(r.sexpected);
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
        });

    });

//endregion Unit tests

});