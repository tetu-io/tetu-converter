import {TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IConversionPlan,
  IAssetInfo,
  IBorrowResults
} from "../apr/aprDataTypes";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {IERC20__factory, IERC20Extended__factory, IPlatformAdapter} from "../../../typechain";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {Misc} from "../../../scripts/utils/Misc";
import {ConfigurableAmountToBorrow} from "../apr/ConfigurableAmountToBorrow";
import {toMantissa} from "../utils/CommonUtils";

//region Data types
interface IInputParams {
  amountToBorrow: number | BigNumber;
  params: TestSingleBorrowParams;
  additionalPoints: number[];
}

/** I.e. one of AprXXX.makeBorrowTest */
export type BorrowTestMaker = (
  deployer: SignerWithAddress,
  amountToBorrow: number | BigNumber,
  p: TestSingleBorrowParams,
  additionalPoints: number[]
) => Promise<IBorrowResults>;

export interface IBorrowTestResults {
  platformTitle: string;
  countBlocks: number;

  assetCollateral: IAssetInfo;
  collateralAmount: BigNumber;

  assetBorrow: IAssetInfo;

  /* Plan for 1 block - we need to compare borrow/supply APR*/
  planSingleBlock: IConversionPlan;
  /* Plan for full period - we need to compare reward amounts */
  planFullPeriod: IConversionPlan;
  results?: IBorrowResults;

  error?: string;
}

export interface IBorrowTask {
  collateralAsset: IAssetInfo;
  borrowAsset: IAssetInfo;
  collateralAmount: BigNumber;
}
//endregion Data types

export class CompareAprUsesCase {
  static async makeSingleBorrowTest(
    title: string,
    p: IInputParams,
    testMaker: BorrowTestMaker
  ) : Promise<{
    results?: IBorrowResults
    error?: string
  } > {
    const signers = await ethers.getSigners();
    const deployer = signers[0];

    try {
      console.log("START", title);
      return {
        results: await testMaker(deployer, p.amountToBorrow, p.params, p.additionalPoints)
      }
    } catch (e: any) {
      console.log(e);
      const re = /VM Exception while processing transaction: reverted with reason string\s*(.*)/i;
      if (e.message) {
        const found = e.message.match(re);
        console.log("found", found)
        if (found && found[1]) {
          return {
            error: found[1]
          }
        }
      }
    } finally {
      console.log("FINISH", title);
    }

    return {
      error: "Unknown error"
    }
  }

  static generateTasks(
    assets: IAssetInfo[],
    collateralAmounts: BigNumber[]
  ) : IBorrowTask[] {
    const dest: IBorrowTask[] = [];
    for (const [indexSource, sourceAsset] of assets.entries()) {
      for (const [indexTarget, targetAsset] of assets.entries()) {
        if (sourceAsset === targetAsset) continue;
        dest.push({
          collateralAsset: sourceAsset,
          borrowAsset: targetAsset,
          collateralAmount: collateralAmounts[indexSource],
        });
      }
    }
    return dest;
  }

  /**
   * Enumerate all possible pairs of the asset.
   * Find all pairs for which the borrow is possible.
   * Use max available amount of source asset as collateral.
   * Make borrow test and grab results.
   * @param deployer
   * @param platformTitle
   * @param platformAdapter
   * @param tasks
   * @param countBlocks
   * @param healthFactor2
   * @param testMaker
   */
  static async makePossibleBorrowsOnPlatform(
    deployer: SignerWithAddress,
    platformTitle: string,
    platformAdapter: IPlatformAdapter,
    tasks: IBorrowTask[],
    countBlocks: number,
    healthFactor2: number,
    testMaker: BorrowTestMaker
  ) : Promise<IBorrowTestResults[]> {
    console.log("makePossibleBorrowsOnPlatform:", platformTitle);
    const dest: IBorrowTestResults[] = [];

    for (const task of tasks) {
      const holders = task.collateralAsset.holders;
      const initialLiquidity = await CompareAprUsesCase.getTotalAmount(deployer, task.collateralAsset.asset, holders);
      const collateralDecimals = await IERC20Extended__factory.connect(task.collateralAsset.asset, deployer).decimals();

      console.log("makePossibleBorrowsOnPlatform, task:", task);

      const snapshot = await TimeUtils.snapshot();
      try {
        const borrowDecimals = await IERC20Extended__factory.connect(task.borrowAsset.asset, deployer).decimals();
        const stPrices = await this.getPrices(platformAdapter, task.collateralAsset, task.borrowAsset);
        if (stPrices) {
          console.log("makePossibleBorrowsOnPlatform.collateralAmount", task.collateralAmount);

          const borrowAmountFactor18 = this.getBorrowAmountFactor18(
            task.collateralAmount
            , healthFactor2
            , collateralDecimals
          );
          console.log("makePossibleBorrowsOnPlatform.borrowAmountFactor18", borrowAmountFactor18);

          const planSingleBlock = await platformAdapter.getConversionPlan(
            task.collateralAsset.asset
            , task.collateralAmount
            , task.borrowAsset.asset
            , borrowAmountFactor18
            , 1 // we need 1 block for next/last; countBlocks are used as additional-points
          );
          console.log("planSingleBlock", planSingleBlock);

          const planFullPeriod = await platformAdapter.getConversionPlan(
            task.collateralAsset.asset
            , task.collateralAmount
            , task.borrowAsset.asset
            , borrowAmountFactor18
            , countBlocks
          );
          console.log("planFullPeriod", planFullPeriod);

          const borrowAmount18 = planFullPeriod.liquidationThreshold18
            .mul(borrowAmountFactor18)
            .div(Misc.WEI)
          const amountToBorrow = toMantissa(borrowAmount18, 18, borrowDecimals);
          console.log("makePossibleBorrowsOnPlatform.amountToBorrow", amountToBorrow);

          if (planSingleBlock.converter === Misc.ZERO_ADDRESS) {
            dest.push({
              platformTitle,
              countBlocks,
              assetBorrow: task.borrowAsset,
              assetCollateral: task.collateralAsset,
              collateralAmount: task.collateralAmount,
              planSingleBlock,
              planFullPeriod,
              error: "Plan not found",
            });
          } else {
            const p: TestSingleBorrowParams = {
              collateral: {
                asset: task.collateralAsset.asset,
                holder: task.collateralAsset.holders.join(";"),
                initialLiquidity,
              },
              borrow: {
                asset: task.borrowAsset.asset,
                holder: task.borrowAsset.holders.join(";"),
                initialLiquidity: 0,
              },
              collateralAmount: task.collateralAmount,
              healthFactor2,
              countBlocks: 1 // we need 1 block for next/last; countBlocks are used as additional-points
            };
            const res = await this.makeSingleBorrowTest(
              platformTitle,
              {
                params: p,
                amountToBorrow,
                additionalPoints: [countBlocks]
              },
              testMaker
            );
            dest.push({
              platformTitle,
              countBlocks,
              assetBorrow: task.borrowAsset,
              assetCollateral: task.collateralAsset,
              collateralAmount: task.collateralAmount,
              planSingleBlock,
              planFullPeriod,
              results: res.results,
              error: res.error
            });
          }
        }
      } finally {
        await TimeUtils.rollback(snapshot);
      }
    }

    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    console.log("makePossibleBorrowsOnPlatform finished:", dest);
    return dest;
  }

  private static async getPrices(
    platformAdapter: IPlatformAdapter,
    sourceAsset: IAssetInfo,
    targetAsset: IAssetInfo
  ) : Promise<{
   priceCollateral: BigNumber,
   priceBorrow: BigNumber
  } | undefined > {
    try {
      const stPrices = await platformAdapter.getAssetsPrices([sourceAsset.asset, targetAsset.asset]);
      console.log("prices", stPrices);
      return {priceCollateral: stPrices[0], priceBorrow: stPrices[1]};
    } catch {
      console.log("Cannot get prices for the assets unsupported by the platform");
    }
  }


  /** see definition of borrowAmountFactor18 inside BorrowManager._findPool */
  public static getBorrowAmountFactor18(
    collateralAmount: BigNumber,
    healthFactor2: number,
    collateralDecimals: number
  ) {
    return getBigNumberFrom(1, 18)
      .mul(toMantissa(collateralAmount, collateralDecimals, 18))
      .div(healthFactor2)
      .div(getBigNumberFrom(1, 18 - 2));
  }

  /** calculate approx amount of collateral required to borrow required amount with collateral factor = 0.2 */
  private static getApproxCollateralAmount(
    amountToBorrow: BigNumber,
    healthFactor2: number,
    collateralDecimals: number,
    stPrices: {priceCollateral: BigNumber, priceBorrow: BigNumber},
    borrowDecimals: number
  ) {
    return amountToBorrow
      .mul(5) //cf = 0.2
      .mul(healthFactor2).div(100)
      .mul(getBigNumberFrom(1, collateralDecimals))
      .mul(stPrices.priceBorrow)
      .div(stPrices.priceCollateral)
      .div(getBigNumberFrom(1, borrowDecimals));
  }

  /** Get total balance of the asset for all holders */
  static async getTotalAmount(
    deployer: SignerWithAddress
    , asset: string
    , holders: string[]
  ) : Promise<BigNumber> {
    let dest = BigNumber.from(0);
    for (const holder of holders) {
      const balance = await IERC20__factory.connect(asset, deployer).balanceOf(holder);
      console.log(`getTotalAmount holder=${holder} balance=${balance.toString()}`);
      dest = dest.add(balance);
    }
    return dest;
  }
}