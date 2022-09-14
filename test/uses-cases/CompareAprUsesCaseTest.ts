import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {CompareAprUsesCase, IBorrowTestResults} from "../baseUT/uses-cases/CompareAprUsesCase";
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

describe("CompareAprUsesCaseTest", () => {
//region Constants
  const PATH_OUT = "tmp/compareResults.csv";
  const HEALTH_FACTOR2 = 400;
  const COUNT_BLOCKS_SMALL = 2;
  const COUNT_BLOCKS_NORMAL = 80_000;
  const COUNT_BLOCK_HUGE = 30*40_000;

  const assets: IAssetInfo[] = [
    {
      asset: MaticAddresses.DAI, title: "DAI", holders: [
        MaticAddresses.HOLDER_DAI
        , MaticAddresses.HOLDER_DAI_2
        , MaticAddresses.HOLDER_DAI_3
        , MaticAddresses.HOLDER_DAI_4
        , MaticAddresses.HOLDER_DAI_5
        , MaticAddresses.HOLDER_DAI_6
      ]
    } ,
    {
      asset: MaticAddresses.USDC, title: "USDC", holders: [
        MaticAddresses.HOLDER_USDC
      ]
    },
    {
      asset: MaticAddresses.USDT, title: "USDT", holders: [
        MaticAddresses.HOLDER_USDT
        , MaticAddresses.HOLDER_USDT_1
        , MaticAddresses.HOLDER_USDT_2
        , MaticAddresses.HOLDER_USDT_3
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
      asset: MaticAddresses.WBTC, title: "WBTS", holders: [
        MaticAddresses.HOLDER_WBTC
      ]
    }
    // , {
    //   asset: MaticAddresses.ChainLink, title: "ChainLink", holders: [
    //     MaticAddresses.HOLDER_ChainLink
    //   ]
    // }
    // , {
    //   asset: MaticAddresses.DefiPulseToken, title: "DefiPulseToken", holders: [
    //     MaticAddresses.HOLDER_DefiPulseToken
    //   ]
    // } , {
    //   asset: MaticAddresses.AavegotchiGHST, title: "AavegotchiGHST", holders: [
    //     MaticAddresses.HOLDER_AavegotchiGHST
    //   ]
    // }
    , {
      asset: MaticAddresses.CRV, title: "CRV", holders: [
        MaticAddresses.HOLDER_CRV
      ]
    } ,
    {
      asset: MaticAddresses.SUSHI, title: "SUSHI", holders: [
        MaticAddresses.HOLDER_Sushi
        , MaticAddresses.HOLDER_Sushi_2
      ]
    }
    , {
      asset: MaticAddresses.WETH, title: "WETH", holders: [
        MaticAddresses.HOLDER_WETH
        , MaticAddresses.HOLDER_WETH_2
        , MaticAddresses.HOLDER_WETH_3
      ]
    } , {
      asset: MaticAddresses.BALANCER, title: "BALANCER", holders: [
        MaticAddresses.HOLDER_BALANCER
      ]
    } , {
      asset: MaticAddresses.EURS, title: "EURS", holders: [
        MaticAddresses.HOLDER_EURS
      ]
    } , {
      asset: MaticAddresses.jEUR, title: "jEUR", holders: [
        MaticAddresses.HOLDER_jEUR
        , MaticAddresses.HOLDER_jEUR_2
      ]
    }

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
                  ? 10
                  : 1000
            );
        }
      )
    )
  }

//endregion Utils

//region Test impl
  async function makeTestAave3(
    countBlocks: number,
    exactAmountToBorrow: boolean,
    amountsToBorrow: BigNumber[],
  ): Promise<IBorrowTestResults[]> {
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
      , assets
      , exactAmountToBorrow
      , amountsToBorrow
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

  async function makeTestAaveTwo(
    countBlocks: number,
    exactAmountToBorrow: boolean,
    amountsToBorrow: BigNumber[],
  ): Promise<IBorrowTestResults[]> {
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
      , assets
      , exactAmountToBorrow
      , amountsToBorrow
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

  async function makeTestDForce(
    countBlocks: number,
    exactAmountToBorrow: boolean,
    amountsToBorrow: BigNumber[],
  ): Promise<IBorrowTestResults[]> {
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
          MaticAddresses.hDAI,
          MaticAddresses.hMATIC,
          MaticAddresses.hUSDC,
          MaticAddresses.hETH,
          MaticAddresses.hUSDT,
          MaticAddresses.hWBTC,
          MaticAddresses.hFRAX,
          MaticAddresses.hLINK,
        ]
      )
      , assets
      , exactAmountToBorrow
      , amountsToBorrow
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
    describe("Normal count of blocks (2 days)", () => {
      describe("Exact small amount", () => {
        it("AAVE3", async () => {
          const ret = await makeTestAave3(
            COUNT_BLOCKS_SMALL
            ,true
            , await getSmallAmounts(assets)
          );
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          const ret = await makeTestAaveTwo(
            COUNT_BLOCKS_SMALL
            ,true
            , await getSmallAmounts(assets)
          );
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          const ret = await makeTestDForce(
            COUNT_BLOCKS_SMALL
            ,true
            , await getSmallAmounts(assets)
          );
          appendTestResultsToFile(PATH_OUT, ret);
        })
      });
      describe("Exact middle amount", () => {
        it("AAVE3", async () => {
          const ret = await makeTestAave3(
            COUNT_BLOCKS_SMALL
            ,true
            , await getMiddleAmounts(assets)
          );
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("AAVETwo", async () => {
          const ret = await makeTestAaveTwo(
            COUNT_BLOCKS_SMALL
            ,true
            , await getMiddleAmounts(assets)
          );
          appendTestResultsToFile(PATH_OUT, ret);
        })
        it("DForce", async () => {
          const ret = await makeTestDForce(
            COUNT_BLOCKS_SMALL
            ,true
            , await getMiddleAmounts(assets)
          );
          appendTestResultsToFile(PATH_OUT, ret);
        })
      });
    });

  });
});

