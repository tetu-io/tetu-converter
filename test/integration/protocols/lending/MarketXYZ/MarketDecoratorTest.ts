import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
    ICErc20,
    IERC20, IERC20Extended, IFuseFeeDistributor__factory,
    MarketDecorator, PriceOracleMock
} from "../../../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {DeployUtils} from "../../../../../scripts/utils/DeployUtils";
import {changeDecimals, getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {isPolygonForkInUse} from "../../../../baseUT/NetworkUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";

describe("MarketXYZ integration tests", () => {
//region Constants
    const maticAddress = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';

    const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
    const cUsdcAddress_Pool5 = '0x7a9c2075493dBC9E3EdFC8a4C44613a372cb99bF';
    const cUsdcAddress_Pool1 = '0xD74662C8412f1dC1fc889BF6E52D2E1980b8E9EE';
    const usdcHolder = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245';

    const daiAddress = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063';
    const cDaiAddress_Pool5 = "0x6972621FB53a965F24936e3db2E19806C43eCa65";
    const cDaiAddress_Pool1 = "0x68f0A754149A4c9f75F46E3AA56681680a812DAf";
    const daiHolder = "0xf04adbf75cdfc5ed26eea4bbbb991db002036bdd";

    const wmaticAddress = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
    const cWmaticAddress_Pool5 = "0x85322B01612A7C79b0779c616af07fB71fe9433A";
    const wmaticHolder = "0x6e7a5fafcec6bb1e78bae2a1f0b612012bf14827";

    /** Fuse pool with id=5 */
    const marketXYZPool5 = "0x5BeB233453d3573490383884Bd4B9CbA0663218a";
    const marketXYZPool1 = "0x2BF93d365E5Ca26619dc3B496Ffa5Ae49CD219a0";
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

        wmatic = (await ethers.getContractAt(
            'contracts/integrations/IERC20Extended.sol:IERC20Extended',
            wmaticAddress
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

        await wmatic
            .connect(await DeployerUtils.startImpersonate(wmaticHolder))
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
            async function makeTest(
                pool: string,
                cSourceAddress: string,
                cTargetAddress: string,
                sourceName: string,
                targetName: string,
                source: IERC20Extended,
                target: IERC20Extended,
                amountForCollateralSource: number,
                amountToBorrowTarget: number
            ) : Promise<{ret: string, expected: string}> {
                const investorInitialSource = await source.balanceOf(investor.address);
                const investorInitialTarget = await target.balanceOf(investor.address);

                const cSource = (await ethers.getContractAt(
                    'contracts/integrations/market/ICErc20.sol:ICErc20',
                    cSourceAddress
                )) as ICErc20;

                const cTarget = (await ethers.getContractAt(
                    'contracts/integrations/market/ICErc20.sol:ICErc20',
                    cTargetAddress
                )) as ICErc20;

                const exchangeRateSource = await cSource.exchangeRateStored();
                const exchangeRateTarget = await cTarget.exchangeRateStored();

                const decimalsSource = await source.decimals();
                const decimalsTarget = await target.decimals();
                const decimalsCSource = await cSource.decimals();
                const decimalsCTarget = await cTarget.decimals();

                console.log(`${sourceName} decimals`, decimalsSource);
                console.log(`${targetName} decimals`, decimalsTarget);
                console.log(`c${sourceName} decimals`, decimalsCSource, "exchange rate", exchangeRateSource);
                console.log(`c${targetName} decimals`, decimalsCTarget, "exchange rate", exchangeRateTarget);

                console.log("deployer", deployer.address);
                console.log("investor", investor.address, sourceName, investorInitialSource, targetName, investorInitialTarget);

                const md = (await DeployUtils.deployContract(deployer, "MarketDecorator")) as MarketDecorator;

                // balances before
                const sourceMd0 = await source.balanceOf(md.address);
                const cSourceMd0 = await cSource.balanceOf(md.address);
                const targetMd0 = await target.balanceOf(md.address);

                const sourceInvestor0 = await source.balanceOf(investor.address);
                const cSourceInvestor0 = await cSource.balanceOf(investor.address);
                const targetInvestor0 = await target.balanceOf(investor.address);

                // check balances before conversion
                console.log(`Decorator ${sourceName} before`, sourceMd0);
                console.log(`Decorator c${sourceName} before`, cSourceMd0);
                console.log(`Decorator ${targetName} before`, targetMd0);

                console.log(`Investor ${sourceName} before`, sourceInvestor0);
                console.log(`Investor c${sourceName} before`, cSourceInvestor0);
                console.log(`Investor ${targetName} before`, targetInvestor0);

                // transfer collateral to the converter
                const collateralSource = getBigNumberFrom(amountForCollateralSource, decimalsSource);
                await source
                    .connect(investor)
                    .transfer(md.address, collateralSource);
                console.log(`Transfer collateral ${sourceName}=`, collateralSource, "to investor=", investor.address);
                console.log(`Decorator, balance ${sourceName}=`, await source.balanceOf(md.address));

                // borrow
                const requiredAmountTarget = getBigNumberFrom(amountToBorrowTarget, decimalsTarget);
                console.log(`borrow ${sourceName}=`, collateralSource, ` ask for ${targetName}=`, requiredAmountTarget);
                await md.openPosition(
                    pool,
                    source.address,
                    collateralSource,
                    target.address,
                    requiredAmountTarget,
                    investor.address
                );

                // check balances after conversion
                const sourceMd1 = await source.balanceOf(md.address);
                const cSourceMd1 = await cSource.balanceOf(md.address);
                const targetMd1 = await target.balanceOf(md.address);

                const sourceInvestor1 = await source.balanceOf(investor.address);
                const cSourceInvestor1 = await cSource.balanceOf(investor.address);
                const targetInvestor1 = await target.balanceOf(investor.address);
                const cTargetInvestor1 = await cTarget.balanceOf(investor.address);

                console.log(`Decorator ${sourceName} after`, cSourceMd1);
                console.log(`Decorator c${sourceName} after`, cSourceMd1);
                console.log(`Decorator ${targetName} after`, targetMd1);

                console.log(`Investor ${sourceName} after`, sourceInvestor1);
                console.log(`Investor c${sourceName} after`, cSourceInvestor1);
                console.log(`Investor ${targetName} after`, targetInvestor1);
                console.log(`Investor c${targetName} after`, cTargetInvestor1);

                // https://compound.finance/docs/ctokens#exchange-rate
                // The current exchange rate as an unsigned integer, scaled by 1 * 10^(18 - 8 + Underlying Token Decimals)
                const expectedCSourceApprox = changeDecimals(
                    changeDecimals(collateralSource, decimalsSource, 18)
                        .mul(BigNumber.from(10).pow(18))
                        .div(
                            changeDecimals(exchangeRateSource, 18 - decimalsCSource + decimalsSource, 18)
                        )
                    , 18
                    , decimalsCSource
                );

                const ret = [
                    "decorator",
                    sourceMd1.toString(),
                    !cSourceMd1.sub(expectedCSourceApprox).mul(100).div(expectedCSourceApprox).gt(5),
                    targetMd1.toString(),
                    "investor",
                    sourceInvestor1.toString(),
                    cSourceInvestor1.toString(),
                    targetInvestor1.toString(),
                    cTargetInvestor1.toString()
                ].join();

                const expected = [
                    "decorator",
                    BigNumber.from(0).toString(), // decorator has spent the entire collateral
                    // difference between real and expected number of cTokens is less, i.e. 5 %
                    true,
                    BigNumber.from(0).toString(), // decorator has sent all borrowed amount to the investor
                    "investor",
                    investorInitialSource.sub(collateralSource).toString(),
                    BigNumber.from(0).toString(), // investor doesn't receive cSource
                    investorInitialTarget.add(getBigNumberFrom(amountToBorrowTarget, decimalsTarget)).toString(),
                    BigNumber.from(0).toString(), // investor doesn't receive any cTarget
                ].join();
                return {ret, expected};
            }

            describe("USDC to/from DAI", () => {
                const poolMarketXYZ = marketXYZPool5;
                const cUsdcMarketXYZ = cUsdcAddress_Pool5;
                const cDaiMarketXYZ = cDaiAddress_Pool5;

                describe("A lot of usdc => dai", () => {
                    it("should update balances in proper way", async () => {
                        if (!await isPolygonForkInUse()) return;

                        const amountForCollateralUSDC = 1000;
                        const amountToBorrowDai = 300;

                        const r = await makeTest(
                            poolMarketXYZ, cUsdcMarketXYZ, cDaiMarketXYZ,
                            "USDC", "DAI",
                            usdc, dai,
                            amountForCollateralUSDC
                            , amountToBorrowDai
                        );
                        expect(r.ret).equal(r.expected);
                    });
                });
                describe("Few usdc => dai", () => {
                    it("should update balances in proper way", async () => {
                        if (!await isPolygonForkInUse()) return;

                        // const ff = IFuseFeeDistributor__factory.connect(
                        //     "0xB1205172AAdaAd4c67318EA77A34C1F1CaA784EE"
                        //     , deployer
                        // );
                        // const min = await ff.minBorrowEth();
                        // console.log(min);

                        const amountForCollateralUSDC = 300;
                        const amountToBorrowDai = 100; // >= 80, but minBorrowETH = 0.05..

                        const r = await makeTest(
                            poolMarketXYZ, cUsdcMarketXYZ, cDaiMarketXYZ,
                            "USDC", "DAI",
                            usdc, dai,
                            amountForCollateralUSDC
                            , amountToBorrowDai
                        );
                        expect(r.ret).equal(r.expected);
                    });
                });
                describe("dai => usdc", () => {
                    it("should update balances in proper way", async () => {
                        if (!await isPolygonForkInUse()) return;

                        const amountForCollateralDai = 500;
                        const amountToBorrowUSDC = 100;

                        const r = await makeTest(
                            poolMarketXYZ, cDaiMarketXYZ, cUsdcMarketXYZ,
                            "DAI", "USDC",
                            dai, usdc,
                            amountForCollateralDai
                            , amountToBorrowUSDC
                        );
                        expect(r.ret).equal(r.expected);
                    });
                });

            });
            describe("USDC to/from MATIC", () => {
                const poolMarketXYZ = marketXYZPool5;
                const cUsdcMarketXYZ = cUsdcAddress_Pool5;
                const cWmaticMarketXYZ = cWmaticAddress_Pool5;

                describe("usdc => wmatic", () => {
                    it("should update balances in proper way", async () => {
                        if (!await isPolygonForkInUse()) return;

                        const amountForCollateralUSDC = 300;
                        const amountToBorrowWMATIC = 100;

                        const r = await makeTest(
                            poolMarketXYZ, cWmaticMarketXYZ, cUsdcMarketXYZ,
                            "USDC", "WMATIC",
                            usdc, wmatic,
                            amountForCollateralUSDC
                            , amountToBorrowWMATIC
                        );
                        expect(r.ret).equal(r.expected);
                    });
                });

                describe("wmatic => usdc", () => {
                    it("should update balances in proper way", async () => {
                        if (!await isPolygonForkInUse()) return;

                        const amountForCollateralWMATIC = 200;
                        const amountToBorrowUSDC = 50;

                        const r = await makeTest(
                            poolMarketXYZ, cWmaticMarketXYZ, cUsdcMarketXYZ,
                            "WMATIC", "USDC",
                            wmatic, usdc,
                            amountForCollateralWMATIC
                            , amountToBorrowUSDC
                        );
                        expect(r.ret).equal(r.expected);
                    });
                });
            });
            describe("DAI to/from MATIC", () => {
                const poolMarketXYZ = marketXYZPool5;
                const cDaiMarketXYZ = cDaiAddress_Pool5;
                const cWmaticMarketXYZ = cWmaticAddress_Pool5;

                describe("dai => wmatic", () => {
                    it("should update balances in proper way", async () => {
                        if (!await isPolygonForkInUse()) return;

                        const amountForCollateralDAI = 300;
                        const amountToBorrowWMATIC = 100;

                        const r = await makeTest(
                            poolMarketXYZ, cWmaticMarketXYZ, cDaiMarketXYZ,
                            "DAI", "WMATIC",
                            dai, wmatic,
                            amountForCollateralDAI
                            , amountToBorrowWMATIC
                        );
                        expect(r.ret).equal(r.expected);
                    });
                });

                describe("wmatic => dai", () => {
                    it("should update balances in proper way", async () => {
                        if (!await isPolygonForkInUse()) return;

                        const amountForCollateralWMATIC = 500;
                        const amountToBorrowDAI = 100;

                        const r = await makeTest(
                            poolMarketXYZ, cWmaticMarketXYZ, cDaiMarketXYZ,
                            "WMATIC", "DAI",
                            wmatic, dai,
                            amountForCollateralWMATIC
                            , amountToBorrowDAI
                        );
                        expect(r.ret).equal(r.expected);
                    });
                });
            });
        });
    });
//endregion Unit tests

});