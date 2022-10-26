import {BigNumber} from "ethers";
import {IBorrowResults, IPointResults} from "./aprDataTypes";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ITestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {DForceHelper} from "../../../scripts/integration/helpers/DForceHelper";
import {
  DForceAprLibFacade, DForceTestHelper,
  IDForceController,
  IDForceCToken,
  IDForceCToken__factory,
  IERC20Extended__factory
} from "../../../typechain";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import hre, {ethers} from "hardhat";
import {
  changeDecimals,
  convertUnits, makeBorrow
} from "./aprUtils";
import {DForcePlatformFabric} from "../fabrics/DForcePlatformFabric";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {DForceUtils} from "../utils/DForceUtils";

//region Data types
interface IDForceMarketState {
  accrualBlockNumber: BigNumber;
  borrowIndex: BigNumber;
  borrowRatePerBlock: BigNumber;
  exchangeRateStored: BigNumber;
  cash: BigNumber;
  reserveRatio: BigNumber;
  supplyRatePerBlock: BigNumber;
  totalBorrows: BigNumber;
  totalReserves: BigNumber;
  totalSupply: BigNumber;
}

export interface IDForceCalcAccountEquityResults {
  // calcAccountEquity
  accountEquity: BigNumber;
  shortfall: BigNumber;
  collateralValue: BigNumber;
  borrowedValue: BigNumber;
}

export interface IDForceUserAccountState extends IDForceCalcAccountEquityResults {
  balance: BigNumber;
  borrowBalanceStored: BigNumber;
  borrowPrincipal: BigNumber;
  borrowInterestIndex: BigNumber;

}

interface IDForceState {
  block: number,
  blockTimestamp: number;
  collateral: {
    market: IDForceMarketState,
    account: IDForceUserAccountState
  },
  borrow: {
    market: IDForceMarketState,
    account: IDForceUserAccountState
  },
}

interface IAprDForceTwoResults {
  /** State before borrow */
  before: IDForceState;
  /** State just after borrow */
  next: IDForceState;
  /** State just after borrow + 1 block */
  last: IDForceState;
  /** Borrower address */
  userAddress: string;
  /** Exact value of the borrowed amount */
  borrowAmount: BigNumber;

//// next : last  results

  /** Supply APR in terms of base currency calculated using predicted supply rate */
  supplyAprExact: BigNumber;
  /** Supply APR in terms of base currency calculated using exact supply rate taken from next step */
  supplyApr: BigNumber;
  /** Borrow APR in terms of base currency calculated using predicted borrow rate */
  borrowAprExact: BigNumber;
  /** borrow APR in terms of base currency calculated using exact borrow rate taken from next step */
  borrowApr: BigNumber;
  /** total increment of collateral amount from NEXT to LAST in terms of COLLATERAL currency */
  deltaCollateralMul18: BigNumber;
  /** total increment of collateral amount from NEXT to LAST in terms of BORROW currency */
  deltaCollateralBtMul18: BigNumber;
  /** total increment of borrowed amount from NEXT to LAST in terms of BORROW currency */
  deltaBorrowBalance: BigNumber;
}
//endregion Data types

//region Utils
async function getDForceMarketState(token: IDForceCToken): Promise<IDForceMarketState> {
  return {
    accrualBlockNumber: await token.accrualBlockNumber(),
    borrowIndex: await token.borrowIndex(),
    cash: await token.getCash(),
    borrowRatePerBlock: await token.borrowRatePerBlock(),
    exchangeRateStored: await token.exchangeRateStored(),
    reserveRatio: await token.reserveRatio(),
    supplyRatePerBlock: await token.supplyRatePerBlock(),
    totalBorrows: await token.totalBorrows(),
    totalReserves: await token.totalReserves(),
    totalSupply: await token.totalSupply()
  }
}

async function getDForceUserAccountState(
  comptroller: IDForceController,
  token: IDForceCToken,
  user: string
): Promise<IDForceUserAccountState> {
  const snapshot = await token.borrowSnapshot(user);
  const e = await comptroller.calcAccountEquity(user);
  return {
    balance: await token.balanceOf(user),
    borrowBalanceStored: await token.borrowBalanceStored(user),
    borrowInterestIndex: snapshot.interestIndex,
    borrowPrincipal: snapshot.principal,

    accountEquity: e.accountEquity,
    shortfall: e.shortfall,
    borrowedValue: e.borrowedValue,
    collateralValue: e.collateralValue
  }
}

export async function getDForceStateInfo(
  comptroller: IDForceController,
  cTokenCollateral: IDForceCToken,
  cTokenBorrow: IDForceCToken,
  user: string,
) : Promise<IDForceState> {
  return {
    block: (await hre.ethers.provider.getBlock("latest")).number,
    blockTimestamp: (await hre.ethers.provider.getBlock("latest")).timestamp,
    collateral: {
      market: await getDForceMarketState(cTokenCollateral),
      account: await getDForceUserAccountState(comptroller, cTokenCollateral, user),
    },
    borrow: {
      market: await getDForceMarketState(cTokenBorrow),
      account: await getDForceUserAccountState(comptroller, cTokenBorrow, user),
    }
  }
}
//endregion Utils

export class AprDForce {
  /**
   * 0. Predict APR
   * 1. Make borrow
   * This is "next point" (or AFTER BORROW point)
   * 2. update borrow and supply interest
   * This is "last point" (+ 1 blocks since next)
   * 3. Calculate real APR for the period since "next" to "last"
   * 4. Enumerate all additional points. Move to the point, get balances, save them to the results.
   *
   * @param deployer
   * @param amountToBorrow0 Amount to borrow without decimals (i.e. 100 for 100 DAI)
   * @param p Main parameters (asset, amounts, so on)
   * @param additionalPoints
   */
  static async makeBorrowTest(
    deployer: SignerWithAddress,
    amountToBorrow0: number | BigNumber,
    p: ITestSingleBorrowParams,
    additionalPoints: number[],
  ): Promise<{
    details: IAprDForceTwoResults,
    results: IBorrowResults
  }> {
    const collateralCTokenAddress = DForceUtils.getCTokenAddressForAsset(p.collateral.asset);
    const borrowCTokenAddress = DForceUtils.getCTokenAddressForAsset(p.borrow.asset);

    const comptroller = await DForceHelper.getController(deployer);
    const cTokenCollateral = IDForceCToken__factory.connect(collateralCTokenAddress, deployer);
    const cTokenBorrow = IDForceCToken__factory.connect(borrowCTokenAddress, deployer);
    const priceOracle = await DForceHelper.getPriceOracle(comptroller, deployer);
    const rewardsDistributor = await DForceHelper.getRewardDistributor(comptroller, deployer);

    const borrowAssetDecimals = await (IERC20Extended__factory.connect(p.borrow.asset, deployer)).decimals();
    const collateralAssetDecimals = await (IERC20Extended__factory.connect(p.collateral.asset, deployer)).decimals();

    const marketCollateralData = await DForceHelper.getCTokenData(deployer, comptroller, cTokenCollateral);
    const marketBorrowData = await DForceHelper.getCTokenData(deployer, comptroller, cTokenBorrow);

    console.log("marketCollateralData", marketCollateralData);
    console.log("marketBorrowData", marketBorrowData);

    const amountCollateral = getBigNumberFrom(p.collateralAmount, collateralAssetDecimals);
    console.log(`amountCollateral=${amountCollateral.toString()}`);

    // prices
    const priceCollateral = await priceOracle.getUnderlyingPrice(collateralCTokenAddress);
    const priceBorrow = await priceOracle.getUnderlyingPrice(borrowCTokenAddress);
    console.log("priceCollateral", priceCollateral);
    console.log("priceBorrow", priceBorrow);
    const priceBorrow36 = priceBorrow.mul(getBigNumberFrom(1, borrowAssetDecimals));
    const priceCollateral36 = priceCollateral.mul(getBigNumberFrom(1, collateralAssetDecimals));
    console.log("priceCollateral36", priceCollateral36);
    console.log("priceBorrow36", priceBorrow36);

    // predict APR
    const libFacade = await DeployUtils.deployContract(deployer, "DForceAprLibFacade") as DForceAprLibFacade;
    const dForceHelper = await DeployUtils.deployContract(deployer, "DForceTestHelper") as DForceTestHelper;

    // start point: we estimate APR in this point before borrow and supply
    const before = await getDForceStateInfo(comptroller
      , cTokenCollateral
      , cTokenBorrow
      // we don't have user address at this moment
      // so, use dummy address (and get dummy balance values - we don't use them)
      , ethers.Wallet.createRandom().address
    );

    const supplyRatePredicted = await this.getEstimatedSupplyRate(libFacade
      , before
      , amountCollateral
      , marketCollateralData.interestRateModel
    );
    console.log(`supplyRatePredicted=${supplyRatePredicted.toString()}`);

    const amountToBorrow = getBigNumberFrom(amountToBorrow0, borrowAssetDecimals);
    const borrowRatePredicted = await this.getEstimatedBorrowRate(libFacade
      , cTokenBorrow
      , amountToBorrow
    );
    console.log(`borrowRatePredicted=${borrowRatePredicted.toString()}`);

    // make borrow
    const borrowResults = await makeBorrow(
      deployer
      , p
      , amountToBorrow
      , new DForcePlatformFabric()
    );
    const userAddress = borrowResults.poolAdapter;
    const borrowAmount = borrowResults.borrowAmount;
    console.log(`userAddress=${userAddress} borrowAmount=${borrowAmount} amountToBorrow=${amountToBorrow}`);

    // next => last
    const next = await getDForceStateInfo(comptroller
      , cTokenCollateral
      , cTokenBorrow
      , userAddress
    );

    // For borrow and collateral: move ahead on single block
    await dForceHelper.updateInterest(cTokenCollateral.address, cTokenBorrow.address);

    const last = await getDForceStateInfo(comptroller
      , cTokenCollateral
      , cTokenBorrow
      , userAddress
    );

    console.log("before", before);
    console.log("next", next);
    console.log("last", last);

    // calculate exact values of supply/borrow APR
    // we use state-values "after-borrow" and exact values of supply/borrow rates after borrow
    const countBlocksNextToLast = 1;

    const supplyApr = await libFacade.getSupplyApr36(
      supplyRatePredicted
      , countBlocksNextToLast
      , collateralAssetDecimals
      , priceCollateral36
      , priceBorrow36
      , amountCollateral
    );
    const supplyAprExact = await libFacade.getSupplyApr36(
      next.collateral.market.supplyRatePerBlock
      , countBlocksNextToLast
      , collateralAssetDecimals
      , priceCollateral36
      , priceBorrow36
      , amountCollateral
    );
    console.log("supplyAprExact", supplyAprExact);

    const borrowApr = await libFacade.getBorrowApr36(
      borrowRatePredicted
      , borrowAmount
      , countBlocksNextToLast
      , borrowAssetDecimals
    );
    console.log("borrowApr", borrowApr);

    const borrowAprExact = await libFacade.getBorrowApr36(
      last.borrow.market.borrowRatePerBlock
      , borrowAmount
      , countBlocksNextToLast
      , borrowAssetDecimals
    );
    console.log("borrowAprExact", borrowApr);

    // get collateral (in terms of collateral tokens) for next and last points
    const collateralNextMul18 = next.collateral.account.balance.mul(next.collateral.market.exchangeRateStored);
    const collateralLastMul18 = last.collateral.account.balance.mul(last.collateral.market.exchangeRateStored);
    const deltaCollateralMul18 = collateralLastMul18.sub(collateralNextMul18);
    const deltaCollateralBtMul18 = deltaCollateralMul18.mul(priceCollateral).div(priceBorrow);
    console.log("collateralNext", collateralNextMul18);
    console.log("collateralLast", collateralLastMul18);
    console.log("deltaCollateral", deltaCollateralMul18);
    console.log("deltaCollateralBT", deltaCollateralBtMul18);

    const deltaBorrowBalance = last.borrow.account.borrowBalanceStored.sub(
      next.borrow.account.borrowBalanceStored
    );
    console.log("deltaBorrowBalance", deltaBorrowBalance);

    const pointsResults: IPointResults[] = [];
    for (const period of additionalPoints) {
      // we need 4 blocks to update rewards ... so we need to make advance on N - 4 blocks
      await TimeUtils.advanceNBlocks(period > 4 ? period - 4 : period);
      await rewardsDistributor.updateDistributionState(collateralCTokenAddress, false);
      await rewardsDistributor.updateReward(collateralCTokenAddress, userAddress, false);

      await rewardsDistributor.updateDistributionState(borrowCTokenAddress, true);
      await rewardsDistributor.updateReward(borrowCTokenAddress, userAddress, true);

      await dForceHelper.updateInterest(cTokenCollateral.address, cTokenBorrow.address);

      const totalAmountRewards = await rewardsDistributor.reward(userAddress);

      // let's reconvert rewards to borrow tokens
      const rewardToken = await rewardsDistributor.rewardToken();
      const priceRewards = await priceOracle.getUnderlyingPrice(rewardToken);
      const rt = IDForceCToken__factory.connect(rewardToken, deployer);
      console.log("totalAmountRewards", totalAmountRewards);
      console.log("priceRewards", priceRewards);
      console.log("rewards-decimals", await rt.decimals());
      console.log("priceBorrow", priceBorrow);

      const totalAmountRewardsBt36 = totalAmountRewards
        .mul(priceRewards).mul(getBigNumberFrom(1, await rt.decimals()))
        .mul(getBigNumberFrom(1, 36))
        .div(priceBorrow.mul(getBigNumberFrom(1, borrowAssetDecimals)))
        .div(getBigNumberFrom(1, await rt.decimals()));
      console.log("totalAmountRewardsBt36", totalAmountRewardsBt36);

      const current = await getDForceStateInfo(comptroller
        , cTokenCollateral
        , cTokenBorrow
        , userAddress
      );
      console.log("current", current);

      const collateralCurrentMul18 = current.collateral.account.balance.mul(current.collateral.market.exchangeRateStored);
      const deltaCollateral = collateralCurrentMul18.sub(collateralNextMul18);
      const deltaBorrow = current.borrow.account.borrowBalanceStored.sub(next.borrow.account.borrowBalanceStored);

      pointsResults.push({
        period: {
          block0: next.block,
          blockTimestamp0: next.blockTimestamp,
          block1: current.block,
          blockTimestamp1: current.blockTimestamp,
        },
        rates: {
          supplyRate: current.collateral.market.supplyRatePerBlock,
          borrowRate: current.borrow.market.borrowRatePerBlock
        },
        balances: {
          collateral: current.collateral.account.balance,
          borrow: current.borrow.account.borrowBalanceStored
        },
        costsBT36: {
          collateral: changeDecimals(deltaCollateral.mul(priceCollateral36).div(priceBorrow36), collateralAssetDecimals, 18),
          borrow: changeDecimals(deltaBorrow, borrowAssetDecimals, 36),
        },
        totalAmountRewards,
        totalAmountRewardsBt36
      })
    }

    return {
      details: {
        borrowApr,
        borrowAprExact,
        before,
        deltaBorrowBalance,
        deltaCollateralMul18,
        supplyApr,
        deltaCollateralBtMul18,
        borrowAmount,
        last,
        supplyAprExact,
        next,
        userAddress
      },
      results: {
        init: {
          borrowAmount,
          collateralAmount: amountCollateral,
          collateralAmountBT18: convertUnits(
            amountCollateral
            , priceCollateral, collateralAssetDecimals
            , priceBorrow, 18
          )
        },
        predicted: {
          aprBt36: {
            collateral: supplyApr,
            borrow: borrowApr
          },
          rates: {
            borrowRate: borrowRatePredicted,
            supplyRate: supplyRatePredicted
          }
        },
        prices: {
          collateral: priceCollateral,
          borrow: priceBorrow,
        },
        resultsBlock: {
          period: {
            block0: next.block,
            blockTimestamp0: next.blockTimestamp,
            block1: last.block,
            blockTimestamp1: last.blockTimestamp,
          },
          rates: {
            borrowRate: next.borrow.market.borrowRatePerBlock,
            supplyRate: next.collateral.market.supplyRatePerBlock
          },
          aprBt36: {
            // collateral amount * priceCollateral / priceBorrow => amount in terms of borrow token
            // convert borrow tokens => decimals 36
            collateral: changeDecimals(
              deltaCollateralMul18.mul(priceCollateral)
              , borrowAssetDecimals
              , 18 // we need decimals 36, but deltaCollateralMul18 is already multiplied on 1e18
            ).div(priceBorrow),
            borrow: changeDecimals(deltaBorrowBalance, borrowAssetDecimals, 36)
          }
        },
        points: pointsResults
      }
    }
  }

  static async getEstimatedSupplyRate(
    libFacade: DForceAprLibFacade,
    state: IDForceState,
    amountCollateral: BigNumber,
    interestRateModel: string
  ) : Promise<BigNumber> {
    return libFacade.getEstimatedSupplyRatePure(
      state.collateral.market.totalSupply
      , amountCollateral
      , state.collateral.market.cash
      , state.collateral.market.totalBorrows
      , state.collateral.market.totalReserves
      , interestRateModel
      , state.collateral.market.reserveRatio
      , state.collateral.market.exchangeRateStored
    );
  }

  static async getEstimatedBorrowRate(
    libFacade: DForceAprLibFacade,
    token: IDForceCToken,
    borrowAmount: BigNumber
  ) : Promise<BigNumber> {
    return libFacade.getEstimatedBorrowRate(
      await token.interestRateModel()
      , token.address
      , borrowAmount
    );

  }
}