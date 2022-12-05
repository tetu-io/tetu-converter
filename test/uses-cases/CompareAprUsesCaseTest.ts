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
import {IAssetInfo} from "../baseUT/apr/aprDataTypes";
import {BigNumber} from "ethers";
import {IERC20Metadata__factory, SwapManager__factory} from "../../typechain";
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

/**
 * Script to generate
 *        compareResults.csv
 * For each pair of assets do follow:
 * - predict APR
 * - make borrow and estimate real APR
 * - save predicted and real values to result comparative file
 */
describe.skip("CompareAprUsesCaseTest @skip-on-coverage", () => {
//region Constants
  const PATH_OUT = "tmp/compareResults.csv";
  const HEALTH_FACTOR2 = 400;
  const COUNT_BLOCKS_SMALL = 1_00;
  const COUNT_BLOCKS_LARGE = 2_000;

  const listAssets: IAssetInfo[] = [
    {
      asset: MaticAddresses.USDT, title: "USDT", holders: [
        MaticAddresses.HOLDER_USDT,
        MaticAddresses.HOLDER_USDT_1,
        MaticAddresses.HOLDER_USDT_2,
        MaticAddresses.HOLDER_USDT_3,
      ]
    },
    {
      asset: MaticAddresses.DAI, title: "DAI", holders: [
        MaticAddresses.HOLDER_DAI,
        MaticAddresses.HOLDER_DAI_2,
        MaticAddresses.HOLDER_DAI_3,
        MaticAddresses.HOLDER_DAI_4,
        MaticAddresses.HOLDER_DAI_5,
        MaticAddresses.HOLDER_DAI_6,
      ]
    },
    {
      asset: MaticAddresses.USDC, title: "USDC", holders: [
        MaticAddresses.HOLDER_USDC
      ]
    },
    {
      asset: MaticAddresses.WMATIC, title: "WMATIC", holders: [
        MaticAddresses.HOLDER_WMATIC,
        MaticAddresses.HOLDER_WMATIC_2,
        MaticAddresses.HOLDER_WMATIC_3
      ]
    },
    {
      asset: MaticAddresses.WBTC, title: "WBTC", holders: [
        MaticAddresses.HOLDER_WBTC
      ]
    },
    {
      asset: MaticAddresses.WETH, title: "WETH", holders: [
        MaticAddresses.HOLDER_WETH,
        MaticAddresses.HOLDER_WETH_2,
        MaticAddresses.HOLDER_WETH_3,
      ]
    },
    {
      asset: MaticAddresses.CHAIN_LINK, title: "ChainLink", holders: [
        MaticAddresses.HOLDER_CHAIN_LINK
      ]
    },
    {
      asset: MaticAddresses.EURS, title: "EURS", holders: [
        MaticAddresses.HOLDER_EURS,
        MaticAddresses.HOLDER_EURS_2,
        MaticAddresses.HOLDER_EURS_3,
      ]
    }
    // , {
    //   asset: MaticAddresses.AavegotchiGHST, title: "AavegotchiGHST", holders: [
    //     MaticAddresses.HOLDER_AavegotchiGHST
    //   ]
    // }
    // , {
    //   asset: MaticAddresses.CRV, title: "CRV", holders: [
    //     MaticAddresses.HOLDER_CRV
    //   ]
    // } ,
    // {
    //   asset: MaticAddresses.SUSHI, title: "SUSHI", holders: [
    //     MaticAddresses.HOLDER_Sushi
    //     , MaticAddresses.HOLDER_Sushi_2
    //     , MaticAddresses.HOLDER_Sushi_3
    //     , MaticAddresses.HOLDER_Sushi_4
    //     , MaticAddresses.HOLDER_Sushi_5
    //     , MaticAddresses.HOLDER_Sushi_6
    //   ]
    // }
    // , {
    //   asset: MaticAddresses.BALANCER, title: "BALANCER", holders: [
    //     MaticAddresses.HOLDER_BALANCER
    //     , MaticAddresses.HOLDER_BALANCER_1
    //     , MaticAddresses.HOLDER_BALANCER_2
    //     , MaticAddresses.HOLDER_BALANCER_3
    //     , MaticAddresses.HOLDER_BALANCER_4
    //   ]
    // }
    // , {
    //   asset: MaticAddresses.jEUR, title: "jEUR", holders: [
    //     MaticAddresses.HOLDER_jEUR
    //     , MaticAddresses.HOLDER_jEUR_2
    //   ]
    // }

                // , {
                //   asset: MaticAddresses.DefiPulseToken, title: "DefiPulseToken", holders: [
                //     MaticAddresses.HOLDER_DefiPulseToken
                //   ]
                // }
                // , {
                //   asset: MaticAddresses.FRAX, title: "FRAX", holders: [
                //     MaticAddresses.HOLDER_FRAX
                //     , MaticAddresses.HOLDER_FRAX_2
                //     , MaticAddresses.HOLDER_FRAX_3
                //   ]
                // }
  ];
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

//region Utils to generate amounts and validate results
  /**
   * For each asset generate small amount
   *        0.1 * 10^AssetDecimals
   */
  async function getSmallAmounts(assets: IAssetInfo[]) : Promise<BigNumber[]> {
    return Promise.all(
      assets.map(
        async x => {
            const decimals = await IERC20Metadata__factory.connect(x.asset, deployer).decimals();
            return getBigNumberFrom(1, decimals).div(10);
        }
      )
    )
  }

  /**
   * For each asset generate middle amount
   *     100 * 10^AssetDecimals
   */
  async function getMiddleAmounts(assets: IAssetInfo[]) : Promise<BigNumber[]> {
    return getAmounts(assets, 100);
  }

  /**
   * For each asset generate middle amount
   *     100 * 10^AssetDecimals
   */
  async function getHugeAmounts(assets: IAssetInfo[]) : Promise<BigNumber[]> {
    return getAmounts(assets, 10_000);
  }

  /**
   * For each asset generate middle amount
   *     factor * 10^AssetDecimals
   */
  async function getAmounts(assets: IAssetInfo[], factor: number) : Promise<BigNumber[]> {
    return Promise.all(
      assets.map(
        async x => {
          const decimals = await IERC20Metadata__factory.connect(x.asset, deployer).decimals();
          return getBigNumberFrom(1, decimals)
            .mul(
              x.asset === MaticAddresses.WBTC
                ? factor / 20
                : factor
            );
        }
      )
    )
  }

  function validate(items: IBorrowingTestResults[]) : {sret: string, sexpected: string} {
    const ret = [
      // predicted apr-supply is undefined or zero
      items.filter(x => !x.results?.predictedAmounts.supplyIncomeInBorrowTokens36).length,
      // predicted apr-borrow is undefined or zero
      items.filter(x => !x.results?.predictedAmounts.costBorrow36).length,

      // predicted apr-supply is almost equal to real one
      items.filter(
        x =>
          x.results?.resultAmounts.supplyIncomeInBorrowTokens36
          && x.results?.predictedAmounts.supplyIncomeInBorrowTokens36
          && areAlmostEqual(
            x.results?.resultAmounts.supplyIncomeInBorrowTokens36,
            x.results?.predictedAmounts.supplyIncomeInBorrowTokens36,
          2
          )
      ).length
    ];
    const expected = [
      0,
      0,
      items.length,
    ];
    return {
      sret: ret.join(),
      sexpected: expected.join()
    }
  }
//endregion Utils to generate amounts and validate results

//region Test impl
  async function makeTestSwap(countBlocks: number, tasks: IBorrowTask[]): Promise<ISwapTestResults[]> {
    const {controller} = await TetuConverterApp.buildApp(
      deployer,
      undefined,
      {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
    );

    const swapManager = SwapManager__factory.connect(await controller.swapManager(), deployer);

    return CompareAprUsesCase.makePossibleSwaps(
      deployer,
      swapManager,
      tasks,
      countBlocks,
    );
  }

  async function makeTestAave3(countBlocks: number, tasks: IBorrowTask[]): Promise<IBorrowingTestResults[]> {
    const controller = await TetuConverterApp.createController(deployer);
    const templateAdapterStub = ethers.Wallet.createRandom().address;

    return CompareAprUsesCase.makePossibleBorrowsOnPlatform(
      deployer,
      "AAVE3",
      await AdaptersHelper.createAave3PlatformAdapter(deployer,
        controller.address,
        MaticAddresses.AAVE_V3_POOL,
        templateAdapterStub,
        templateAdapterStub,
      ),
      tasks,
      countBlocks,
      HEALTH_FACTOR2,
      async (
          deployer0,
          amountToBorrow0,
          p,
          additionalPoints
        ) => (await AprAave3.makeBorrowTest(deployer0, amountToBorrow0, p, additionalPoints)).results
    );
  }

  async function makeTestAaveTwo(countBlocks: number, tasks: IBorrowTask[]): Promise<IBorrowingTestResults[]> {
    const controller = await TetuConverterApp.createController(deployer);
    const templateAdapterStub = ethers.Wallet.createRandom().address;

    return CompareAprUsesCase.makePossibleBorrowsOnPlatform(
      deployer,
      "AAVETwo",
      await AdaptersHelper.createAaveTwoPlatformAdapter(deployer,
        controller.address,
        MaticAddresses.AAVE_TWO_POOL,
        templateAdapterStub,
      ),
      tasks,
      countBlocks,
      HEALTH_FACTOR2,
      async (
        deployer0,
        amountToBorrow0,
        p,
        additionalPoints
      ) => (await AprAaveTwo.makeBorrowTest(deployer0, amountToBorrow0, p, additionalPoints)).results
    );
  }

  async function makeTestDForce(countBlocks: number, tasks: IBorrowTask[]): Promise<IBorrowingTestResults[]> {
    const controller = await TetuConverterApp.createController(deployer);
    const templateAdapterStub = ethers.Wallet.createRandom().address;

    return CompareAprUsesCase.makePossibleBorrowsOnPlatform(
      deployer,
      "DForce",
      await AdaptersHelper.createDForcePlatformAdapter(deployer,
        controller.address,
        MaticAddresses.DFORCE_CONTROLLER,
        templateAdapterStub,
        [
          MaticAddresses.dForce_iDAI,
          MaticAddresses.dForce_iMATIC,
          MaticAddresses.dForce_iUSDC,
          MaticAddresses.dForce_iWETH,
          MaticAddresses.dForce_iUSDT,
          MaticAddresses.dForce_iWBTC,
          MaticAddresses.dForce_iEUX,
          MaticAddresses.dForce_iUSX,
          MaticAddresses.dForce_iDF,
          MaticAddresses.dForce_iAAVE,
          MaticAddresses.dForce_iCRV
        ]
      ),
      tasks,
      countBlocks,
      HEALTH_FACTOR2,
      async (
        deployer0,
        amountToBorrow0,
        p,
        additionalPoints,
      ) => (await AprDForce.makeBorrowTest(
        deployer0,
        amountToBorrow0,
        p,
        additionalPoints,
      )).results
    );
  }

  async function makeTestHundredFinance(countBlocks: number, tasks: IBorrowTask[]): Promise<IBorrowingTestResults[]> {
    const controller = await TetuConverterApp.createController(deployer);
    const templateAdapterStub = ethers.Wallet.createRandom().address;

    return CompareAprUsesCase.makePossibleBorrowsOnPlatform(
      deployer,
      "HundredFinance",
      await AdaptersHelper.createHundredFinancePlatformAdapter(deployer,
        controller.address,
        MaticAddresses.HUNDRED_FINANCE_COMPTROLLER,
        templateAdapterStub,
        [
          MaticAddresses.hDAI,
          MaticAddresses.hMATIC,
          MaticAddresses.hUSDC,
          MaticAddresses.hETH,
          MaticAddresses.hUSDT,
          MaticAddresses.hWBTC,
          MaticAddresses.hLINK,
          MaticAddresses.hFRAX,
        ],
      ),
      tasks,
      countBlocks,
      HEALTH_FACTOR2,
      async (
        deployer0,
        amountToBorrow0,
        p,
        additionalPoints
      ) => (await AprHundredFinance.makeBorrowTest(
        deployer0,
        amountToBorrow0,
        p,
        additionalPoints,
      )).results
    );
  }
//endregion Test impl
  describe("Make only swap tests", () =>{
    const COUNT_BLOCKS = COUNT_BLOCKS_LARGE;
    describe("Exact small amount", () => {
      it("SWAP", async () => {
        if (!await isPolygonForkInUse()) return;
        const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getSmallAmounts(listAssets));
        const ret = await makeTestSwap(COUNT_BLOCKS, tasks);
        appendSwapTestResultsToFile(PATH_OUT, ret);
      })
    });
    describe("Exact middle amount", () => {
      it("SWAP", async () => {
        if (!await isPolygonForkInUse()) return;
        const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getMiddleAmounts(listAssets));
        const ret = await makeTestSwap(COUNT_BLOCKS, tasks);
        appendSwapTestResultsToFile(PATH_OUT, ret);
      })
    });
    describe("Exact huge amount", () => {
      it("SWAP", async () => {
        if (!await isPolygonForkInUse()) return;
        const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getHugeAmounts(listAssets));
        const ret = await makeTestSwap(COUNT_BLOCKS, tasks);
        appendSwapTestResultsToFile(PATH_OUT, ret);
      })
    });
  });

  describe("Make all borrow tests", () => {
    describe("Small count of blocks", () => {
      const COUNT_BLOCKS = COUNT_BLOCKS_SMALL;
      describe("Exact small amount", () => {
        it("AAVE3", async () => {
          if (!await isPolygonForkInUse()) return;

          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getSmallAmounts(listAssets));
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getSmallAmounts(listAssets));
          const ret = await makeTestAaveTwo(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getSmallAmounts(listAssets));
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("HundredFinance", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getSmallAmounts(listAssets));
          const ret = await makeTestHundredFinance(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("SWAP", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getSmallAmounts(listAssets));
          const ret = await makeTestSwap(COUNT_BLOCKS, tasks);
          appendSwapTestResultsToFile(PATH_OUT, ret);
        })
      });
      describe("Exact middle amount", () => {
        it("AAVE3", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getMiddleAmounts(listAssets));
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getMiddleAmounts(listAssets));
          const ret = await makeTestAaveTwo(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getMiddleAmounts(listAssets));
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("HundredFinance", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getMiddleAmounts(listAssets));
          const ret = await makeTestHundredFinance(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("SWAP", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getMiddleAmounts(listAssets));
          const ret = await makeTestSwap(COUNT_BLOCKS, tasks);
          appendSwapTestResultsToFile(PATH_OUT, ret);
        })
      });
      describe("Exact huge amount", () => {
        it("AAVE3", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getHugeAmounts(listAssets));
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getHugeAmounts(listAssets));
          const ret = await makeTestAaveTwo(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getHugeAmounts(listAssets));
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("HundredFinance", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getHugeAmounts(listAssets));
          const ret = await makeTestHundredFinance(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("SWAP", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getHugeAmounts(listAssets));
          const ret = await makeTestSwap(COUNT_BLOCKS, tasks);
          appendSwapTestResultsToFile(PATH_OUT, ret);
        })
      });
    });
    describe("Large count of blocks", () => {
      const COUNT_BLOCKS = COUNT_BLOCKS_LARGE;
      describe("Exact small amount", () => {
        it("AAVE3", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getSmallAmounts(listAssets));
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getSmallAmounts(listAssets));
          const ret = await makeTestAaveTwo(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getSmallAmounts(listAssets));
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("HundredFinance", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getSmallAmounts(listAssets));
          const ret = await makeTestHundredFinance(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("SWAP", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getSmallAmounts(listAssets));
          const ret = await makeTestSwap(COUNT_BLOCKS, tasks);
          appendSwapTestResultsToFile(PATH_OUT, ret);
        })
      });
      describe("Exact middle amount", () => {
        it("SWAP", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getMiddleAmounts(listAssets));
          const ret = await makeTestSwap(COUNT_BLOCKS, tasks);
          appendSwapTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVE3", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getMiddleAmounts(listAssets));
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getMiddleAmounts(listAssets));
          const ret = await makeTestAaveTwo(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getMiddleAmounts(listAssets));
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("HundredFinance", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getMiddleAmounts(listAssets));
          const ret = await makeTestHundredFinance(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })

      });
      describe("Exact huge amount", () => {
        it("AAVE3", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getHugeAmounts(listAssets));
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getHugeAmounts(listAssets));
          const ret = await makeTestAaveTwo(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getHugeAmounts(listAssets));
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("HundredFinance", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getHugeAmounts(listAssets));
          const ret = await makeTestHundredFinance(COUNT_BLOCKS, tasks);
          appendBorrowingTestResultsToFile(PATH_OUT, ret);
        })
        it("SWAP", async () => {
          if (!await isPolygonForkInUse()) return;
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(listAssets, await getHugeAmounts(listAssets));
          const ret = await makeTestSwap(COUNT_BLOCKS, tasks);
          appendSwapTestResultsToFile(PATH_OUT, ret);
        })
      });
    });
    describe.skip("Debug DForce USDT:USDC", () => {
      it("Dforce USDT:USDC", async () => {
        if (!await isPolygonForkInUse()) return;
        const tasks: IBorrowTask[] = [
          {
            collateralAsset: listAssets.find(x => x.title === "USDT")!,
            borrowAsset: listAssets.find(x => x.title === "USDC")!,
            collateralAmount: BigNumber.from("3355000000"),
          }
        ];
        const ret = await makeTestDForce(COUNT_BLOCKS_LARGE, tasks);
        appendBorrowingTestResultsToFile(PATH_OUT, ret);
        const {sret, sexpected} = validate(ret);
        expect(sret).eq(sexpected);
      })
    });
    describe.skip("Debug DForce WETH:USDC", () => {
      it("Dforce WETH:DAI", async () => {
        if (!await isPolygonForkInUse()) return;
        const tasks: IBorrowTask[] = [
          {
            collateralAsset: listAssets.find(x => x.title === "WETH")!,
            borrowAsset: listAssets.find(x => x.title === "USDC")!,
            collateralAmount: Misc.WEI,
          }
        ];
        const ret = await makeTestDForce(COUNT_BLOCKS_LARGE, tasks);
        appendBorrowingTestResultsToFile(PATH_OUT, ret);
        const {sret, sexpected} = validate(ret);
        expect(sret).eq(sexpected);
      })
    });
    describe.skip("Debug AAVE3 USDC:USDT", () => {
      it("AAVE3 USDC:USDT", async () => {
        if (!await isPolygonForkInUse()) return;
        const tasks: IBorrowTask[] = [
          {
            collateralAsset: listAssets.find(x => x.title === "USDC")!,
            borrowAsset: listAssets.find(x => x.title === "USDT")!,
            collateralAmount: getBigNumberFrom(1, 8),
          }
        ];
        const ret = await makeTestAave3(COUNT_BLOCKS_LARGE, tasks);
        appendBorrowingTestResultsToFile(PATH_OUT, ret);
        const {sret, sexpected} = validate(ret);
        expect(sret).eq(sexpected);
      })
    });
    describe.skip("Debug HundredFinance WETH:USDC", () => {
      it("Dforce WETH:DAI", async () => {
        if (!await isPolygonForkInUse()) return;
        const tasks: IBorrowTask[] = [
          {
            collateralAsset: listAssets.find(x => x.title === "WETH")!,
            borrowAsset: listAssets.find(x => x.title === "USDC")!,
            collateralAmount: Misc.WEI,
          }
        ];
        const ret = await makeTestHundredFinance(COUNT_BLOCKS_LARGE, tasks);
        appendBorrowingTestResultsToFile(PATH_OUT, ret);
        const {sret, sexpected} = validate(ret);
        expect(sret).eq(sexpected);
      })
    });
  });
});

