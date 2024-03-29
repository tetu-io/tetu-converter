import {BigNumber} from "ethers";
import {IBorrowResults, IPointResults} from "../shared/aprDataTypes";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ITestSingleBorrowParams} from "../../types/BorrowRepayDataTypes";
import {HundredFinanceHelper} from "../../../../scripts/integration/hundred-finance/HundredFinanceHelper";
import {
  HfAprLibFacade, HfTestHelper, IERC20Metadata__factory, IHfComptroller,
  IHfCToken,
  IHfCToken__factory,
} from "../../../../typechain";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import hre, {ethers} from "hardhat";
import {
  changeDecimals,
  convertUnits, getExpectedApr18, makeBorrow
} from "../shared/aprUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {HundredFinanceUtils} from "./HundredFinanceUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {parseUnits} from "ethers/lib/utils";
import {HundredFinancePlatformFabric} from "../../logic/fabrics/HundredFinancePlatformFabric";

//region Data types
interface IHfMarketState {
  accrualBlockNumber: BigNumber;
  borrowIndex: BigNumber;
  borrowRatePerBlock: BigNumber;
  exchangeRateStored: BigNumber;
  cash: BigNumber;
  reserveFactorMantissa: BigNumber;
  supplyRatePerBlock: BigNumber;
  totalBorrows: BigNumber;
  totalReserves: BigNumber;
  totalSupply: BigNumber;
}

export interface IHfAccountLiquidity {
  error: BigNumber;
  liquidity: BigNumber;
  shortfall: BigNumber;
}

export interface IHundredFinanceAccountSnapshot {
  error: BigNumber;
  tokenBalance: BigNumber;
  borrowBalance: BigNumber;
  exchangeRateMantissa: BigNumber;
}

export interface IHfUserAccountState {
  balance: BigNumber;
  borrowBalanceStored: BigNumber;
  borrowInterestIndex: BigNumber;

  accountLiquidity: BigNumber;
  accountShortfall: BigNumber;
  accountTokenBalance: BigNumber;
  accountBorrowBalance: BigNumber;
  exchangeRateMantissa: BigNumber;
}

interface IHfState {
  block: number,
  blockTimestamp: number;
  collateral: {
    market: IHfMarketState,
    account: IHfUserAccountState
  },
  borrow: {
    market: IHfMarketState,
    account: IHfUserAccountState
  },
}

interface IAprHfTwoResults {
  /** State before borrow */
  before: IHfState;
  /** State just after borrow */
  next: IHfState;
  /** State just after borrow + 1 block */
  last: IHfState;
  /** Borrower address */
  userAddress: string;
  /** Exact value of the borrowed amount */
  borrowAmount: BigNumber;

//// next : last  results

  /** Supply APR in terms of base currency calculated using predicted supply rate */
  supplyIncomeInBorrowAsset36Exact: BigNumber;
  /** Supply APR in terms of base currency calculated using exact supply rate taken from next step */
  supplyIncomeInBorrowAsset36: BigNumber;
  /** Borrow APR in terms of base currency calculated using predicted borrow rate */
  borrowCost36Exact: BigNumber;
  /** borrow APR in terms of base currency calculated using exact borrow rate taken from next step */
  borrowCost36: BigNumber;
  /** total increment of collateral amount from NEXT to LAST in terms of COLLATERAL currency */
  deltaCollateralMul18: BigNumber;
  /** total increment of collateral amount from NEXT to LAST in terms of BORROW currency */
  deltaCollateralBT: BigNumber;
  /** total increment of borrowed amount from NEXT to LAST in terms of BORROW currency */
  deltaBorrowBalance: BigNumber;
}
//endregion Data types

//region Utils
async function getHfMarketState(token: IHfCToken): Promise<IHfMarketState> {
  return {
    accrualBlockNumber: await token.accrualBlockNumber(),
    borrowIndex: await token.borrowIndex(),
    cash: await token.getCash(),
    borrowRatePerBlock: await token.borrowRatePerBlock(),
    exchangeRateStored: await token.exchangeRateStored(),
    reserveFactorMantissa: await token.reserveFactorMantissa(),
    supplyRatePerBlock: await token.supplyRatePerBlock(),
    totalBorrows: await token.totalBorrows(),
    totalReserves: await token.totalReserves(),
    totalSupply: await token.totalSupply()
  }
}

async function getHfUserAccountState(
  comptroller: IHfComptroller,
  token: IHfCToken,
  user: string
): Promise<IHfUserAccountState> {
  const e = await comptroller.getAccountLiquidity(user);
  const snapshot = await token.getAccountSnapshot(user);
  return {
    balance: await token.balanceOf(user),
    borrowBalanceStored: await token.borrowBalanceStored(user),
    borrowInterestIndex: await token.borrowIndex(),

    accountLiquidity: e.liquidity,
    accountShortfall: e.shortfall,
    accountBorrowBalance: snapshot.borrowBalance,
    accountTokenBalance: snapshot.tokenBalance,
    exchangeRateMantissa: snapshot.exchangeRateMantissa
  }
}

export async function getHfStateInfo(
  comptroller: IHfComptroller,
  cTokenCollateral: IHfCToken,
  cTokenBorrow: IHfCToken,
  user: string,
) : Promise<IHfState> {
  return {
    block: (await hre.ethers.provider.getBlock("latest")).number,
    blockTimestamp: (await hre.ethers.provider.getBlock("latest")).timestamp,
    collateral: {
      market: await getHfMarketState(cTokenCollateral),
      account: await getHfUserAccountState(comptroller, cTokenCollateral, user),
    },
    borrow: {
      market: await getHfMarketState(cTokenBorrow),
      account: await getHfUserAccountState(comptroller, cTokenBorrow, user),
    }
  }
}
//endregion Utils

export class AprHundredFinance {
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
    additionalPoints: number[]
  ): Promise<{
    details: IAprHfTwoResults,
    results: IBorrowResults
  }> {
    const collateralCTokenAddress = HundredFinanceUtils.getCToken(p.collateral.asset);
    const borrowCTokenAddress = HundredFinanceUtils.getCToken(p.borrow.asset);

    const comptroller = await HundredFinanceHelper.getComptroller(deployer);
    const cTokenCollateral = IHfCToken__factory.connect(collateralCTokenAddress, deployer);
    const cTokenBorrow = IHfCToken__factory.connect(borrowCTokenAddress, deployer);
    const priceOracle = await HundredFinanceHelper.getPriceOracle(deployer);

    const borrowAssetDecimals = await (IERC20Metadata__factory.connect(p.borrow.asset, deployer)).decimals();
    const collateralAssetDecimals = await (IERC20Metadata__factory.connect(p.collateral.asset, deployer)).decimals();

    const marketCollateralData = await HundredFinanceHelper.getCTokenData(deployer, comptroller, cTokenCollateral);
    const marketBorrowData = await HundredFinanceHelper.getCTokenData(deployer, comptroller, cTokenBorrow);

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
    const libFacade = await DeployUtils.deployContract(deployer, "HfAprLibFacade") as HfAprLibFacade;
    const hfHelper = await DeployUtils.deployContract(deployer, "HfTestHelper") as HfTestHelper;

    // start point: we estimate APR in this point before borrow and supply
    const before = await getHfStateInfo(comptroller
      , cTokenCollateral
      , cTokenBorrow
      // we don't have user address at this moment
      // so, use dummy address (and get dummy balance values - we don't use them)
      , ethers.Wallet.createRandom().address
    );

    const supplyRatePredicted = await this.getEstimatedSupplyRate(libFacade
      , cTokenCollateral
      , amountCollateral
    );
    console.log(`supplyRatePredicted=${supplyRatePredicted.toString()}`);

    const amountToBorrow = getBigNumberFrom(amountToBorrow0, borrowAssetDecimals);
    const borrowRatePredicted = await this.getEstimatedBorrowRate(libFacade
      , cTokenBorrow
      , amountToBorrow
    );
    console.log(`borrowRatePredicted=${borrowRatePredicted.toString()}`);

    // make borrow
    const borrowResults = await makeBorrow(deployer, p, amountToBorrow, new HundredFinancePlatformFabric());
    const userAddress = borrowResults.poolAdapter;
    const borrowAmount = borrowResults.borrowAmount;
    console.log(`userAddress=${userAddress} borrowAmount=${borrowAmount} amountToBorrow=${amountToBorrow}`);

    // next => last
    const next = await getHfStateInfo(comptroller, cTokenCollateral, cTokenBorrow, userAddress);

    // For borrow and collateral: move ahead on single block
    await hfHelper.accrueInterest(cTokenCollateral.address, cTokenBorrow.address);

    const last = await getHfStateInfo(comptroller, cTokenCollateral, cTokenBorrow, userAddress);

    console.log("before", before);
    console.log("next", next);
    console.log("last", last);


    // calculate exact values of supply/borrow APR
    // we use state-values "after-borrow" and exact values of supply/borrow rates after borrow
    const countBlocksNextToLast = 1;

    const supplyIncomeInBorrowAsset36 = await libFacade.getSupplyIncomeInBorrowAsset36(
      supplyRatePredicted,
      countBlocksNextToLast,
      parseUnits("1", collateralAssetDecimals),
      priceCollateral36,
      priceBorrow36,
      amountCollateral,
    );
    console.log("supplyIncomeInBorrowAsset36", supplyIncomeInBorrowAsset36);
    const supplyIncomeInBorrowAsset36Exact = await libFacade.getSupplyIncomeInBorrowAsset36(
      next.collateral.market.supplyRatePerBlock,
      countBlocksNextToLast,
      parseUnits("1", collateralAssetDecimals),
      priceCollateral36,
      priceBorrow36,
      amountCollateral,
    );
    console.log("supplyAprExact", supplyIncomeInBorrowAsset36Exact);

    const borrowCost36 = await libFacade.getBorrowCost36(
      borrowRatePredicted,
      borrowAmount,
      countBlocksNextToLast,
      parseUnits("1", borrowAssetDecimals),
    );
    console.log("borrowApr", borrowCost36);

    const borrowCost36Exact = await libFacade.getBorrowCost36(
      last.borrow.market.borrowRatePerBlock,
      borrowAmount,
      countBlocksNextToLast,
      parseUnits("1", borrowAssetDecimals),
    );
    console.log("borrowAprExact", borrowCost36);

    // get collateral (in terms of collateral tokens) for next and last points
    const collateralNextMul18 = next.collateral.account.balance.mul(next.collateral.market.exchangeRateStored);
    const collateralLastMul18 = last.collateral.account.balance.mul(last.collateral.market.exchangeRateStored);
    const deltaCollateralMul18 = collateralLastMul18.sub(collateralNextMul18);
    const deltaCollateralBtMul18 = deltaCollateralMul18.mul(priceCollateral).div(priceBorrow);
    console.log("collateralNextMul18", collateralNextMul18);
    console.log("collateralLastMul18", collateralLastMul18);
    console.log("deltaCollateralMul18", deltaCollateralMul18);
    console.log("deltaCollateralBT", deltaCollateralBtMul18);

    const deltaBorrowBalance = last.borrow.account.borrowBalanceStored.sub(
      next.borrow.account.borrowBalanceStored
    );
    console.log("deltaBorrowBalance", deltaBorrowBalance);

    const pointsResults: IPointResults[] = [];

    for (const period of additionalPoints) {
      await TimeUtils.advanceNBlocks(period);
      await hfHelper.accrueInterest(cTokenCollateral.address, cTokenBorrow.address);

      const current = await getHfStateInfo(comptroller
        , cTokenCollateral
        , cTokenBorrow
        , userAddress
      );

      const collateralCurrentMul18 = current.collateral.account.balance.mul(current.collateral.market.exchangeRateStored);
      const dc = collateralCurrentMul18.sub(collateralNextMul18);
      const db = current.borrow.account.borrowBalanceStored.sub(next.borrow.account.borrowBalanceStored);

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
        costsInBorrowTokens36: {
          collateral: changeDecimals(dc.mul(priceCollateral36).div(priceBorrow36), collateralAssetDecimals, 18),
          borrow: changeDecimals(db, borrowAssetDecimals, 36),
        }
      })
    }

    const collateralAmountInBorrowTokens36 = convertUnits(amountCollateral,
      priceCollateral,
      collateralAssetDecimals,
      priceBorrow,
      36
    );

    const predictedApr18 =  getExpectedApr18(
      borrowCost36,
      supplyIncomeInBorrowAsset36,
      BigNumber.from(0),
      collateralAmountInBorrowTokens36,
      Misc.WEI // rewards = 0, not used
    );

    const resultSupplyIncomeInBorrowTokens36 = changeDecimals(
      deltaCollateralMul18.mul(priceCollateral).div(priceBorrow)
      , borrowAssetDecimals
      , 18 // we need decimals 36, but deltaCollateralMul18 is already multiplied on 1e18
    );

    const resultCostBorrow36 = changeDecimals(deltaBorrowBalance, borrowAssetDecimals, 36);
    const resultApr18 = getExpectedApr18(
      resultCostBorrow36,
      resultSupplyIncomeInBorrowTokens36,
      BigNumber.from(0),
      collateralAmountInBorrowTokens36,
      Misc.WEI // rewards = 0, not used
    );

    return {
      details: {
        borrowCost36,
        borrowCost36Exact,
        before,
        deltaBorrowBalance,
        deltaCollateralMul18,
        supplyIncomeInBorrowAsset36,
        deltaCollateralBT: deltaCollateralBtMul18,
        borrowAmount,
        last,
        supplyIncomeInBorrowAsset36Exact,
        next,
        userAddress
      },
      results: {
        borrowAmount,
        collateralAmount: amountCollateral,
        collateralAmountInBorrowTokens18: collateralAmountInBorrowTokens36.div(Misc.WEI),
        predictedAmounts: {
          costBorrow36: borrowCost36,
          supplyIncomeInBorrowTokens36: supplyIncomeInBorrowAsset36,
          apr18: predictedApr18
        },
        predictedRates: {
          borrowRate: borrowRatePredicted,
          supplyRate: supplyRatePredicted
        },
        prices: {
          collateral: priceCollateral,
          borrow: priceBorrow,
        },
        period: {
          block0: next.block,
          blockTimestamp0: next.blockTimestamp,
          block1: last.block,
          blockTimestamp1: last.blockTimestamp,
        },
        resultRates: {
          borrowRate: next.borrow.market.borrowRatePerBlock,
          supplyRate: next.collateral.market.supplyRatePerBlock
        },
        resultAmounts: {
          supplyIncomeInBorrowTokens36: resultSupplyIncomeInBorrowTokens36,
          costBorrow36: resultCostBorrow36,
          apr18: resultApr18
        },
        points: pointsResults
      }
    }
  }

  static async getEstimatedSupplyRate(
    libFacade: HfAprLibFacade,
    token: IHfCToken,
    amountCollateral: BigNumber,
  ) : Promise<BigNumber> {
    return libFacade.getEstimatedSupplyRate(
      await token.interestRateModel(),
      token.address,
      amountCollateral
    );
  }

  static async getEstimatedBorrowRate(
    libFacade: HfAprLibFacade,
    token: IHfCToken,
    borrowAmount: BigNumber
  ) : Promise<BigNumber> {
    return libFacade.getEstimatedBorrowRate(
      await token.interestRateModel(),
      token.address,
      borrowAmount
    );

  }
}