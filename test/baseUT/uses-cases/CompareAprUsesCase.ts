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
  IController__factory,
  IERC20__factory,
  IERC20Metadata__factory,
  IPlatformAdapter,
  SwapManager
} from "../../../typechain";
import {BigNumber} from "ethers";
import {Misc} from "../../../scripts/utils/Misc";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {BalanceUtils} from "../utils/BalanceUtils";

//region Data types
interface IInputParams {
  amountToBorrow: number | BigNumber;
  params: ITestSingleBorrowParams;
  additionalPoints: number[];
}

/** I.e. one of AprXXX.makeBorrowTest */
export type BorrowTestMaker = (
  // eslint-disable-next-line no-unused-vars
  deployer: SignerWithAddress,
  // eslint-disable-next-line no-unused-vars
  amountToBorrow: number | BigNumber,
  // eslint-disable-next-line no-unused-vars
  p: ITestSingleBorrowParams,
  // eslint-disable-next-line no-unused-vars
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
  apr18: BigNumber;
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
//endregion Borrowing

//region Utils
  static generateTasks(
    assets: IAssetInfo[],
    collateralAmounts: BigNumber[]
  ) : IBorrowTask[] {
    const dest: IBorrowTask[] = [];
    for (const [indexSource, sourceAsset] of assets.entries()) {
      for (const [, targetAsset] of assets.entries()) {
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
  static async makeSwapThereAndBack(
    swapManager: SwapManager,
    collateralAsset: string,
    collateralHolders: string[],
    collateralAmount: BigNumber,
    borrowAsset: string,
  ) : Promise<ISwapResults> {
    const receiverAddress = ethers.Wallet.createRandom().address;
    const receiver = await DeployerUtils.startImpersonate(receiverAddress);

    const collateralToken = IERC20Metadata__factory.connect(collateralAsset, receiver);
    const borrowToken = IERC20Metadata__factory.connect(borrowAsset, receiver);

    await BalanceUtils.getRequiredAmountFromHolders(collateralAmount, collateralToken, collateralHolders, receiverAddress);
    const collateralBalanceBeforeSwap = await collateralToken.balanceOf(receiverAddress);
    console.log("makeSwapThereAndBack.collateralBalanceBeforeSwap", collateralBalanceBeforeSwap);

    await IERC20__factory.connect(
      collateralToken.address,
      await DeployerUtils.startImpersonate(receiverAddress)
    ).transfer(swapManager.address, collateralAmount);
    await swapManager.swap(collateralAsset, collateralAmount, borrowAsset, receiverAddress);

    console.log("makeSwapThereAndBack.collateralBalanceAfterSwapThere", await collateralToken.balanceOf(receiverAddress));

    const borrowedAmount = await borrowToken.balanceOf(receiverAddress);
    console.log("makeSwapThereAndBack.borrowedAmount", borrowedAmount);


    const controller = IController__factory.connect(await swapManager.controller(), receiver);
    await BalanceUtils.getRequiredAmountFromHolders(
      borrowedAmount,
      IERC20Metadata__factory.connect(borrowAsset, receiver),
      collateralHolders,
      receiver.address
    );
    await IERC20__factory.connect(
      borrowAsset,
      await DeployerUtils.startImpersonate(receiver.address)
    ).approve(await controller.tetuConverter(), borrowedAmount);
    const planReverseSwap = await swapManager.callStatic.getConverter(
      receiver.address,
      borrowAsset,
      borrowedAmount,
      collateralAsset,
    );

    await borrowToken.transfer(swapManager.address, borrowedAmount);
    await swapManager.swap(borrowAsset, borrowedAmount, collateralAsset, receiverAddress);
    const collateralBalanceAfterSwap = await collateralToken.balanceOf(receiverAddress)
    console.log("makeSwapThereAndBack.collateralBalanceAfterReverseSwap", await collateralToken.balanceOf(receiverAddress));
    console.log("makeSwapThereAndBack.planReverseSwap", planReverseSwap);

    const apr18 = collateralBalanceBeforeSwap
      .sub(collateralBalanceAfterSwap)
      .mul(Misc.WEI)
      .div(collateralAmount);

    console.log("makeSwapThereAndBack.collateralAmount", collateralAmount);
    console.log("makeSwapThereAndBack.collateralBalanceBeforeSwap", collateralBalanceBeforeSwap.toString());
    console.log("makeSwapThereAndBack.borrowedAmount", borrowedAmount.toString());
    console.log("makeSwapThereAndBack.collateralBalanceAfterSwap", collateralBalanceAfterSwap.toString());
    console.log("makeSwapThereAndBack.apr18", apr18.toString());
    console.log("makeSwapThereAndBack.loss", collateralBalanceBeforeSwap.sub(collateralBalanceAfterSwap).toString());

    return {
      apr18,
      collateralAmount,

      // actually received amount
      borrowedAmount,
      lostCollateral: collateralBalanceBeforeSwap.sub(collateralBalanceAfterSwap)
    }
  }

  static async makeSingleSwapTest(
    swapManager: SwapManager,
    collateralAsset: string,
    collateralHolders: string[],
    collateralAmount: BigNumber,
    borrowAsset: string,
  ) : Promise<{
    results?: ISwapResults
    error?: string
  } > {
    try {
      const swapResults = await this.makeSwapThereAndBack(
        swapManager,
        collateralAsset,
        collateralHolders,
        collateralAmount,
        borrowAsset
      )

      return {
        results: swapResults
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
      console.log("FINISH swap");
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

      console.log("makePossibleBorrowsOnPlatform, task:", task);

      const snapshot = await TimeUtils.snapshot();
      try {
        console.log("makePossibleBorrowsOnPlatform.collateralAmount", task.collateralAmount);

        const planSingleBlock = await platformAdapter.getConversionPlan(
          task.collateralAsset.asset,
          task.collateralAmount,
          task.borrowAsset.asset,
          healthFactor2,
          1 // we need 1 block for next/last; countBlocks are used as additional-points
        );
        console.log("planSingleBlock", planSingleBlock);

        const planFullPeriod = await platformAdapter.getConversionPlan(
          task.collateralAsset.asset,
          task.collateralAmount,
          task.borrowAsset.asset,
          healthFactor2,
          countBlocks,
        );
        console.log("planFullPeriod", planFullPeriod);

        const amountToBorrow = planSingleBlock.amountToBorrow;
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
  ) : Promise<ISwapTestResults[]> {
    console.log("makePossibleSwaps");
    const dest: ISwapTestResults[] = [];

    for (const task of tasks) {
      const collateralHolders = task.collateralAsset.holders;

      console.log("makePossibleSwaps, task:", task);

      const snapshot = await TimeUtils.snapshot();
      try {

        const tempUserContract = ethers.Wallet.createRandom().address;
        const controller = IController__factory.connect(await swapManager.controller(), deployer);
        await BalanceUtils.getRequiredAmountFromHolders(
          task.collateralAmount,
          IERC20Metadata__factory.connect(task.collateralAsset.asset, deployer),
          collateralHolders,
          tempUserContract
        );
        await IERC20__factory.connect(
          task.collateralAsset.asset,
          await DeployerUtils.startImpersonate(tempUserContract)
        ).approve(await controller.tetuConverter(), task.collateralAmount);
        const converterData = await swapManager.callStatic.getConverter(
          tempUserContract,
          task.collateralAsset.asset,
          task.collateralAmount,
          task.borrowAsset.asset
        );
        const strategyToConvert: IStrategyToConvert = {
          converter: converterData.converter,
          maxTargetAmount: converterData.maxTargetAmount,
          apr18: await swapManager.getApr18(task.collateralAsset.asset,
            task.collateralAmount,
            task.borrowAsset.asset,
            converterData.maxTargetAmount
          )
        };

        if (strategyToConvert.converter === Misc.ZERO_ADDRESS) {
          dest.push({
            assetBorrow: task.borrowAsset,
            assetCollateral: task.collateralAsset,
            collateralAmount: task.collateralAmount,
            strategyToConvert,
            error: "Plan not found",
            apr18: BigNumber.from(0)
          });
        } else {
          const apr18 = await swapManager.getApr18(
            task.collateralAsset.asset,
            task.collateralAmount,
            task.borrowAsset.asset,
            strategyToConvert.maxTargetAmount
          );
          const res = await this.makeSingleSwapTest(
            swapManager,
            task.collateralAsset.asset,
            collateralHolders,
            task.collateralAmount,
            task.borrowAsset.asset,
          );
          dest.push({
            assetBorrow: task.borrowAsset,
            assetCollateral: task.collateralAsset,
            collateralAmount: task.collateralAmount,
            strategyToConvert,
            results: res.results,
            error: res.error,
            apr18
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