import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {AdaptersHelper} from "../../../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {BalanceUtils} from "../../../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {AaveTwoHelper} from "../../../../../scripts/integration/helpers/AaveTwoHelper";
import {AprUtils} from "../../../../baseUT/utils/aprUtils";
import {CoreContractsHelper} from "../../../../baseUT/helpers/CoreContractsHelper";
import {IERC20__factory, IERC20Extended__factory} from "../../../../../typechain";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {areAlmostEqual} from "../../../../baseUT/utils/CommonUtils";

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
            const controller = await CoreContractsHelper.createController(deployer);
            const templateAdapterNormalStub = ethers.Wallet.createRandom();

            const aavePool = await AaveTwoHelper.getAavePool(deployer);
            const aavePlatformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
                deployer,
                controller.address,
                aavePool.address,
                templateAdapterNormalStub.address,
            );

            const dp = await AaveTwoHelper.getAaveProtocolDataProvider(deployer);

            const collateralAssetData = await AaveTwoHelper.getReserveInfo(deployer, aavePool, dp, collateralAsset);
            const borrowAssetData = await AaveTwoHelper.getReserveInfo(deployer, aavePool, dp, borrowAsset);

            const ret = await aavePlatformAdapter.getConversionPlan(collateralAsset, borrowAsset, 0);

            const sret = [
                ret.aprPerBlock18,
                ret.ltv18,
                ret.liquidationThreshold18,
                ret.maxAmountToBorrowBT,
                ret.maxAmountToSupplyCT,
            ].map(x => BalanceUtils.toString(x)) .join("\n");

            const sexpected = [
                AprUtils.aprPerBlock18(BigNumber.from(borrowAssetData.data.currentVariableBorrowRate)),
                BigNumber.from(borrowAssetData.data.ltv
                )
                    .mul(getBigNumberFrom(1, 18))
                    .div(getBigNumberFrom(1, 4)),
                BigNumber.from(collateralAssetData.data.liquidationThreshold
                )
                    .mul(getBigNumberFrom(1, 18))
                    .div(getBigNumberFrom(1, 4)),
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

    describe("getBorrowRateAfterBorrow", () => {
        describe("Good paths", () => {
            async function makeTest(
              collateralAsset: string,
              borrowAsset: string,
              collateralHolders: string[],
              part10000: number
            ) : Promise<{sret: string, sexpected: string}> {
                console.log(`collateral ${collateralAsset} borrow ${borrowAsset}`);

                const controller = await CoreContractsHelper.createController(deployer);
                const templateAdapterNormalStub = ethers.Wallet.createRandom();

                const aavePool = await AaveTwoHelper.getAavePool(deployer);
                const aavePlatformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
                  deployer,
                  controller.address,
                  aavePool.address,
                  templateAdapterNormalStub.address,
                );

                // get available liquidity
                // we are going to borrow given part of the liquidity
                //                 [available liquidity] * percent100 / 100
                const dp = await AaveTwoHelper.getAaveProtocolDataProvider(deployer);
                const reserveDataBefore = await dp.getReserveData(borrowAsset);
                console.log(`Reserve data before: availableLiquidity=${reserveDataBefore.availableLiquidity} totalStableDebt=${reserveDataBefore.totalStableDebt} totalVariableDebt=${reserveDataBefore.totalVariableDebt}`);

                const amountToBorrow = reserveDataBefore.availableLiquidity.mul(part10000).div(10000);
                console.log(`Try to borrow ${amountToBorrow.toString()}`);

                // we assume, that total amount of collateral on holders accounts should be enough to borrow required amount
                for (const h of collateralHolders) {
                    const cAsH = IERC20Extended__factory.connect(collateralAsset
                      , await DeployerUtils.startImpersonate(h));
                    await cAsH.transfer(deployer.address, await cAsH.balanceOf(h) );
                }
                const collateralAmount = await IERC20Extended__factory.connect(collateralAsset, deployer)
                  .balanceOf(deployer.address);
                console.log(`Collateral balance ${collateralAmount}`);

                // before borrow
                const dataBefore = await AaveTwoHelper.getReserveInfo(deployer, aavePool, dp, borrowAsset);
                const brBefore = dataBefore.data.currentVariableBorrowRate;
                const brPredicted = await aavePlatformAdapter.getBorrowRateAfterBorrow(
                  borrowAsset
                  , amountToBorrow
                );
                console.log(`Current borrow rate ${brBefore.toString()} predicted ${brPredicted.toString()}`);
                console.log(`ReserveInterestRateStrategy ${dataBefore.data.interestRateStrategyAddress}`);
                console.log(`AToken address ${dataBefore.data.aTokenAddress}`);

                // supply collateral
                await IERC20Extended__factory.connect(collateralAsset, deployer).approve(aavePool.address, collateralAmount);
                console.log(`Supply collateral ${collateralAsset} amount ${collateralAmount}`);
                await aavePool.deposit(collateralAsset, collateralAmount, deployer.address, 0);
                const userAccountData = await aavePool.getUserAccountData(deployer.address);
                console.log(`Available borrow base ${userAccountData.availableBorrowsETH}`);
                await aavePool.setUserUseReserveAsCollateral(collateralAsset, true);

                // balance of the borrow asset before the borrow
                const borrowBalanceOfAToken = await IERC20__factory.connect(borrowAsset, deployer)
                  .balanceOf(dataBefore.aTokenAddress);
                console.log(`AToken has borrow asset: ${borrowBalanceOfAToken}`);

                // borrow
                console.log(`borrow ${borrowAsset} amount ${amountToBorrow}`);
                await aavePool.borrow(borrowAsset, amountToBorrow, 2, 0, deployer.address);

                const dataAfter = await AaveTwoHelper.getReserveInfo(deployer, aavePool, dp, borrowAsset);
                const brAfter = BigNumber.from(dataAfter.data.currentVariableBorrowRate);
                console.log(`Borrow rate after borrow ${brAfter.toString()}`);

                const reserveDataAfter = await dp.getReserveData(borrowAsset);
                console.log(`Reserve data after: totalAToken=${reserveDataAfter.availableLiquidity} totalStableDebt=${reserveDataAfter.totalStableDebt} totalVariableDebt=${reserveDataAfter.totalVariableDebt}`);

                const brPredictedAfter = await aavePlatformAdapter.getBorrowRateAfterBorrow(borrowAsset, 0);
                console.log(`brPredictedAfter: ${brPredictedAfter}`);

                const sret = areAlmostEqual(brAfter, brPredicted, 5) ? "1" : "0";
                const sexpected = "1";

                return {sret, sexpected};
            }

            describe("small amount", () => {
                it("Predicted borrow rate should be same to real rate after the borrow", async () => {
                    const collateralAsset = MaticAddresses.DAI;
                    const borrowAsset = MaticAddresses.USDC;
                    const collateralHolders = [
                        MaticAddresses.HOLDER_DAI,
                        MaticAddresses.HOLDER_DAI_2,
                        MaticAddresses.HOLDER_DAI_3,
                        MaticAddresses.HOLDER_DAI_4,
                        MaticAddresses.HOLDER_DAI_5,
                        MaticAddresses.HOLDER_DAI_6,
                    ];
                    const part10000 = 1;

                    const ret = await makeTest(collateralAsset, borrowAsset, collateralHolders, part10000);

                    expect(ret.sret).eq(ret.sexpected);
                });
            });

            describe("Huge amount", () => {
                it("Predicted borrow rate should be same to real rate after the borrow", async () => {
                    const collateralAsset = MaticAddresses.DAI;
                    const borrowAsset = MaticAddresses.USDC;
                    const collateralHolders = [
                        MaticAddresses.HOLDER_DAI,
                        MaticAddresses.HOLDER_DAI_2,
                        MaticAddresses.HOLDER_DAI_3,
                        MaticAddresses.HOLDER_DAI_4,
                        MaticAddresses.HOLDER_DAI_5,
                        MaticAddresses.HOLDER_DAI_6,
                    ];
                    const part10000 = 500;

                    const ret = await makeTest(collateralAsset, borrowAsset, collateralHolders, part10000);

                    expect(ret.sret).eq(ret.sexpected);
                });
            });
        });

    });
//endregion Unit tests

});