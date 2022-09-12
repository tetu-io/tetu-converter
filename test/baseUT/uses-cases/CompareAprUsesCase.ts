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

    const snapshot = await TimeUtils.snapshot();
    try {
      console.log("START", title);
      return {
        results: await testMaker(deployer, p.amountToBorrow, p.params, p.additionalPoints)
      }
    } catch (e: any) {
      console.log(e);
      const re = /Error: VM Exception while processing transaction: reverted with reason string '[^']+'/i;
      if (e.message) {
        const found = e.message.match(re);
        return {
          error: found[0]
        }
      }
    } finally {
      console.log("FINISH", title);
    }

    await TimeUtils.rollback(snapshot);
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
    const dest: IBorrowTestResults[] = [];

    for (const [indexSource, sourceAsset] of assets.entries()) {
      if (sourceAsset.asset != "0x172370d5Cd63279eFa6d502DAB29171933a610AF") continue; //TODO
      console.log("makePossibleBorrowsOnPlatform, source:", sourceAsset);
      const holders = sourceAsset.holders;
      const initialLiquidity = await CompareAprUsesCase.getTotalAmount(deployer, sourceAsset.asset, holders);
      const collateralDecimals = await IERC20Extended__factory.connect(sourceAsset.asset, deployer).decimals();

      for (const [indexTarget, targetAsset] of assets.entries()) {
        if (sourceAsset === targetAsset) continue;
        console.log("makePossibleBorrowsOnPlatform, target:", targetAsset);
        console.log(`makePossibleBorrowsOnPlatform: ${sourceAsset.title} ${targetAsset.title}`);

        const borrowDecimals = await IERC20Extended__factory.connect(targetAsset.asset, deployer).decimals();
        const stPrices = await platformAdapter.getAssetsPrices([sourceAsset.asset, targetAsset.asset]);
        console.log("prices", stPrices);

        // calculate approx amount of collateral required to borrow required amount with collateral factor = 0.5
        const collateralAmount = amountsToBorrow[indexTarget]
          .mul(2) //cf = 0.5
          .mul(healthFactor2).div(100)
          .mul(getBigNumberFrom(1, collateralDecimals))
          .mul(stPrices[1])
          .div(stPrices[0])
          .div(getBigNumberFrom(1, borrowDecimals));
        console.log("collateralAmount", collateralAmount);
        console.log("required amount to borrow", amountsToBorrow[indexTarget]);
        // see definition of borrowAmountFactor18 inside BorrowManager._findPool
        const borrowAmountFactor18 = getBigNumberFrom(1, 18)
          .mul(collateralAmount)
          .mul(stPrices[0])
          .div(stPrices[1])
          .div(healthFactor2)
          .div(getBigNumberFrom(1, 18-2));

        const plan = await platformAdapter.getConversionPlan(
          sourceAsset.asset
          , collateralAmount
          , targetAsset.asset
          , borrowAmountFactor18
          , countBlocks
        );
        console.log("plan", plan);

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
            , {
              params: p,
              amountToBorrow: {
                exact: exactAmountToBorrow
                , exactAmountToBorrow: exactAmountToBorrow ? amountsToBorrow[indexTarget] : undefined
                , ratio18: exactAmountToBorrow ? undefined : amountsToBorrow[indexTarget]
              },
              additionalPoints: [countBlocks],
            }
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
      }
    }

    console.log("makePossibleBorrowsOnPlatform finished:", dest);
    return dest;
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