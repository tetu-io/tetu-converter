import {BigNumber} from "ethers";
import {IAaveKeyTestValues, IBorrowResults, IPointResults} from "./aprDataTypes";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {DForceHelper} from "../../../scripts/integration/helpers/DForceHelper";
import {DForceAprLibFacade, IDForceController, IDForceCToken, IDForceCToken__factory} from "../../../typechain";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import hre, {ethers} from "hardhat";
import {
  changeDecimals,
  ConfigurableAmountToBorrow,
  convertUnits,
  makeBorrow
} from "./aprUtils";
import {DForcePlatformFabric} from "../fabrics/DForcePlatformFabric";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";

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

interface IDForceUserAccountState {
  balance: BigNumber;
  borrowBalanceStored: BigNumber;
  borrowPrincipal: BigNumber;
  borrowInterestIndex: BigNumber;

  // calcAccountEquity
  accountEquity: BigNumber;
  accountShortfall: BigNumber;
  accountCollateralValue: BigNumber;
  accountBorrowedValue: BigNumber;
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
    accountShortfall: e.shortfall,
    accountBorrowedValue: e.borrowedValue,
    accountCollateralValue: e.collateralValue
  }
}

async function getDForceStateInfo(
  comptroller: IDForceController
  , cTokenCollateral: IDForceCToken
  , cTokenBorrow: IDForceCToken
  , user: string
) : Promise<IDForceState> {
  return {
    block: (await hre.ethers.provider.getBlock("latest")).number,
    blockTimestamp: (await hre.ethers.provider.getBlock("latest")).timestamp,
    collateral: {
      market: await getDForceMarketState(cTokenCollateral),
      account: await getDForceUserAccountState(comptroller, cTokenCollateral, user),
    }, borrow: {
      market: await getDForceMarketState(cTokenBorrow),
      account: await getDForceUserAccountState(comptroller, cTokenBorrow, user),
    }
  }
}
//endregion Utils

export class AprDForce {
  /** State before borrow */
  before: IDForceState | undefined;
  /** State just after borrow */
  next: IDForceState | undefined;
  /** After borrow + 1 block */
  middle: IDForceState | undefined;
  /** State just after borrow + 1 block */
  last: IDForceState | undefined;
  /** Borrower address */
  userAddress: string | undefined;
  /** Exact value of the borrowed amount */
  borrowAmount: BigNumber = BigNumber.from(0);

//// next : last  results

  /** Supply APR in terms of base currency calculated using predicted supply rate */
  supplyAprExact: BigNumber | undefined;
  /** Supply APR in terms of base currency calculated using exact supply rate taken from next step */
  supplyApr: BigNumber | undefined;
  /** Borrow APR in terms of base currency calculated using predicted borrow rate */
  borrowAprExact: BigNumber | undefined;
  /** borrow APR in terms of base currency calculated using exact borrow rate taken from next step */
  borrowApr: BigNumber | undefined;
  /** total increment of collateral amount from NEXT to LAST in terms of COLLATERAL currency */
  deltaCollateral: BigNumber | undefined;
  /** total increment of collateral amount from NEXT to LAST in terms of BORROW currency */
  deltaCollateralBT: BigNumber | undefined;
  /** total increment of borrowed amount from NEXT to LAST in terms of BORROW currency */
  deltaBorrowBalance: BigNumber | undefined;


  keyValues: IAaveKeyTestValues | undefined;

  /**
   * 0. Predict APR
   * 1. Make borrow
   * This is "next point" (or AFTER BORROW point)
   * 2. update supply interest
   * This is "middle point" (+ 1 block since next)
   * 3. update borrow interest
   * This is "last point" (+ 2 blocks since next)
   * 3. Calculate real APR for the period since "next" to "last"
   * 4. Enumerate all additional points. Move to the point, get balances, save them to the results.
   *
   * @param deployer
   * @param amountToBorrow0 Amount to borrow without decimals (i.e. 100 for 100 DAI)
   * @param collateralCTokenAddress
   * @param borrowCTokenAddress
   * @param p Main parameters (asset, amounts, so on)
   * @param additionalPoints
   */
  async makeBorrowTest(
    deployer: SignerWithAddress
    , amountToBorrow0: ConfigurableAmountToBorrow
    , collateralCTokenAddress: string
    , borrowCTokenAddress: string
    , p: TestSingleBorrowParams
    , additionalPoints: number[]
  ): Promise<IBorrowResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const comptroller = await DForceHelper.getController(deployer);
    const cTokenCollateral = IDForceCToken__factory.connect(collateralCTokenAddress, deployer);
    const cTokenBorrow = IDForceCToken__factory.connect(borrowCTokenAddress, deployer);
    const priceOracle = await DForceHelper.getPriceOracle(comptroller, deployer);
    const rewardsDistributor = await DForceHelper.getRewardDistributor(comptroller, deployer);

    const marketCollateralData = await DForceHelper.getCTokenData(deployer, comptroller, cTokenCollateral);
    const marketBorrowData = await DForceHelper.getCTokenData(deployer, comptroller, cTokenBorrow);

    console.log("marketCollateralData", marketCollateralData);
    console.log("marketBorrowData", marketBorrowData);

    const amountCollateral = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);
    console.log(`amountCollateral=${amountCollateral.toString()}`);

    // prices
    const priceCollateral = await priceOracle.getUnderlyingPrice(collateralCTokenAddress);
    const priceBorrow = await priceOracle.getUnderlyingPrice(borrowCTokenAddress);
    console.log("priceCollateral", priceCollateral);
    console.log("priceBorrow", priceBorrow);

    // predict APR
    const libFacade = await DeployUtils.deployContract(deployer, "DForceAprLibFacade") as DForceAprLibFacade;

    // start point: we estimate APR in this point before borrow and supply
    this.before = await getDForceStateInfo(comptroller
      , cTokenCollateral
      , cTokenBorrow
      // we don't have user address at this moment
      // so, use dummy address (and get dummy balance values - we don't use them)
      , ethers.Wallet.createRandom().address
    );

    // make borrow
    const borrowResults = await makeBorrow(
      deployer
      , p
      , amountToBorrow0
      , new DForcePlatformFabric()
    );
    this.userAddress = borrowResults.poolAdapter;
    this.borrowAmount = borrowResults.borrowAmount;
    console.log(`userAddress=${this.userAddress} borrowAmount=${this.borrowAmount}`);

    const borrowRatePredicted = await libFacade.getEstimatedBorrowRate(
      await cTokenBorrow.interestRateModel()
      , cTokenBorrow.address
      , this.borrowAmount
    );
    console.log(`borrowRatePredicted=${borrowRatePredicted.toString()}`);

    const supplyRatePredicted = await libFacade.getEstimatedSupplyRatePure(
      this.before.collateral.market.totalSupply
      , amountCollateral
      , this.before.collateral.market.cash
      , this.before.collateral.market.totalBorrows
      , this.before.collateral.market.totalReserves
      , marketCollateralData.interestRateModel
      , this.before.collateral.market.reserveRatio
      , this.before.collateral.market.exchangeRateStored
    );
    console.log(`supplyRatePredicted=${supplyRatePredicted.toString()}`);

    // next => last
    this.next = await getDForceStateInfo(comptroller
      , cTokenCollateral
      , cTokenBorrow
      , this.userAddress
    );

    // For collateral: move ahead on single block
    await cTokenCollateral.updateInterest(); //await TimeUtils.advanceNBlocks(1);

    this.middle = await getDForceStateInfo(comptroller
      , cTokenCollateral
      , cTokenBorrow
      , this.userAddress
    );

    // For borrow: move ahead on one more block
    await cTokenBorrow.updateInterest();

    this.last = await getDForceStateInfo(comptroller
      , cTokenCollateral
      , cTokenBorrow
      , this.userAddress
    );

    console.log("before", this.before);
    console.log("next", this.next);
    console.log("middle", this.middle);
    console.log("last", this.last);


    // calculate exact values of supply/borrow APR
    // we use state-values "after-borrow" and exact values of supply/borrow rates after borrow
    const countBlocksSupply = 1; // after next, we call UpdateInterest for supply token...
    const countBlocksBorrow = 2; // ...then for the borrow token

    this.supplyApr = await libFacade.getSupplyApr18(
      supplyRatePredicted
      , countBlocksSupply
      , await cTokenCollateral.decimals()
      , priceCollateral
      , priceBorrow
      , amountCollateral
    );
    console.log("supplyApr", this.supplyApr);
    this.supplyAprExact = await libFacade.getSupplyApr18(
      this.next.collateral.market.supplyRatePerBlock
      , countBlocksSupply
      , await cTokenCollateral.decimals()
      , priceCollateral
      , priceBorrow
      , amountCollateral
    );
    console.log("supplyAprExact", this.supplyAprExact);

    this.borrowApr = await libFacade.getBorrowApr18(
      borrowRatePredicted
      , this.borrowAmount
      , countBlocksBorrow
      , await cTokenBorrow.decimals()
    );
    console.log("borrowApr", this.borrowApr);

    this.borrowAprExact = await libFacade.getBorrowApr18(
      this.middle.borrow.market.borrowRatePerBlock
      , this.borrowAmount
      , countBlocksBorrow
      , await cTokenBorrow.decimals()
    );
    console.log("borrowAprExact", this.borrowApr);

    // get collateral (in terms of collateral tokens) for next and last points
    const base = getBigNumberFrom(1, 18);
    const collateralNext = this.next.collateral.account.balance
      .mul(this.next.collateral.market.exchangeRateStored)
      .div(base);
    const collateralLast = this.last.collateral.account.balance
      .mul(this.last.collateral.market.exchangeRateStored)
      .div(base);
    this.deltaCollateral = collateralLast.sub(collateralNext);
    this.deltaCollateralBT = this.deltaCollateral.mul(priceCollateral).div(priceBorrow);
    console.log("collateralNext", collateralNext);
    console.log("collateralLast", collateralLast);
    console.log("deltaCollateral", this.deltaCollateral);
    console.log("deltaCollateralBT", this.deltaCollateralBT);

    this.deltaBorrowBalance = this.last.borrow.account.borrowBalanceStored.sub(
      this.next.borrow.account.borrowBalanceStored
    );
    console.log("deltaBorrowBalance", this.deltaBorrowBalance);

    const pointsResults: IPointResults[] = [];
    let prev = this.last;
    for (const period of additionalPoints) {
      // we need 4 blocks to update rewards ... so we need to make advance on N - 4 blocks
      if (period > 4) {
        await TimeUtils.advanceNBlocks(period - 4);
        await rewardsDistributor.updateDistributionState(collateralCTokenAddress, false);
        await rewardsDistributor.updateReward(collateralCTokenAddress, this.userAddress, false);
        await rewardsDistributor.updateDistributionState(borrowCTokenAddress, true);
        await rewardsDistributor.updateReward(borrowCTokenAddress, this.userAddress, true);
      } else {
        await TimeUtils.advanceNBlocks(period); // no rewards, period is too small
      }
      const totalAmountRewards = await rewardsDistributor.reward(this.userAddress);

      let current = await getDForceStateInfo(comptroller
        , cTokenCollateral
        , cTokenBorrow
        , this.userAddress
      );

      const collateralPrev = prev.collateral.account.balance
        .mul(prev.collateral.market.exchangeRateStored)
        .div(base);
      const collateralCurrent = current.collateral.account.balance
        .mul(current.collateral.market.exchangeRateStored)
        .div(base);
      const dc = collateralCurrent.sub(collateralNext);
      const db = current.borrow.account.borrowBalanceStored.sub(
        prev.borrow.account.borrowBalanceStored
      );

      pointsResults.push({
        period: {
          block0: prev.block,
          blockTimestamp0: prev.blockTimestamp,
          block1: current.block,
          blockTimestamp1: current.blockTimestamp,
        }, rates: {
          supplyRate: current.collateral.market.supplyRatePerBlock,
          borrowRate: current.borrow.market.borrowRatePerBlock
        }, balances: {
          collateral: current.collateral.account.balance,
          borrow: current.borrow.account.borrowBalanceStored
        }, costsBT18: {
          collateral: changeDecimals(dc.mul(priceCollateral).div(priceBorrow), collateralToken.decimals, 18),
          borrow: changeDecimals(db, borrowToken.decimals, 18),
        }, totalAmountRewards: totalAmountRewards
      })
    }

    return {
      init: {
        borrowAmount: this.borrowAmount,
        collateralAmount: amountCollateral,
        collateralAmountBT18: convertUnits(
          amountCollateral
          , priceCollateral, collateralToken.decimals
          , priceBorrow, 18
        )
      }, predicted: {
        aprBT18: {
          collateral: this.supplyApr,
          borrow: this.borrowApr
        },
        rates: {
          borrowRate: borrowRatePredicted,
          supplyRate: supplyRatePredicted
        }
      }, prices: {
        collateral: priceCollateral,
        borrow: priceBorrow,
      }, resultsBlock: {
        period: {
          block0: this.next.block,
          blockTimestamp0: this.next.blockTimestamp,
          block1: this.last.block,
          blockTimestamp1: this.last.blockTimestamp,
        },
        rates: {
          borrowRate: this.next.borrow.market.borrowRatePerBlock,
          supplyRate: this.next.collateral.market.supplyRatePerBlock
        },
        aprBT18: {
          collateral: changeDecimals(
            this.deltaCollateral.mul(priceCollateral).div(priceBorrow)
            , collateralToken.decimals
            , 18
          ), borrow: changeDecimals(this.deltaBorrowBalance, borrowToken.decimals, 18)
        }
      },
      points: pointsResults
    }
  }
}