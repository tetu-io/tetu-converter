import {TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  ConversionPlan,
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

//region Data types
interface IInputParams {
  amountToBorrow: ConfigurableAmountToBorrow;
  params: TestSingleBorrowParams;
  additionalPoints: number[];
}

/** I.e. one of AprXXX.makeBorrowTest */
export type BorrowTestMaker = (
  deployer: SignerWithAddress
  , amountToBorrow0: ConfigurableAmountToBorrow
  , p: TestSingleBorrowParams
  , additionalPoints: number[]
) => Promise<IBorrowResults>;

export interface IBorrowTestResults {
  platformTitle: string;

  assetCollateral: IAssetInfo;
  collateralAmount: BigNumber;

  assetBorrow: IAssetInfo;

  plan: ConversionPlan;
  results?: IBorrowResults;

  error?: string;
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

  /**
   * Enumerate all possible pairs of the asset.
   * Find all pairs for which the borrow is possible.
   * Use max available amount of source asset as collateral.
   * Make borrow test and grab results.
   * @param deployer
   * @param platformTitle
   * @param platformAdapter
   * @param assets
   * @param exactAmountToBorrow
   * @param amountsToBorrow
   * @param countBlocks
   * @param healthFactor2
   * @param testMaker
   */
  static async makePossibleBorrowsOnPlatform(
    deployer: SignerWithAddress,
    platformTitle: string,
    platformAdapter: IPlatformAdapter,
    assets: IAssetInfo[],
    exactAmountToBorrow: boolean,
    amountsToBorrow: BigNumber[],
    countBlocks: number,
    healthFactor2: number,
    testMaker: BorrowTestMaker
  ) : Promise<IBorrowTestResults[]> {
    console.log("makePossibleBorrowsOnPlatform:", platformTitle);
    const dest: IBorrowTestResults[] = [];

    for (const [indexSource, sourceAsset] of assets.entries()) {
      console.log("makePossibleBorrowsOnPlatform, source:", sourceAsset);
      const holders = sourceAsset.holders;
      const initialLiquidity = await CompareAprUsesCase.getTotalAmount(deployer, sourceAsset.asset, holders);
      const collateralDecimals = await IERC20Extended__factory.connect(sourceAsset.asset, deployer).decimals();

      for (const [indexTarget, targetAsset] of assets.entries()) {
        if (sourceAsset === targetAsset) continue;
        console.log("makePossibleBorrowsOnPlatform, target:", targetAsset);
        console.log(`makePossibleBorrowsOnPlatform: ${sourceAsset.title} ${targetAsset.title}`);
        console.log(`makePossibleBorrowsOnPlatform: amount to borrow=${amountsToBorrow[indexTarget]}`);

        const snapshot = await TimeUtils.snapshot();
        try {
          const borrowDecimals = await IERC20Extended__factory.connect(targetAsset.asset, deployer).decimals();
          const stPrices = await this.getPrices(platformAdapter, sourceAsset, targetAsset);

          if (! stPrices) {
            // the platform doesn't support some of provided assets
            continue;
          }

          let collateralAmount = this.getApproxCollateralAmount(amountsToBorrow[indexTarget]
            , healthFactor2
            , collateralDecimals
            , stPrices
            , borrowDecimals
          );
          if (collateralAmount.gt(initialLiquidity)) {
            console.log(`Attempt to borrow too much. Required collateral ${collateralAmount.toString()} is greater available ${initialLiquidity.toString()}`);
            collateralAmount = initialLiquidity;
          }
          console.log("collateralAmount", collateralAmount);

          // see definition of borrowAmountFactor18 inside BorrowManager._findPool
          const borrowAmountFactor18 = this.getBorrowAmountFactor18(collateralAmount, stPrices, healthFactor2);

          const plan = await platformAdapter.getConversionPlan(
            sourceAsset.asset
            , collateralAmount
            , targetAsset.asset
            , borrowAmountFactor18
            // we need 1 block for next/last; countBlocks are used as additional-points
            , 1 // countBlocks
          );
          console.log("plan", plan);

          const amountToBorrow: ConfigurableAmountToBorrow = this.getAmountToBorrow(
            exactAmountToBorrow
            , amountsToBorrow[indexTarget]
            , plan.maxAmountToBorrowBT
          );
          console.log("borrowAmount", amountToBorrow);

          if (plan.converter == Misc.ZERO_ADDRESS) {
            dest.push({
              platformTitle: platformTitle,
              assetBorrow: targetAsset,
              assetCollateral: sourceAsset,
              collateralAmount: collateralAmount,
              plan: plan,
              error: "Plan not found",
            });
          } else {
            const p: TestSingleBorrowParams = {
              collateral: {
                asset: sourceAsset.asset,
                holder: sourceAsset.holders.join(";"),
                initialLiquidity: initialLiquidity,
              }, borrow: {
                asset: targetAsset.asset,
                holder: targetAsset.holders.join(";"),
                initialLiquidity: 0,
              }
              , collateralAmount: collateralAmount
              , healthFactor2: healthFactor2
              , countBlocks: 1 // we need 1 block for next/last; countBlocks are used as additional-points
            };
            const res = await this.makeSingleBorrowTest(
              platformTitle
              , {params: p, amountToBorrow, additionalPoints: [countBlocks]}
              , testMaker
            );
            dest.push({
              platformTitle: platformTitle,
              assetBorrow: targetAsset,
              assetCollateral: sourceAsset,
              collateralAmount: collateralAmount,
              plan: plan,
              results: res.results,
              error: res.error
            });
          }
        } finally {
          await TimeUtils.rollback(snapshot);
        }
      }
    }

    console.log("makePossibleBorrowsOnPlatform finished:", dest);
    return dest;
  }

  private static async getPrices(
    platformAdapter: IPlatformAdapter
    , sourceAsset: IAssetInfo
    , targetAsset: IAssetInfo
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


  private static getBorrowAmountFactor18(
    collateralAmount: BigNumber,
    stPrices: {priceCollateral: BigNumber, priceBorrow: BigNumber},
    healthFactor2: number
  ) {
    const borrowAmountFactor18 = getBigNumberFrom(1, 18)
      .mul(collateralAmount)
      .mul(stPrices.priceCollateral)
      .div(stPrices.priceBorrow)
      .div(healthFactor2)
      .div(getBigNumberFrom(1, 18 - 2));
    return borrowAmountFactor18;
  }

  /** calculate approx amount of collateral required to borrow required amount with collateral factor = 0.2 */
  private static getApproxCollateralAmount(
    amountToBorrow: BigNumber
    , healthFactor2: number
    , collateralDecimals: number
    , stPrices: {priceCollateral: BigNumber, priceBorrow: BigNumber}
    , borrowDecimals: number
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

  static getAmountToBorrow(
    isAmountExact: boolean,
    requiredValue: BigNumber,
    maxAvailableAmount: BigNumber
  ) : ConfigurableAmountToBorrow {
    if (isAmountExact) {
      if (maxAvailableAmount.gt(requiredValue)) {
        return {
          exact: true,
          exactAmountToBorrow: requiredValue
        }
      } else {
        throw `Try to borrow amount ${requiredValue} greater than available one ${maxAvailableAmount}`;
      }
    } else {
      return { exact: false, ratio18: requiredValue };
    }
  }
}