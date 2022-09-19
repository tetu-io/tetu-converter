import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {CompareAprUsesCase, IBorrowTask, IBorrowTestResults} from "../baseUT/uses-cases/CompareAprUsesCase";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {IAssetInfo} from "../baseUT/apr/aprDataTypes";
import {BigNumber} from "ethers";
import {IERC20Extended__factory} from "../../typechain";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {AprAave3} from "../baseUT/apr/aprAave3";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {AdaptersHelper} from "../baseUT/helpers/AdaptersHelper";
import {AprAaveTwo} from "../baseUT/apr/aprAaveTwo";
import {AprDForce} from "../baseUT/apr/aprDForce";
import {appendTestResultsToFile} from "../baseUT/apr/aprUtils";
import {areAlmostEqual} from "../baseUT/utils/CommonUtils";
import {expect} from "chai";

describe("CompareAprUsesCaseTest", () => {
//region Constants
  const PATH_OUT = "tmp/compareResults.csv";
  const HEALTH_FACTOR2 = 400;
  const COUNT_BLOCKS_SMALL = 2;
  const COUNT_BLOCKS_LARGE = 2_000;

  const assets: IAssetInfo[] = [
    {
      asset: MaticAddresses.USDT, title: "USDT", holders: [
        MaticAddresses.HOLDER_USDT
        , MaticAddresses.HOLDER_USDT_1
        , MaticAddresses.HOLDER_USDT_2
        , MaticAddresses.HOLDER_USDT_3
      ]
    }
    , {
      asset: MaticAddresses.DAI, title: "DAI", holders: [
        MaticAddresses.HOLDER_DAI
        , MaticAddresses.HOLDER_DAI_2
        , MaticAddresses.HOLDER_DAI_3
        , MaticAddresses.HOLDER_DAI_4
        , MaticAddresses.HOLDER_DAI_5
        , MaticAddresses.HOLDER_DAI_6
      ]
    }
    , {
      asset: MaticAddresses.USDC, title: "USDC", holders: [
        MaticAddresses.HOLDER_USDC
      ]
    }
    , {
      asset: MaticAddresses.WMATIC, title: "WMATIC", holders: [
        MaticAddresses.HOLDER_WMATIC,
        MaticAddresses.HOLDER_WMATIC_2,
        MaticAddresses.HOLDER_WMATIC_3
      ]
    }
    , {
      asset: MaticAddresses.WBTC, title: "WBTC", holders: [
        MaticAddresses.HOLDER_WBTC
      ]
    }
    , {
      asset: MaticAddresses.WETH, title: "WETH", holders: [
        MaticAddresses.HOLDER_WETH
        , MaticAddresses.HOLDER_WETH_2
        , MaticAddresses.HOLDER_WETH_3
      ]
    }
    , {
      asset: MaticAddresses.ChainLink, title: "ChainLink", holders: [
        MaticAddresses.HOLDER_ChainLink
      ]
    }
    , {
      asset: MaticAddresses.EURS, title: "EURS", holders: [
        MaticAddresses.HOLDER_EURS
        , MaticAddresses.HOLDER_EURS_2
        , MaticAddresses.HOLDER_EURS_3
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

//region Utils
  /**
   * For each asset generate small amount
   *        0.1 * 10^AssetDecimals
   * */
  async function getSmallAmounts(assets: IAssetInfo[]) : Promise<BigNumber[]> {
    return Promise.all(
      assets.map(
        async x => {
            const decimals = await IERC20Extended__factory.connect(x.asset, deployer).decimals();
            return getBigNumberFrom(1, decimals).div(10);
        }
      )
    )
  }

  /**
   * For each asset generate middle amount
   *     1000 * 10^AssetDecimals
   * */
  async function getMiddleAmounts(assets: IAssetInfo[]) : Promise<BigNumber[]> {
    return Promise.all(
      assets.map(
        async x => {
          const decimals = await IERC20Extended__factory.connect(x.asset, deployer).decimals();
          return getBigNumberFrom(1, decimals)
            .mul(
              x.asset === MaticAddresses.WBTC
                  ? 5
                  : 100
            );
        }
      )
    )
  }

  function validate(items: IBorrowTestResults[]) : {sret: string, sexpected: string} {
    const ret = [
      // predicted apr-supply is undefined or zero
      items.filter(x => !x.results?.predicted.aprBt36.collateral).length,
      // predicted apr-borrow is undefined or zero
      items.filter(x => !x.results?.predicted.aprBt36.borrow).length,

      // predicted apr-supply is almost equal to real one
      items.filter(
        x =>
          x.results?.resultsBlock.aprBt36.collateral
          && x.results?.predicted.aprBt36.collateral
          && areAlmostEqual(
            x.results?.resultsBlock.aprBt36.collateral,
            x.results?.predicted.aprBt36.collateral.div(getBigNumberFrom(1, 18)),
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
//endregion Utils

//region Test impl
  async function makeTestAave3(countBlocks: number, tasks: IBorrowTask[]): Promise<IBorrowTestResults[]> {
    const controller = await CoreContractsHelper.createController(deployer);
    const templateAdapterStub = ethers.Wallet.createRandom().address;

    return await CompareAprUsesCase.makePossibleBorrowsOnPlatform(
      deployer
      , "AAVE3"
      , await AdaptersHelper.createAave3PlatformAdapter(deployer
        , controller.address
        , MaticAddresses.AAVE_V3_POOL
        , templateAdapterStub
        , templateAdapterStub
      )
      , tasks
      , countBlocks
      , HEALTH_FACTOR2
      , async (
          deployer
          , amountToBorrow0
          , p
          , additionalPoints
        ) => (await AprAave3.makeBorrowTest(deployer, amountToBorrow0, p, additionalPoints)).results
    );
  }

  async function makeTestAaveTwo(countBlocks: number, tasks: IBorrowTask[]): Promise<IBorrowTestResults[]> {
    const controller = await CoreContractsHelper.createController(deployer);
    const templateAdapterStub = ethers.Wallet.createRandom().address;

    return await CompareAprUsesCase.makePossibleBorrowsOnPlatform(
      deployer
      , "AAVETwo"
      , await AdaptersHelper.createAaveTwoPlatformAdapter(deployer
        , controller.address
        , MaticAddresses.AAVE_TWO_POOL
        , templateAdapterStub
      )
      , tasks
      , countBlocks
      , HEALTH_FACTOR2
      , async (
        deployer
        , amountToBorrow0
        , p
        , additionalPoints
      ) => (await AprAaveTwo.makeBorrowTest(deployer, amountToBorrow0, p, additionalPoints)).results
    );
  }

  async function makeTestDForce(countBlocks: number, tasks: IBorrowTask[]): Promise<IBorrowTestResults[]> {
    const controller = await CoreContractsHelper.createController(deployer);
    const templateAdapterStub = ethers.Wallet.createRandom().address;

    return await CompareAprUsesCase.makePossibleBorrowsOnPlatform(
      deployer
      , "DForce"
      , await AdaptersHelper.createDForcePlatformAdapter(deployer
        , controller.address
        , MaticAddresses.DFORCE_CONTROLLER
        , templateAdapterStub
        , [
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
      )
      , tasks
      , countBlocks
      , HEALTH_FACTOR2
      , async (
        deployer
        , amountToBorrow0
        , p
        , additionalPoints
      ) => (await AprDForce.makeBorrowTest(
        deployer
        , amountToBorrow0
        , p
        , additionalPoints
      )).results
    );
  }
//endregion Test impl

  describe("Make all borrow tests", () => {
    describe("Small count of blocks (2 days)", () => {
      const COUNT_BLOCKS = COUNT_BLOCKS_SMALL;
      describe("Exact small amount", () => {
        it("AAVE3", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , true
            , await getSmallAmounts(assets)
          );
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , true
            , await getSmallAmounts(assets)
          );
          const ret = await makeTestAaveTwo(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , true
            , await getSmallAmounts(assets)
          );
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
      });
      describe("Exact middle amount", () => {
        it("AAVE3", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , true
            , await getMiddleAmounts(assets)
          );
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , true
            , await getMiddleAmounts(assets)
          );
          const ret = await makeTestAaveTwo(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , true
            , await getMiddleAmounts(assets)
          );
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
      });
      describe("Half of max allowed amount", () => {
        it("AAVE3", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , false
            , assets.map(x => getBigNumberFrom(5, 17))
          );
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , false
            , assets.map(x => getBigNumberFrom(5, 17))
          );
          const ret = await makeTestAaveTwo(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , false
            , assets.map(x => getBigNumberFrom(5, 17))
          );
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
      });
      describe.skip("Debug AAVE3", () => {
        it("AAVE3 DAI:USDC", async () => {
          const tasks: IBorrowTask[] = [
            {
              collateralAsset: assets.find(x => x.title == "DAI")!,
              borrowAsset: assets.find(x => x.title == "USDC")!,
              amountToBorrow: getBigNumberFrom(100, 6),
              exactAmountToBorrow: true
            }
          ];
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
          const {sret, sexpected} = validate(ret);
          expect(sret).eq(sexpected);
        })
        it("AAVE3 WBTC:DAI", async () => {
          const tasks: IBorrowTask[] = [
            {
              collateralAsset: assets.find(x => x.title == "WBTC")!,
              borrowAsset: assets.find(x => x.title == "DAI")!,
              amountToBorrow: getBigNumberFrom(100, 18),
              exactAmountToBorrow: true
            }
          ];
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
          const {sret, sexpected} = validate(ret);
          expect(sret).eq(sexpected);
        })
        it("AAVE3 Dai:ChainLink", async () => {
          const tasks: IBorrowTask[] = [
            {
              collateralAsset: assets.find(x => x.title == "DAI")!,
              borrowAsset: assets.find(x => x.title == "ChainLink")!,
              amountToBorrow: getBigNumberFrom(100, 18),
              exactAmountToBorrow: true
            }
          ];
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
          const {sret, sexpected} = validate(ret);
          expect(sret).eq(sexpected);
        })
        it("AAVE3 Sushi:WBTC", async () => {
          const tasks: IBorrowTask[] = [
            {
              collateralAsset: assets.find(x => x.title == "SUSHI")!,
              borrowAsset: assets.find(x => x.title == "WBTC")!,
              amountToBorrow: getBigNumberFrom(1, 7), //0.1 WBTC
              exactAmountToBorrow: true
            }
          ];
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
          const {sret, sexpected} = validate(ret);
          expect(sret).eq(sexpected);
        })
        it("AAVE3 BALANCER:WETH", async () => {
          const tasks: IBorrowTask[] = [
            {
              collateralAsset: assets.find(x => x.title == "BALANCER")!,
              borrowAsset: assets.find(x => x.title == "WETH")!,
              amountToBorrow: getBigNumberFrom(1, 18),
              exactAmountToBorrow: true
            }
          ];
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
          const {sret, sexpected} = validate(ret);
          expect(sret).eq(sexpected);
        })
      })
      describe.skip("Debug DForce", () => {
        it("AAVE3 DAI:WBTC", async () => {
          const tasks: IBorrowTask[] = [
            {
              collateralAsset: assets.find(x => x.title == "DAI")!,
              borrowAsset: assets.find(x => x.title == "WBTC")!,
              amountToBorrow: getBigNumberFrom(1, 8),
              exactAmountToBorrow: true
            }
          ];
          const ret = await makeTestDForce(COUNT_BLOCKS_SMALL, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
          const {sret, sexpected} = validate(ret);
          expect(sret).eq(sexpected);
        })
        it("AAVE3 WMATIC:WETH", async () => {
          const tasks: IBorrowTask[] = [
            {
              collateralAsset: assets.find(x => x.title == "WMATIC")!,
              borrowAsset: assets.find(x => x.title == "WETH")!,
              amountToBorrow: getBigNumberFrom(1, 18),
              exactAmountToBorrow: true
            }
          ];
          const ret = await makeTestDForce(COUNT_BLOCKS_SMALL, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
          const {sret, sexpected} = validate(ret);
          expect(sret).eq(sexpected);
        })
      });
    });
    describe("Large count of blocks", () => {
      const COUNT_BLOCKS = COUNT_BLOCKS_LARGE;
      describe("Exact small amount", () => {
        it("AAVE3", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , true
            , await getSmallAmounts(assets)
          );
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , true
            , await getSmallAmounts(assets)
          );
          const ret = await makeTestAaveTwo(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , true
            , await getSmallAmounts(assets)
          );
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
      });
      describe("Exact middle amount", () => {
        it("AAVE3", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , true
            , await getMiddleAmounts(assets)
          );
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , true
            , await getMiddleAmounts(assets)
          );
          const ret = await makeTestAaveTwo(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , true
            , await getMiddleAmounts(assets)
          );
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
      });
      describe("A part of max allowed amount", () => {
        it("AAVE3", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , false
            , assets.map(x => getBigNumberFrom(3, 17))
          );
          const ret = await makeTestAave3(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , false
            , assets.map(x => getBigNumberFrom(5, 17))
          );
          const ret = await makeTestAaveTwo(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          const tasks: IBorrowTask[] = CompareAprUsesCase.generateTasks(assets
            , false
            , assets.map(x => getBigNumberFrom(5, 17))
          );
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
        })
      });
      describe.skip("Debug DForce", () => {
        it("DForce DAI:WBTC", async () => {
          const tasks: IBorrowTask[] = [
            {
              collateralAsset: assets.find(x => x.title == "DAI")!,
              borrowAsset: assets.find(x => x.title == "USDC")!,
              amountToBorrow: getBigNumberFrom(5, 6),
              exactAmountToBorrow: true
            }
          ];
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
          const {sret, sexpected} = validate(ret);
          expect(sret).eq(sexpected);
        })
      });
      describe("Debug DForce DAI", () => {
        it("DForce DAI:WETH", async () => {
          const tasks: IBorrowTask[] = [
            {
              collateralAsset: assets.find(x => x.title == "DAI")!,
              borrowAsset: assets.find(x => x.title == "WETH")!,
              amountToBorrow: getBigNumberFrom(1, 17),
              collateralAmount: BigNumber.from("3355117817885310000000"),
              exactAmountToBorrow: true
            }
          ];
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
          const {sret, sexpected} = validate(ret);
          expect(sret).eq(sexpected);
        })
      });
      describe("Debug DForce WETH:USDT", () => {
        it("DForce WETH:USDT", async () => {
          const countBlocks = 1000;
          const tasks: IBorrowTask[] = [
            {
              collateralAsset: assets.find(x => x.title == "WETH")!,
              borrowAsset: assets.find(x => x.title == "USDT")!,
              amountToBorrow: BigNumber.from("6711760000"),
              collateralAmount: getBigNumberFrom(20, 18),
              exactAmountToBorrow: true
            }
          ];
          const ret = await makeTestDForce(countBlocks, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
          const {sret, sexpected} = validate(ret);
          expect(sret).eq(sexpected);
        })
      });
      describe("Debug DForce DAI:USDT", () => {
        it("DForce DAI:USDT", async () => {
          const tasks: IBorrowTask[] = [
            {
              collateralAsset: assets.find(x => x.title == "DAI")!,
              borrowAsset: assets.find(x => x.title == "USDT")!,
              amountToBorrow: getBigNumberFrom(100, 6), // getBigNumberFrom(1, 6),
              collateralAmount: getBigNumberFrom(2000, 18), // BigNumber.from("3355117817885310000000"),
              exactAmountToBorrow: true
            }
          ];
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
          const {sret, sexpected} = validate(ret);
          expect(sret).eq(sexpected);
        })
      });
      describe.skip("Debug DForce", () => {
        it("Dforce USDT:WETH", async () => {
          const tasks: IBorrowTask[] = [
            {
              collateralAsset: assets.find(x => x.title == "USDT")!,
              borrowAsset: assets.find(x => x.title == "WETH")!,
              amountToBorrow: getBigNumberFrom(1, 17),
              collateralAmount: BigNumber.from("3355000000"),
              exactAmountToBorrow: true
            }
          ];
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
          const {sret, sexpected} = validate(ret);
          expect(sret).eq(sexpected);
        })
      });
      describe.skip("Debug DForce", () => {
        it("Dforce USDT:USDC", async () => {
          const tasks: IBorrowTask[] = [
            {
              collateralAsset: assets.find(x => x.title == "USDT")!,
              borrowAsset: assets.find(x => x.title == "USDC")!,
              amountToBorrow: getBigNumberFrom(1, 8),
              collateralAmount: BigNumber.from("3355000000"),
              exactAmountToBorrow: true
            }
          ];
          const ret = await makeTestDForce(COUNT_BLOCKS, tasks);
          appendTestResultsToFile(PATH_OUT, ret);
          const {sret, sexpected} = validate(ret);
          expect(sret).eq(sexpected);
        })
      });
    });
  });
});

