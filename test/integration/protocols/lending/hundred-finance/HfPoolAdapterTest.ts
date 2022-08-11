import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
    IERC20Extended__factory, IHfCToken__factory
} from "../../../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {AdaptersHelper} from "../../../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {BalanceUtils, IUserBalances} from "../../../../baseUT/utils/BalanceUtils";
import {CoreContractsHelper} from "../../../../baseUT/helpers/CoreContractsHelper";
import {TokenDataTypes} from "../../../../baseUT/helpers/TokenWrapper";
import {HundredFinanceHelper} from "../../../../../scripts/integration/helpers/HundredFinanceHelper";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {MocksHelper} from "../../../../baseUT/helpers/MocksHelper";

describe("Hundred Finance integration tests, pool adapter", () => {
//region Constants

//endregion Constants

//region Global vars for all tests
    let snapshot: string;
    let snapshotForEach: string;
    let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
    before(async function () {
        this.timeout(1200000);
        snapshot = await TimeUtils.snapshot();
        const signers = await ethers.getSigners();
        deployer = signers[0];
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
            collateralToken: TokenDataTypes,
            collateralCToken: TokenDataTypes,
            collateralHolder: string,
            collateralAmount: BigNumber,
            borrowToken: TokenDataTypes,
            borrowCToken: TokenDataTypes,
            borrowAmount: BigNumber
        ) : Promise<{sret: string, sexpected: string}>{
            const user = ethers.Wallet.createRandom();
            const tetuConveterStab = ethers.Wallet.createRandom();

            // controller, dm, bm
            const controller = await CoreContractsHelper.createController(deployer);
            const debtMonitor = await CoreContractsHelper.createDebtMonitor(deployer, controller);
            const borrowManager = await MocksHelper.createBorrowManagerStub(deployer, true);
            await controller.assignBatch(
                [await controller.tetuConverterKey()
                    , await controller.debtMonitorKey()
                    , await controller.borrowManagerKey()
                ]
                , [
                    tetuConveterStab.address
                    , debtMonitor.address
                    , borrowManager.address
                ]
            );

            // initialize adapters and price oracle
            const hfPoolAdapterTC = await AdaptersHelper.createHundredFinancePoolAdapter(
                await DeployerUtils.startImpersonate(tetuConveterStab.address)
            );
            const comptroller = await HundredFinanceHelper.getComptroller(deployer);
            const hfPlatformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
                deployer,
                controller.address,
                comptroller.address,
                hfPoolAdapterTC.address,
                [collateralCToken.address, borrowCToken.address],
                MaticAddresses.HUNDRED_FINANCE_ORACLE
            )
            const priceOracle = HundredFinanceHelper.getPriceOracle(deployer);

            // collateral asset
            await collateralToken.token
                .connect(await DeployerUtils.startImpersonate(collateralHolder))
                .transfer(deployer.address, collateralAmount);

            // initialize pool adapater
            await hfPoolAdapterTC.initialize(
                controller.address,
                hfPlatformAdapter.address,
                comptroller.address,
                user.address,
                collateralToken.address,
                borrowToken.address
            );

            // make borrow
            await hfPoolAdapterTC.syncBalance(true);
            await collateralToken.token.transfer(hfPoolAdapterTC.address, collateralAmount);
            await hfPoolAdapterTC.borrow(
                collateralAmount,
                borrowAmount,
                user.address
            );
            console.log(`borrow: success`);

            // tokens data
            const borrowData = await HundredFinanceHelper.getCTokenData(deployer, comptroller
                , IHfCToken__factory.connect(borrowCToken.address, deployer)
            );
            const collateralData = await HundredFinanceHelper.getCTokenData(deployer, comptroller
                , IHfCToken__factory.connect(collateralCToken.address, deployer)
            );

            // prices of assets in base currency
            // From sources: The underlying asset price mantissa (scaled by 1e18).
            // WRONG: The price of the asset in USD as an unsigned integer scaled up by 10 ^ (36 - underlying asset decimals).
            // WRONG: see https://compound.finance/docs/prices#price
            const priceCollateral = await priceOracle.getUnderlyingPrice(collateralCToken.address);
            const priceBorrow = await priceOracle.getUnderlyingPrice(borrowCToken.address);
            console.log("priceCollateral", priceCollateral);
            console.log("priceBorrow", priceBorrow);

            // check results
            const {error, liquidity, shortfall} = await comptroller.getAccountLiquidity(hfPoolAdapterTC.address);
            const sb = await IHfCToken__factory.connect(borrowCToken.address, deployer)
                .getAccountSnapshot(hfPoolAdapterTC.address);
            console.log(`Borrow token: balance=${sb.borrowBalance} tokenBalance=${sb.tokenBalance} exchangeRate=${sb.exchangeRateMantissa}`);
            const sc = await IHfCToken__factory.connect(collateralCToken.address, deployer)
                .getAccountSnapshot(hfPoolAdapterTC.address);
            console.log(`Collateral token: balance=${sc.borrowBalance} tokenBalance=${sc.tokenBalance} exchangeRate=${sc.exchangeRateMantissa}`);

            const retBalanceBorrowUser = await borrowToken.token.balanceOf(user.address);
            const retBalanceCollateralTokensPoolAdapter = await IERC20Extended__factory.connect(
                collateralCToken.address, deployer
            ).balanceOf(hfPoolAdapterTC.address);

            const sret = [
                error,
                retBalanceBorrowUser,
                retBalanceCollateralTokensPoolAdapter,
                liquidity,
                shortfall,
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const n18 = getBigNumberFrom(1, 18); //1e18
            const nc = getBigNumberFrom(1, collateralToken.decimals); //1e18
            const nb = getBigNumberFrom(1,  borrowToken.decimals); //1e18

            // ALl calculations are explained here:
            // https://docs.google.com/spreadsheets/d/1oLeF7nlTefoN0_9RWCuNc62Y7W72-Yk7
            // sheet: Hundred finance
            const cf1 = collateralData.collateralFactorMantissa;
            const er1 = collateralData.exchangeRateStored;
            const pr1 = priceCollateral;
            const td1 = cf1.mul(er1).div(n18).mul(pr1).div(n18);
            const sc1 = td1.mul(sc.tokenBalance).div(n18);
            const sb1 = priceBorrow.mul(sb.borrowBalance).div(n18);
            const expectedLiquiditiy = sc1.sub(sb1);
            const er2 = borrowData.exchangeRateStored;
            console.log(`cf1=${cf1} er1=${er1} pr1=${pr1} td1=${td1} sc1=${sc1} sb1=${sb1} L1=${expectedLiquiditiy} er2=${er2}`);
            console.log("health factor", ethers.utils.formatUnits(sc1.mul(n18).div(sb1)) );

            const sexpected = [
                0,
                borrowAmount, // borrowed amount on user's balance
                collateralAmount
                    .mul(getBigNumberFrom(1, 18))
                    .div(collateralData.exchangeRateStored),
                expectedLiquiditiy,
                0,
            ].map(x => BalanceUtils.toString(x)).join("\n");

            return {sret, sexpected};
        }
        describe("Good paths", () => {
            describe("Borrow modest amount", () => {
                describe("DAI-18 : usdc-6", () => {
                    it("should return expected balances", async () => {
                        if (!await isPolygonForkInUse()) return;

                        const collateralAsset = MaticAddresses.DAI;
                        const collateralHolder = MaticAddresses.HOLDER_DAI;
                        const collateralCTokenAddress = MaticAddresses.hDAI;

                        const borrowAsset = MaticAddresses.USDC;
                        const borrowCTokenAddress = MaticAddresses.hUSDC;

                        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
                        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
                        const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
                        const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

                        const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
                        const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

                        const r = await makeTest(
                            collateralToken
                            , collateralCToken
                            , collateralHolder
                            , collateralAmount
                            , borrowToken
                            , borrowCToken
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

    describe("repay", () =>{
        async function makeTest(
            collateralToken: TokenDataTypes,
            collateralCToken: TokenDataTypes,
            collateralHolder: string,
            collateralAmount: BigNumber,
            borrowToken: TokenDataTypes,
            borrowCToken: TokenDataTypes,
            borrowHolder: string,
            borrowAmount: BigNumber,
            initialBorrowAmountOnUserBalance: BigNumber,
            amountToRepay: BigNumber,
            closePosition: boolean
        ) : Promise<{
            userBalancesBeforeBorrow: IUserBalances,
            userBalancesAfterBorrow: IUserBalances,
            userBalancesAfterRepay: IUserBalances,
            paCTokensBalance: BigNumber,
            totalCollateralBase: BigNumber,
            totalDebtBase: BigNumber
        }>{
            const user = ethers.Wallet.createRandom();
            const tetuConveterStab = ethers.Wallet.createRandom();

            // controller, dm, bm
            const controller = await CoreContractsHelper.createController(deployer);
            const debtMonitor = await CoreContractsHelper.createDebtMonitor(deployer, controller);
            const borrowManager = await MocksHelper.createBorrowManagerStub(deployer, true);
            await controller.assignBatch(
                [await controller.tetuConverterKey()
                    , await controller.debtMonitorKey()
                    , await controller.borrowManagerKey()
                ]
                , [
                    tetuConveterStab.address
                    , debtMonitor.address
                    , borrowManager.address
                ]
            );

            // initialize adapters and price oracle
            const hfPoolAdapterTC = await AdaptersHelper.createHundredFinancePoolAdapter(
                await DeployerUtils.startImpersonate(tetuConveterStab.address)
            );
            const comptroller = await HundredFinanceHelper.getComptroller(deployer);
            const hfPlatformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
                deployer,
                controller.address,
                comptroller.address,
                hfPoolAdapterTC.address,
                [collateralCToken.address, borrowCToken.address],
                MaticAddresses.HUNDRED_FINANCE_ORACLE
            )
            const priceOracle = HundredFinanceHelper.getPriceOracle(deployer);

            // collateral asset
            await collateralToken.token
                .connect(await DeployerUtils.startImpersonate(collateralHolder))
                .transfer(user.address, collateralAmount);

            // initialize pool adapater
            await hfPoolAdapterTC.initialize(
                controller.address,
                hfPlatformAdapter.address,
                comptroller.address,
                user.address,
                collateralToken.address,
                borrowToken.address
            );

            const beforeBorrow: IUserBalances = {
                collateral: await collateralToken.token.balanceOf(user.address),
                borrow: await borrowToken.token.balanceOf(user.address)
            };

            // make borrow
            await hfPoolAdapterTC.syncBalance(true);
            await IERC20Extended__factory.connect(collateralToken.address
                , await DeployerUtils.startImpersonate(user.address)
            ).transfer(hfPoolAdapterTC.address, collateralAmount);

            await hfPoolAdapterTC.borrow(
                collateralAmount,
                borrowAmount,
                user.address
            );

            const afterBorrow: IUserBalances = {
                collateral: await collateralToken.token.balanceOf(user.address),
                borrow: await borrowToken.token.balanceOf(user.address)
            };
            console.log(afterBorrow);

            // make repay
            await hfPoolAdapterTC.syncBalance(false);
            await IERC20Extended__factory.connect(borrowToken.address
                , await DeployerUtils.startImpersonate(user.address)
            ).transfer(hfPoolAdapterTC.address, amountToRepay);

            await hfPoolAdapterTC.repay(
                amountToRepay,
                user.address,
                closePosition
            );
            console.log("repay is done");

            // check results
            const afterRepay: IUserBalances = {
                collateral: await collateralToken.token.balanceOf(user.address),
                borrow: await borrowToken.token.balanceOf(user.address)
            };
            const cTokenCollateral = await IHfCToken__factory.connect(collateralCToken.address, deployer);
            const cTokenBorrow = await IHfCToken__factory.connect(borrowCToken.address, deployer);

            const retCollateral = await cTokenCollateral.getAccountSnapshot(hfPoolAdapterTC.address);
            const retBorrow = await cTokenBorrow.getAccountSnapshot(hfPoolAdapterTC.address);

            return {
                userBalancesBeforeBorrow: beforeBorrow,
                userBalancesAfterBorrow: afterBorrow,
                userBalancesAfterRepay: afterRepay,
                paCTokensBalance: await cTokenCollateral.balanceOf(hfPoolAdapterTC.address),
                totalCollateralBase: retCollateral.tokenBalance,
                totalDebtBase: retBorrow.borrowBalance
            }
        }
        describe("Good paths", () =>{
            describe("Borrow and repay modest amount", () =>{
                describe("Repay borrow amount without interest", () => {
                    it("should return expected balances", async () => {
                        if (!await isPolygonForkInUse()) return;

                        const collateralAsset = MaticAddresses.DAI;
                        const collateralHolder = MaticAddresses.HOLDER_DAI;
                        const collateralCTokenAddress = MaticAddresses.hDAI;

                        const borrowAsset = MaticAddresses.USDC;
                        const borrowCTokenAddress = MaticAddresses.hUSDC;
                        const borrowHolder = MaticAddresses.HOLDER_USDC;

                        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
                        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
                        const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
                        const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

                        const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
                        const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

                        const r = await makeTest(
                            collateralToken
                            , collateralCToken
                            , collateralHolder
                            , collateralAmount
                            , borrowToken
                            , borrowCToken
                            , borrowHolder
                            , borrowAmount
                            , getBigNumberFrom(0) // initially user don't have any tokens on balance
                            , borrowAmount
                            , false
                        );

                        console.log(`collateralAmount=${collateralAmount}`);
                        console.log(`r.userBalancesAfterRepay.collateral=${r.userBalancesAfterRepay.collateral}`);
                        const sret = [
                            r.userBalancesBeforeBorrow.collateral, r.userBalancesBeforeBorrow.borrow
                            , r.userBalancesAfterBorrow.collateral, r.userBalancesAfterBorrow.borrow
                            ,                                       r.userBalancesAfterRepay.borrow
                            , r.paCTokensBalance
                            , r.totalCollateralBase
                            , r.totalDebtBase

                            // returned collateral > original collateral ...
                            , r.userBalancesAfterRepay.collateral.gt(collateralAmount)
                            // ... the difference is less than 1%
                            , collateralAmount.sub(r.userBalancesAfterRepay.collateral)
                                .div(collateralAmount)
                                .mul(100).toNumber() < 1
                            , r.userBalancesAfterRepay.borrow
                        ].map(x => BalanceUtils.toString(x)).join();

                        const sexpected = [
                            collateralAmount, 0
                            , 0, borrowAmount
                            ,                 0
                            , 0
                            , 0
                            , 0

                            , true // original collateral > returned collateral ...
                            , true // the difference is less than 1%
                            , 0
                        ].map(x => BalanceUtils.toString(x)).join();

                        expect(sret).eq(sexpected);
                    });
                });
            });
        });
        describe("Bad paths", () =>{

        });

    });

//endregion Unit tests

});