import {TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ConfigurableAmountToBorrow, ConversionPlan, IAsset, IBorrowResults} from "../apr/aprDataTypes";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {IERC20__factory, IERC20Extended__factory, IPlatformAdapter} from "../../../typechain";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {Misc} from "../../../scripts/utils/Misc";

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

  assetCollateral: IAsset;
  collateralAmount: BigNumber;

  assetBorrow: IAsset;

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
  ) : Promise<IBorrowResults | undefined> {
    const signers = await ethers.getSigners();
    const deployer = signers[0];

    const snapshot = await TimeUtils.snapshot();
    try {
      console.log("START", title);
      return await testMaker(deployer, p.amountToBorrow, p.params, p.additionalPoints);
    } catch (e) {
      console.log(e);
    } finally {
      console.log("FINISH", title);
    }

    await TimeUtils.rollback(snapshot);
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
   * @param holdersCSV  ;-separated list of holders
   * @param exactAmountToBorrow
   * @param amountsToBorrow
   * @param countBlocks
   * @param healthFactor2
   * @param testMaker
   */
  static async makePossibleBorrowsOnPlatformExactAmounts(
    deployer: SignerWithAddress,
    platformTitle: string,
    platformAdapter: IPlatformAdapter,
    assets: IAsset[],
    holdersCSV: string[],
    exactAmountToBorrow: boolean,
    amountsToBorrow: BigNumber[],
    countBlocks: number,
    healthFactor2: number,
    testMaker: BorrowTestMaker
  ) : Promise<IBorrowTestResults[]> {
    const dest: IBorrowTestResults[] = [];

    for (const [indexSource, sourceAsset] of assets.entries()) {
      const holders = holdersCSV[indexSource].split(";");
      const collateralAmount = await CompareAprUsesCase.getTotalAmount(deployer, sourceAsset.a, holders);
      const collateralDecimals = await IERC20Extended__factory.connect(sourceAsset.a, deployer).decimals();

      for (const [indexTarget, targetAsset] of assets.entries()) {
        if (sourceAsset === targetAsset) continue;

        const stPrices = await platformAdapter.getAssetsPrices([sourceAsset.a, targetAsset.a]);

        // see definition of borrowAmountFactor18 inside BorrowManager._findPool
        const borrowAmountFactor18 = getBigNumberFrom(1, 18)
          .mul(collateralAmount)
          .mul(stPrices[0])
          .div(stPrices[1])
          .div(healthFactor2)
          .div(getBigNumberFrom(1, 18-2));

        const plan = await platformAdapter.getConversionPlan(
          sourceAsset.a
          , collateralAmount
          , targetAsset.a
          , borrowAmountFactor18
          , countBlocks
        );

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
              asset: sourceAsset.a,
              holders: holdersCSV[indexSource],
              initialLiquidity: 0,
            }, borrow: {
              asset: targetAsset.a,
              holders: holdersCSV[indexTarget],
              initialLiquidity: 0,
            }
            , collateralAmount: collateralAmount.div(getBigNumberFrom(collateralDecimals)).toNumber()
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
            results: res
          });
        }
      }
    }

    return dest;
  }

  /** Get total balance of the asset for all holders */
  static async getTotalAmount(
    deployer: SignerWithAddress
    , asset: string
    , holders: string[]
  ) : Promise<BigNumber> {
    const dest = BigNumber.from(0);
    for (const holder of holders) {
      const balance = await IERC20__factory.connect(asset, deployer).balanceOf(holder);
      dest.add(balance);
    }
    return dest;
  }
}