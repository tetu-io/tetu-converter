import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
    IERC20, IERC20Extended,
    MarketDecorator, PriceOracleMock
} from "../../../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {DeployUtils} from "../../../../../scripts/utils/DeployUtils";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {isPolygonForkInUse} from "../../../../baseUT/NetworkUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";

describe("MarketXYZ integration tests", () => {
//region Constants
    const maticAddress = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';

    const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
    //const cUsdcAddress_Pool5 = '0x7a9c2075493dBC9E3EdFC8a4C44613a372cb99bF';
    const cUsdcAddress_Pool1 = '0xD74662C8412f1dC1fc889BF6E52D2E1980b8E9EE';
    const usdcHolder = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245';

    const daiAddress = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063';
    //const cDaiAddress_Pool5 = "0x6972621FB53a965F24936e3db2E19806C43eCa65";
    const cDaiAddress_Pool1 = "0x68f0A754149A4c9f75F46E3AA56681680a812DAf";
    const daiHolder = "0xc06320d9028f851c6ce46e43f04aff0a426f446c";

    /** Fuse pool with id=5 */
    //const marketXYZPool5 = "0x5BeB233453d3573490383884Bd4B9CbA0663218a";
    const marketXYZPool1 = "0x2BF93d365E5Ca26619dc3B496Ffa5Ae49CD219a0";
//endregion Constants

//region Global vars for all tests
    let snapshot: string;
    let snapshotForEach: string;
    let deployer: SignerWithAddress;
    let investor: SignerWithAddress;
    let usdc: IERC20Extended;
    let dai: IERC20Extended;
    let usdcDecimals: number;
    let daiDecimals: number;
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

        usdc = (await ethers.getContractAt(
            'contracts/integrations/IERC20Extended.sol:IERC20Extended',
            usdcAddress
        )) as IERC20Extended;
        usdcDecimals = await usdc.decimals();

        await usdc
            .connect(await DeployerUtils.startImpersonate(usdcHolder))
            .transfer(
                investor.address,
                BigNumber.from(100_000).mul(BigNumber.from(10).pow(usdcDecimals))
            );

        dai = (await ethers.getContractAt(
            'contracts/integrations/IERC20Extended.sol:IERC20Extended',
            daiAddress
        )) as IERC20Extended;
        daiDecimals = await dai.decimals()

        await dai
            .connect(await DeployerUtils.startImpersonate(daiHolder))
            .transfer(
                investor.address,
                BigNumber.from(100_000).mul(BigNumber.from(10).pow(daiDecimals))
            );
    });

    afterEach(async function () {
        await TimeUtils.rollback(snapshotForEach);
    });
//endregion before, after

//region Unit tests
    describe("findPlan", () => {
        describe("Good paths", () => {
            describe("Build plan", () => {
                it("should return expected values", async () => {
                   expect.fail();
                });
            });
        });
        describe("Bad paths", () => {
            describe("Collateral is not enough", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });
            describe("The market is unlisted", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });
            describe("Target amount is 0", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });
            describe("Price oracle has no info about source asset", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });
            describe("Price oracle has no info about target asset", () => {
                it("should revert", async () => {
                    expect.fail();
                });
            });
        });
    });

    describe("openPosition", () => {
        describe("Good paths", () => {
            describe("Use matic as collateral, borrow USDC", () => {
                it("should update balance in proper way", async () => {
                    if (! await isPolygonForkInUse()) {
                        console.log("Test is skipped");
                        return;
                    }
                    const amoutForCollateralUSDC = 20000;
                    const amountToBorrowDai = 10;
                    console.log("usdc decimals", usdcDecimals);
                    console.log("dai decimals", daiDecimals);
                    console.log("deployer", deployer.address);
                    console.log("investor", investor.address);

                    // const priceOracle = (await DeployUtils.deployContract(deployer
                    //     , "PriceOracleMock"
                    //     , []
                    //     , []
                    // )) as PriceOracleMock;

                    const md = (await DeployUtils.deployContract(deployer
                        , "MarketDecorator"
                    )) as MarketDecorator;

                    // const bm = (await DeployUtils.deployContract(deployer
                    //     , "BorrowManager"
                    //     , priceOracle
                    // )) as MarketDecorator;
                    //
                    // const tc = (await DeployUtils.deployContract(deployer
                    //     , "TetuConverter"
                    //     , bm
                    // )) as MarketDecorator;

                    // transfer collateral to the converter
                    console.log("transfer collateral");
                    await usdc
                        .connect(investor)
                        .transfer(md.address,
                            getBigNumberFrom(amoutForCollateralUSDC, usdcDecimals)
                        );
                    await dai
                        .connect(investor)
                        .transfer(md.address,
                            getBigNumberFrom(amoutForCollateralUSDC, daiDecimals)
                        );
                    console.log("Balance of USD on md's account", await usdc.balanceOf(md.address));

                    const cusdc = (await ethers.getContractAt(
                        'contracts/openzeppelin/IERC20.sol:IERC20',
                        cUsdcAddress_Pool1
                    )) as IERC20;
                    const cdai = (await ethers.getContractAt(
                        'contracts/openzeppelin/IERC20.sol:IERC20',
                        cDaiAddress_Pool1
                    )) as IERC20;

                    // balances before
                    const beforeBalanceMdUSDC = await usdc.balanceOf(md.address);
                    const beforeBalanceMdCUSDC = await cusdc.balanceOf(md.address);
                    const beforeBalanceMdDAI = await dai.balanceOf(md.address);

                    const beforeBalanceInvestorUSDC = await usdc.balanceOf(investor.address);
                    const beforeBalanceInvestorCUSDC = await cusdc.balanceOf(investor.address);
                    const beforeBalanceInvestorDAI = await dai.balanceOf(investor.address);

                    // check balances of USDC, Matic and cMatic
                    console.log("Balance of USDC, decorator", beforeBalanceMdUSDC);
                    console.log("Balance of cToken(cUSDC), decorator", beforeBalanceMdCUSDC);
                    console.log("Balance of DAI, decorator", beforeBalanceMdDAI);

                    console.log("Balance of USDC, investor", beforeBalanceInvestorUSDC);
                    console.log("Balance of cToken(cUSDC), investor", beforeBalanceInvestorCUSDC);
                    console.log("Balance of DAI, investor", beforeBalanceInvestorDAI);

                    // borrow DAI for USDC
                    console.log("borrow");
                    await md.openPosition(
                        marketXYZPool1,
                        usdcAddress,
                        getBigNumberFrom(amoutForCollateralUSDC, usdcDecimals),
                        daiAddress,
                        getBigNumberFrom(amountToBorrowDai, daiDecimals),
                        investor.address
                    );

                    const afterBalanceMdUSDC = await usdc.balanceOf(md.address);
                    const afterBalanceMdCUSDC = await cusdc.balanceOf(md.address);
                    const afterBalanceMdDAI = await dai.balanceOf(md.address);

                    const afterBalanceInvestorUSDC = await usdc.balanceOf(investor.address);
                    const afterBalanceInvestorCUSDC = await cusdc.balanceOf(investor.address);
                    const afterBalanceInvestorDAI = await dai.balanceOf(investor.address);

                    // check balances of USDC, Matic and cMatic
                    console.log("Balance of USDC, decorator", afterBalanceMdUSDC);
                    console.log("Balance of cToken(cUSDC), decorator", afterBalanceMdCUSDC);
                    console.log("Balance of DAI, decorator", afterBalanceMdDAI);

                    console.log("Balance of USDC, investor", afterBalanceInvestorUSDC);
                    console.log("Balance of cToken(cUSDC), investor", afterBalanceInvestorCUSDC);
                    console.log("Balance of DAI, investor", afterBalanceInvestorDAI);
                    console.log("Balance of cToken(cDAI), investor", await cdai.balanceOf(investor.address));

                    expect.fail();
                });
            });
            describe("Use USDC as collateral, borrow matic", () => {
                it("should update balance in proper way", async () => {
                    expect.fail();
                });
            });
            describe("Use USDC as collateral, borrow USDT", () => {
                it("should update balance in proper way", async () => {
                    expect.fail();
                });
            });
        });
    });
//endregion Unit tests

});