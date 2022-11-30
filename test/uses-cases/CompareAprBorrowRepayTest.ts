import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {
  CompareAprUsesCase,
  IBorrowTask,
  IBorrowingTestResults,
  ISwapTestResults
} from "../baseUT/uses-cases/CompareAprUsesCase";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {IAssetInfo, IStrategyToConvert} from "../baseUT/apr/aprDataTypes";
import {BigNumber} from "ethers";
import {Controller, IERC20Metadata__factory, SwapManager__factory} from "../../typechain";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {AprAave3} from "../baseUT/apr/aprAave3";
import {AdaptersHelper} from "../baseUT/helpers/AdaptersHelper";
import {AprAaveTwo} from "../baseUT/apr/aprAaveTwo";
import {AprDForce} from "../baseUT/apr/aprDForce";
import {appendBorrowingTestResultsToFile, appendSwapTestResultsToFile} from "../baseUT/apr/aprUtils";
import {areAlmostEqual} from "../baseUT/utils/CommonUtils";
import {expect} from "chai";
import {Misc} from "../../scripts/utils/Misc";
import {AprHundredFinance} from "../baseUT/apr/aprHundredFinance";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {AaveTwoPlatformFabric} from "../baseUT/fabrics/AaveTwoPlatformFabric";
import {DForcePlatformFabric} from "../baseUT/fabrics/DForcePlatformFabric";
import {HundredFinancePlatformFabric} from "../baseUT/fabrics/HundredFinancePlatformFabric";
import {
  BorrowRepayUsesCase,
  IMakeSingleBorrowSingleFullRepayBaseResults,
  IMakeTestSingleBorrowInstantRepayResults
} from "../baseUT/uses-cases/BorrowRepayUsesCase";
import {ITokenParams} from "../baseUT/types/BorrowRepayDataTypes";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {existsSync, writeFileSync} from "fs";
import {colorLabel} from "hardhat-tracer/dist/src/colors";
import {DForceChangePriceUtils} from "../baseUT/protocols/dforce/DForceChangePriceUtils";

describe("CompareAprBorrowRepayTest @skip-on-coverage", () => {
//region Constants
  const HEALTH_FACTOR2 = 400;
  const COUNT_BLOCKS_SMALL = 1_000;
  const COUNT_BLOCKS_LARGE = 20_000;

//endregion Constants

//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;

  let controllerForAave3: Controller;
  let controllerForAaveTwo: Controller;
  let controllerForDForce: Controller;
  let controllerForHundredFinance: Controller;
  let controllerSwap: Controller;

  let dai: ITokenParams;
  let usdc: ITokenParams;
  let usdt: ITokenParams;
  let weth: ITokenParams;
  let wbtc: ITokenParams;
  let wmatic: ITokenParams;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];

    {
      const {controller} = await TetuConverterApp.buildApp(deployer,
        [new Aave3PlatformFabric()],
        {} // disable swap
      );
      controllerForAave3 = controller;
    }
    {
      const {controller} = await TetuConverterApp.buildApp(deployer,
        [new AaveTwoPlatformFabric()],
        {} // disable swap
      );
      controllerForAaveTwo = controller;
    }
    {
      const {controller} = await TetuConverterApp.buildApp(deployer,
        [new DForcePlatformFabric()],
        {} // disable swap
      );
      controllerForDForce = controller;
      // Let's replace DForce's price oracle by mocked version
      // because origin oracle doesn't allow to advance blocks (prices become deprecated)
      await DForceChangePriceUtils.setupPriceOracleMock(deployer, true);
    }
    {
      const {controller} = await TetuConverterApp.buildApp(deployer,
        [new HundredFinancePlatformFabric()],
        {} // disable swap
      );
      controllerForHundredFinance = controller;
    }
    {
      const {controller} = await TetuConverterApp.buildApp(deployer,
        [],
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR} // disable swap
      );
      controllerSwap = controller;
    }
    dai = {asset: MaticAddresses.DAI, holder: MaticAddresses.HOLDER_DAI, initialLiquidity: parseUnits("100000")};
    usdc = {asset: MaticAddresses.USDC, holder: MaticAddresses.HOLDER_USDC, initialLiquidity: parseUnits("100000", 6)};
    usdt = {asset: MaticAddresses.USDT, holder: MaticAddresses.HOLDER_USDT, initialLiquidity: parseUnits("100000", 6)};
    wbtc = {asset: MaticAddresses.WBTC, holder: MaticAddresses.HOLDER_WBTC, initialLiquidity: parseUnits("100", 8)};
    weth = {asset: MaticAddresses.WETH, holder: MaticAddresses.HOLDER_WETH, initialLiquidity: parseUnits("10000")};
    wmatic = {asset: MaticAddresses.WMATIC, holder: MaticAddresses.HOLDER_WMATIC, initialLiquidity: parseUnits("100000")};
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
  describe("Generate compareApr1", () => {
    interface IMakeBorrowAndRepayResults {
      collateralAsset: string;
      collateralAmount: BigNumber;
      borrowAsset: string;
      borrowAmount: BigNumber;
      strategyToConvert: IStrategyToConvert;
      userCollateralBalanceDelta: BigNumber;
      userBorrowBalanceDelta: BigNumber;
    }

    async function makeBorrowAndRepay(
      controller: Controller,
      collateral: ITokenParams,
      collateralAmount: BigNumber,
      borrow: ITokenParams,
      countBlocks: number
    ) : Promise<IMakeBorrowAndRepayResults> {
      const r = await BorrowRepayUsesCase.makeSingleBorrowSingleFullRepayBase(
        deployer,
        {
          borrow,
          collateral,
          countBlocks,
          collateralAmount,
          healthFactor2: HEALTH_FACTOR2
        },
        controller,
        countBlocks
      );
      return {
        borrowAsset: borrow.asset,
        collateralAsset: collateral.asset,
        borrowAmount: r.userBalances[0].borrow.sub(r.ucBalanceBorrow0),
        strategyToConvert: r.strategyToConvert,
        collateralAmount,
        userBorrowBalanceDelta: r.userBalances[1].borrow.sub(r.ucBalanceBorrow0),
        userCollateralBalanceDelta: r.userBalances[1].collateral.sub(r.ucBalanceCollateral0)
      }
    }

    function writeHeadersIfNecessary(path: string) {
      if (! existsSync(path)) {
        const headers = [
          "platform",
          "error",

          "collateralAsset",
          "borrowAsset",

          "collateralAmount",
          "borrowAmount",

          "collateralDelta",
          "borrowDelta",

          "APR18"
        ];
        writeFileSync(path, headers.join(";") + "\n", {encoding: 'utf8', flag: "a" });
      }
    }

    function getAssetName(asset: string) : string {
      switch (asset) {
        case MaticAddresses.DAI: return "DAI";
        case MaticAddresses.USDC: return "USDC";
        case MaticAddresses.USDT: return "USDT";
        case MaticAddresses.WBTC: return "WBTC";
        case MaticAddresses.WETH: return "WETH";
        case MaticAddresses.WMATIC: return "WMATIC";
      }
      return asset;
    }
    async function getAssetDecimals(asset: string) : Promise<number> {
      switch (asset) {
        case MaticAddresses.DAI: return 18;
        case MaticAddresses.USDC: return 6;
        case MaticAddresses.USDT: return 6;
        case MaticAddresses.WBTC: return 8;
        case MaticAddresses.WETH: return 18;
        case MaticAddresses.WMATIC: return 18;
      }
      return IERC20Metadata__factory.connect(asset, deployer).decimals();
    }

    function writeError(
      path: string,
      platform: string,
      error: string,
      collateral: ITokenParams,
      collateralAmount: BigNumber,
      borrow: ITokenParams,
    ) {
      writeHeadersIfNecessary(path);
      const line = [
        platform,
        error,

        getAssetName(collateral.asset),
        getAssetName(borrow.asset),

        collateralAmount.toString(),
      ];
      writeFileSync(path, line.join(";") + "\n", {encoding: 'utf8', flag: "a" });
    }

    async function makeBorrowAndRepaySaveToFile(
      path: string,
      platform: string,
      controller: Controller,
      collateral: ITokenParams,
      collateralAmount: BigNumber,
      borrow: ITokenParams,
      countBlocks: number
    ) {
      writeHeadersIfNecessary(path);
      const r = await makeBorrowAndRepay(controller, collateral, collateralAmount, borrow, countBlocks);
      const line = [
        platform,
        undefined, // no errors

        getAssetName(r.collateralAsset),
        getAssetName(r.borrowAsset),

        formatUnits(r.collateralAmount, await getAssetDecimals(r.collateralAsset)),
        formatUnits(r.borrowAmount, await getAssetDecimals(r.borrowAsset)),

        formatUnits(r.userCollateralBalanceDelta, await getAssetDecimals(r.collateralAsset)),
        formatUnits(r.userBorrowBalanceDelta, await getAssetDecimals(r.borrowAsset)),

        r.strategyToConvert.apr18.toString(),
      ];
      writeFileSync(path, line.join(";") + "\n", {encoding: 'utf8', flag: "a" });
    }

    it("generate file compareApr", async () => {
      const pathOut = "tmp/compareApr.csv";
      const assets = [
        dai,
        usdc,
        usdt,
        wmatic
      ];
      const amounts = [
        parseUnits("1000", 18),
        parseUnits("1000", 6),
        parseUnits("1000", 6),
        parseUnits("1000", 18),
      ]
      const platforms = [controllerForAave3, controllerForAaveTwo, controllerForDForce, controllerForHundredFinance];
      const platformTitles = ["AAVE3", "AAVETwo", "DForce", "HundredFinance"];

      for (let n = 0; n < platforms.length; ++n) {
        let localSnapshot: string;
        for (let i = 0; i < assets.length; ++i) {
          for (let j = i + 1; j < assets.length; ++j) {
            localSnapshot = await TimeUtils.snapshot();
            try {
              await makeBorrowAndRepaySaveToFile(pathOut, platformTitles[n], platforms[n], assets[i], amounts[i], assets[j], COUNT_BLOCKS_LARGE);
              // tslint:disable-next-line:no-any
            } catch (e: any) {
              console.log(e);
              let written = false;
              const re = /VM Exception while processing transaction: reverted with reason string\s*(.*)/i;
              if (e.message) {
                const found = e.message.match(re);
                console.log("found", found)
                if (found && found[1]) {
                  writeError(pathOut, platformTitles[n], found[1], assets[i], amounts[i], assets[j]);
                  written = true;
                }
              }
              if (! written) {
                writeError(pathOut, platformTitles[n], e, assets[i], amounts[i], assets[j]);
              }
            } finally {
              await TimeUtils.rollback(snapshotForEach);
            }
          }
        }
      }
    });

  });

//endregion Unit tests
});

