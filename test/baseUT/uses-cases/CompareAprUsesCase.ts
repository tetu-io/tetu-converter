import {ITestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IConversionPlan,
  IAssetInfo,
  IBorrowResults, ISwapResults, IStrategyToConvert
} from "../apr/aprDataTypes";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {
  IERC20__factory,
  IERC20Extended__factory,
  IPlatformAdapter,
  SwapManager
} from "../../../typechain";
import {BigNumber} from "ethers";
import {Misc} from "../../../scripts/utils/Misc";
import {AprUtils} from "../utils/aprUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {AppDataTypes} from "../../../typechain/contracts/core/SwapManager";
import {BalanceUtils} from "../utils/BalanceUtils";

//region Data types
interface IInputParams {
  amountToBorrow: number | BigNumber;
  params: ITestSingleBorrowParams;
  additionalPoints: number[];
}

/** I.e. one of AprXXX.makeBorrowTest */
export type BorrowTestMaker = (
  deployer: SignerWithAddress,
  amountToBorrow: number | BigNumber,
  p: ITestSingleBorrowParams,
  additionalPoints: number[]
) => Promise<IBorrowResults>;

export interface IBorrowingTestResults {
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

export interface ISwapTestResults {
  assetCollateral: IAssetInfo;
  collateralAmount: BigNumber;

  assetBorrow: IAssetInfo;

  strategyToConvert: IStrategyToConvert;
  results?: ISwapResults;

  error?: string;
}

export interface IBorrowTask {
  collateralAsset: IAssetInfo;
  borrowAsset: IAssetInfo;
  collateralAmount: BigNumber;
}
//endregion Data types

export class CompareAprUsesCase {

//region Borrowing
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
      // tslint:disable-next-line:no-any
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
//endregion Borrowing

//region Utils
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

  /** Get total balance of the asset for all holders */
  static async getTotalAmount(
    deployer: SignerWithAddress,
    asset: string,
    holders: string[]
  ) : Promise<BigNumber> {
    let dest = BigNumber.from(0);
    for (const holder of holders) {
      const balance = await IERC20__factory.connect(asset, deployer).balanceOf(holder);
      console.log(`getTotalAmount holder=${holder} balance=${balance.toString()}`);
      dest = dest.add(balance);
    }
    return dest;
  }
//endregion Utils

//region Swap
  static async makeSingleSwapTest(
    swapManager: SwapManager,
    title: string,
    collateralAsset: string,
    collateralHolders: string[],
    collateralAmount: BigNumber,
    borrowAsset: string,
    strategyToConvert: IStrategyToConvert,
  ) : Promise<{
    results?: ISwapResults
    error?: string
  } > {
    const receiver = ethers.Wallet.createRandom().address;

    try {
      console.log("START swap", title);

      await BalanceUtils.getRequiredAmountFromHolders(
        collateralAmount,
        IERC20Extended__factory.connect(collateralAsset, await DeployerUtils.startImpersonate(receiver)),
        collateralHolders,
        swapManager.address
      );

      await swapManager.swap(
        collateralAsset,
        collateralAmount,
        borrowAsset,
        strategyToConvert.maxTargetAmount,
        receiver
      );
      return {
        results: {
          aprBt36: strategyToConvert.apr18,
          collateralAmount,

          // actually received amount
          borrowAmount: await IERC20Extended__factory.connect(
            borrowAsset,
            await DeployerUtils.startImpersonate(receiver)
          ).balanceOf(receiver),

          // initially planned amount to receive
          maxTargetAmount: strategyToConvert.maxTargetAmount
        }
      }
      // tslint:disable-next-line:no-any
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
      console.log("FINISH swap", title);
    }

    return {
      error: "Unknown error"
    }
  }
//endregion Swap

//region Make borrow/swap

  /**
   * Enumerate all possible pairs of the asset.
   * Find all pairs for which the borrow is possible.
   * Use max available amount of source asset as collateral.
   * Make borrow test and grab results.
   */
  static async makePossibleBorrowsOnPlatform(
    deployer: SignerWithAddress,
    platformTitle: string,
    platformAdapter: IPlatformAdapter,
    tasks: IBorrowTask[],
    countBlocks: number,
    healthFactor2: number,
    testMaker: BorrowTestMaker
  ) : Promise<IBorrowingTestResults[]> {
    console.log("makePossibleBorrowsOnPlatform:", platformTitle);
    const dest: IBorrowingTestResults[] = [];

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

          const planSingleBlock = await platformAdapter.getConversionPlan(
            task.collateralAsset.asset
            , task.collateralAmount
            , task.borrowAsset.asset
            , healthFactor2
            , 1 // we need 1 block for next/last; countBlocks are used as additional-points
          );
          console.log("planSingleBlock", planSingleBlock);

          const planFullPeriod = await platformAdapter.getConversionPlan(
            task.collateralAsset.asset
            , task.collateralAmount
            , task.borrowAsset.asset
            , healthFactor2
            , countBlocks
          );
          console.log("planFullPeriod", planFullPeriod);

          const amountToBorrow = AprUtils.getBorrowAmount(
            task.collateralAmount,
            healthFactor2,
            planFullPeriod.liquidationThreshold18,
            stPrices.priceCollateral,
            stPrices.priceBorrow,
            collateralDecimals,
            borrowDecimals
          );
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
            const p: ITestSingleBorrowParams = {
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

  static async makePossibleSwaps(
    deployer: SignerWithAddress,
    swapManager: SwapManager,
    tasks: IBorrowTask[],
    countBlocks: number,
  ) : Promise<ISwapTestResults[]> {
    console.log("makePossibleSwaps");
    const dest: ISwapTestResults[] = [];
    const platformTitle = "SWAP";

    for (const task of tasks) {
      const collateralHolders = task.collateralAsset.holders;

      console.log("makePossibleSwaps, task:", task);

      const snapshot = await TimeUtils.snapshot();
      try {
        const params: AppDataTypes.InputConversionParamsStruct = {
          periodInBlocks: countBlocks,
          sourceAmount: task.collateralAmount,
          sourceToken: task.collateralAsset.asset,
          targetToken: task.borrowAsset.asset
        };
        const strategyToConvert: IStrategyToConvert = await swapManager.getConverter(params);
        if (strategyToConvert.converter === Misc.ZERO_ADDRESS) {
          dest.push({
            assetBorrow: task.borrowAsset,
            assetCollateral: task.collateralAsset,
            collateralAmount: task.collateralAmount,
            strategyToConvert,
            error: "Plan not found",
          });
        } else {
          const res = await this.makeSingleSwapTest(
            swapManager,
            platformTitle,
            task.collateralAsset.asset,
            collateralHolders,
            task.collateralAmount,
            task.borrowAsset.asset,
            strategyToConvert,
          );
          dest.push({
            assetBorrow: task.borrowAsset,
            assetCollateral: task.collateralAsset,
            collateralAmount: task.collateralAmount,
            strategyToConvert,
            results: res.results,
            error: res.error
          });
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

//endregion Make borrow/swap
}