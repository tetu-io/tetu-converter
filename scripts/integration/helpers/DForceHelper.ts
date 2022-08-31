import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IDForceController,
  IDForceController__factory,
  IDForceCToken,
  IDForceCToken__factory,
  IDForceInterestRateModel__factory,
  IDForceRewardDistributor__factory,
  IDForcePriceOracle,
  IDForcePriceOracle__factory,
  IDForceRewardDistributor,
  IERC20Extended__factory,
  IDForceLendingData,
  IDForceLendingData__factory

} from "../../../typechain";
import {BigNumber, ContractTransaction, Signer} from "ethers";
import {Aave3Helper} from "./Aave3Helper";
import {MaticAddresses} from "../../addresses/MaticAddresses";
import {TokenDataTypes} from "../../../test/baseUT/types/TokenDataTypes";
import {DeployerUtils} from "../../utils/DeployerUtils";
import {getBigNumberFrom} from "../../utils/NumberUtils";

//region Data types
interface IDForceMarketData {
  controller: string;
  name: string;
  symbol: string;
  decimals: number;
  ctoken: string;
  underlying: string;
  /** The supply interest rate per block, scaled by 1e18 */
  borrowRatePerBlock: BigNumber;
  exchangeRateStored: BigNumber;
  /** cash balance of this cToken in the underlying asset */
  cash: BigNumber;
  /** Total amount of outstanding borrows of the underlying in this market */
  totalBorrows: BigNumber;
  /** Total amount of reserves of the underlying held in this market */
  totalReserves: BigNumber;
  /** Total number of tokens in circulation */
  totalSupply: BigNumber;
  /** Fraction of interest currently set aside for reserves */
  reserveRatio: BigNumber;
  /*
   *  Multiplier representing the most one can borrow the asset.
   *  For instance, 0.5 to allow borrowing this asset 50% * collateral value * collateralFactor.
   *  When calculating equity, 0.5 with 100 borrow balance will produce 200 borrow value
   *  Must be between (0, 1], and stored as a mantissa.
   */
  borrowFactorMantissa: BigNumber;
  /*
   *  Multiplier representing the most one can borrow against their collateral in this market.
   *  For instance, 0.9 to allow borrowing 90% of collateral value.
   *  Must be in [0, 0.9], and stored as a mantissa.
   */
  collateralFactorMantissa: BigNumber;
  closeFactorMantissa: BigNumber;
  mintPaused: boolean;
  redeemPaused: boolean;
  borrowPaused: boolean;
  /** Model which tells what the current interest rate should be */
  interestRateModel: string;
  /*
   *  The borrow capacity of the asset, will be checked in beforeBorrow()
   *  -1 means there is no limit on the capacity
   *  0 means the asset can not be borrowed any more
   */
  borrowCapacity: BigNumber;
  /*
   *  The supply capacity of the asset, will be checked in beforeMint()
   *  -1 means there is no limit on the capacity
   *  0 means the asset can not be supplied any more
   */
  supplyCapacity: BigNumber;
  price: BigNumber;
  underlyingDecimals: number;

  blocksPerYear: BigNumber;
}

export interface IDForceMarketRewards {
  controller: string;
  name: string;
  symbol: string;
  decimals: number;
  ctoken: string;
  underlying: string;

  distributionBorrowState_Index: BigNumber;
  distributionBorrowState_Block: BigNumber;
  distributionFactorMantissa: BigNumber;
  distributionSpeed: BigNumber;
  distributionSupplySpeed: BigNumber;
  distributionSupplyState_Index: BigNumber;
  distributionSupplyState_Block: BigNumber;
  globalDistributionSpeed: BigNumber;
  globalDistributionSupplySpeed: BigNumber;
  rewardToken: string;
  paused: boolean;

  rewardTokenPrice: BigNumber;
}

export interface IDForceMarketAccount {
  distributionSupplierIndex: BigNumber;
  distributionBorrowerIndex: BigNumber;
  accountBalance: BigNumber;
  rewards: BigNumber;
}

/**
 * All data at the given block
 * required to calculate rewards
 * that we will have at any given block in the future
 * (on the assumption, that no data is changed between blocks)
 */
export interface IRewardsStatePoint {
  accountBalance: BigNumber;
  stateIndex: BigNumber;
  distributionSpeed: BigNumber;
  totalToken: BigNumber;
  accountIndex: BigNumber;
  stateBlock: BigNumber;
}

/**
 * All data at the moment of supply
 * required to calculate amount of rewards
 * that we will have at any given block in the future
 * (on the assumption, that no data is changed after supply)
 */
export interface ISupplyRewardsStatePoint {
  /** Block in which supply happens */
  blockSupply: BigNumber;
  beforeSupply: {
    stateIndex: BigNumber;
    stateBlock: BigNumber;
    distributionSpeed: BigNumber;
    totalSupply: BigNumber;
  }
  supplyAmount: BigNumber;
}

/**
 * All data at the moment of borrow
 * required to calculate amount of borrow-rewards
 * that we will have at any given block in the future
 * (on the assumption, that no data is changed after supply)
 */
export interface IBorrowRewardsStatePoint {
  /** Block in which borrow happens */
  blockBorrow: BigNumber;
  beforeBorrow: {
    stateIndex: BigNumber;
    stateBlock: BigNumber;
    distributionSpeed: BigNumber;
    totalBorrow: BigNumber;
    borrowIndex: BigNumber;
    borrowBalanceStored: BigNumber;
  }
  borrowAmount: BigNumber;
  /** Borrow index at the moment of claiming rewards.
   *  Borrow index is updated manually(?) using updateInterest() */
  borrowIndexClaimRewards: BigNumber;
}
//endregion Data types

export class DForceHelper {
//region Access
  public static getController(signer: SignerWithAddress) : IDForceController {
    return IDForceController__factory.connect(MaticAddresses.DFORCE_CONTROLLER, signer);
  }

  public static async getPriceOracle(
    controller: IDForceController
    , signer: SignerWithAddress
  ) : Promise<IDForcePriceOracle> {
    return IDForcePriceOracle__factory.connect(await controller.priceOracle(), signer);
  }

  public static async getRewardDistributor(
    controller: IDForceController
    , signer: SignerWithAddress
  ) : Promise<IDForceRewardDistributor> {
    return IDForceRewardDistributor__factory.connect(await controller.rewardDistributor(), signer);
  }

  public static async getLendingData (
    controller: IDForceController
    , signer: SignerWithAddress
  ) : Promise<IDForceLendingData> {
    return IDForceLendingData__factory.connect(MaticAddresses.DFOCE_LENDING_DATA, signer);
  }
//endregion Access

//region Read data
  public static async getCTokenData(
    signer: SignerWithAddress,
    controller: IDForceController,
    cToken: IDForceCToken,
  ) : Promise<IDForceMarketData> {
    const m = await controller.markets(cToken.address);
    const priceOracle = await DForceHelper.getPriceOracle(controller, signer);
    const irm = IDForceInterestRateModel__factory.connect(await cToken.interestRateModel(), signer);

    console.log(cToken.address);
    console.log(await cToken.underlying());
    console.log(await cToken.name());

    return {
      controller: await cToken.controller(),
      ctoken: cToken.address,
      underlying: cToken.address == MaticAddresses.dForce_iMATIC
        ? "" // iMatic doesn't support CErc20Storage and doesn't have underlying property
        : await cToken.underlying(),
      name: await cToken.name(),
      symbol: await cToken.symbol(),
      decimals: await cToken.decimals(),
      borrowRatePerBlock: await cToken.borrowRatePerBlock(),
      exchangeRateStored: await cToken.exchangeRateStored(),
      cash: await cToken.getCash(),
      reserveRatio: await cToken.reserveRatio(),
      totalBorrows: await cToken.totalBorrows(),
      totalReserves: await cToken.totalReserves(),
      totalSupply: await cToken.totalSupply(),
      borrowFactorMantissa: m.borrowFactorMantissa,
      collateralFactorMantissa: m.collateralFactorMantissa,
      closeFactorMantissa: await controller.closeFactorMantissa(),
      interestRateModel: await cToken.interestRateModel(),
      borrowCapacity: m.borrowCapacity,
      supplyCapacity: m.supplyCapacity,
      borrowPaused: m.borrowPaused,
      mintPaused: m.mintPaused,
      redeemPaused: m.redeemPaused,
      price: await priceOracle.getUnderlyingPrice(cToken.address),
      underlyingDecimals: await IERC20Extended__factory.connect(
        cToken.address == MaticAddresses.dForce_iMATIC
          ? MaticAddresses.WMATIC
          : await cToken.underlying()
        , signer
      ).decimals(),
      blocksPerYear: await irm.blocksPerYear()
    }
  }
//endregion Read data

//region Get data for script
  public static async getData(
    signer: SignerWithAddress,
    controller: IDForceController
  ) : Promise<string[]> {
    const markets = await controller.getAlliTokens();
    const dest: string[] = [];
    dest.push([
      "name",
      "controller",
      "symbol", "decimals", "ctoken", "underlying",
      "borrowRatePerBlock", "exchangeRateStored",
      "cash", "reserveFactorMantissa",
      "totalBorrows", "totalReserves", "totalSupply",
      "borrowFactorMantissa", "collateralFactorMantissa", "closeFactorMantissa",
      "interestRateModel",
      "borrowCapacity", "supplyCapacity",
      "redeemPaused", "mintPaused", "borrowPaused",
      "price",
      "underlyingDecimals",
      "blocksPerYear"
    ].join(","));

    for (const market of markets) {
      console.log(`Market ${market}`);

      const cToken = IDForceCToken__factory.connect(market, signer);
      const rd = await DForceHelper.getCTokenData(signer, controller, cToken);

      const line = [
        rd.name,
        rd.controller,
        rd.symbol, rd.decimals, rd.ctoken, rd.underlying,
        rd.borrowRatePerBlock, rd.exchangeRateStored,
        rd.cash, rd.reserveRatio,
        rd.totalBorrows, rd.totalReserves, rd.totalSupply,
        rd.borrowFactorMantissa, rd.collateralFactorMantissa, rd.closeFactorMantissa,
        rd.interestRateModel,
        rd.borrowCapacity, rd.supplyCapacity,
        rd.redeemPaused, rd.mintPaused, rd.borrowPaused,
        rd.price,
        rd.underlyingDecimals,
        rd.blocksPerYear
      ];

      dest.push(line.map(x => Aave3Helper.toString(x)).join(","));
    }

    return dest;
  }
//endregion Get data for script

//region Rewards
  public static async getMarketAccountRewardsInfo(
    controller: IDForceController,
    rd: IDForceRewardDistributor,
    cToken: IDForceCToken,
    account: string
  ) : Promise<IDForceMarketAccount> {
    return {
      accountBalance: await cToken.balanceOf(account),
      rewards: await rd.reward(account),
      distributionSupplierIndex: await rd.distributionSupplierIndex(cToken.address, account),
      distributionBorrowerIndex: await rd.distributionBorrowerIndex(cToken.address, account),
    }
  }

  public static async getRewardsForMarket(
    controller: IDForceController,
    rd: IDForceRewardDistributor,
    cToken: IDForceCToken,
    priceOracle: IDForcePriceOracle
  ) : Promise<IDForceMarketRewards> {
    const bs = await rd.distributionBorrowState(cToken.address);
    const ss = await rd.distributionSupplyState(cToken.address);

    return {
      controller: await cToken.controller(),
      ctoken: cToken.address,
      underlying: cToken.address == MaticAddresses.dForce_iMATIC
        ? "" //iMatic doesn't support CErc20Storage and doesn't have underlying property
        : await cToken.underlying(),
      name: await cToken.name(),
      symbol: await cToken.symbol(),
      decimals: await cToken.decimals(),
      distributionBorrowState_Index: bs.index,
      distributionBorrowState_Block: bs.block_,
      distributionFactorMantissa: await rd.distributionFactorMantissa(cToken.address),
      distributionSpeed: await rd.distributionSpeed(cToken.address),
      distributionSupplySpeed: await rd.distributionSupplySpeed(cToken.address),
      distributionSupplyState_Index: ss.index,
      distributionSupplyState_Block: ss.block_,
      globalDistributionSpeed: await rd.globalDistributionSpeed(),
      globalDistributionSupplySpeed: await rd.globalDistributionSupplySpeed(),
      rewardToken: await rd.rewardToken(),
      paused: await rd.paused(),
      rewardTokenPrice: await priceOracle.getUnderlyingPrice(await rd.rewardToken())
    }
  }

  public static async getRewardsData(
    signer: SignerWithAddress,
    controller: IDForceController
  ) : Promise<string[]> {
    const rd = await DForceHelper.getRewardDistributor(controller, signer);
    const markets = await controller.getAlliTokens();
    const priceOracle = await DForceHelper.getPriceOracle(controller, signer);

    const dest: string[] = [];
    dest.push([
      "controller", "name", "symbol", "decimals", "ctoken", "underlying",

      "distributionBorrowState_Index",
      "distributionBorrowState_Block",
      "distributionFactorMantissa",
      "distributionSpeed",
      "distributionSupplySpeed",
      "distributionSupplyState_Index",
      "distributionSupplyState_Block",
      "globalDistributionSpeed",
      "globalDistributionSupplySpeed",
      "rewardToken",
      "paused",
      "rewardTokenPrice"
    ].join(","));

    for (const market of markets) {
      console.log(`Market ${market}`);

      const cToken = IDForceCToken__factory.connect(market, signer);

      const row = await DForceHelper.getRewardsForMarket(controller, rd, cToken, priceOracle);
      const line = [
        row.controller, row.name, row.symbol, row.decimals
        , row.ctoken, row.underlying,

        row.distributionBorrowState_Index,
        row.distributionBorrowState_Block,
        row.distributionFactorMantissa,
        row.distributionSpeed,
        row.distributionSupplySpeed,
        row.distributionSupplyState_Index,
        row.distributionSupplyState_Block,
        row.globalDistributionSpeed,
        row.globalDistributionSupplySpeed,
        row.rewardToken,
        row.paused,
        row.rewardTokenPrice
      ];
      dest.push(line.map(x => Aave3Helper.toString(x)).join(","));
    }

    return dest;
  }

  public static rdiv(x: BigNumber, y: BigNumber) : BigNumber {
    const base = getBigNumberFrom(1, 18);
    return x.mul(base).div(y);
  }

  public static rmul(x: BigNumber, y: BigNumber) : BigNumber {
    const base = getBigNumberFrom(1, 18);
    return x.mul(y).div(base);
  }

  public static divup(x: BigNumber, y: BigNumber) : BigNumber {
    return x.add(y.sub(1)).div(y);
  }
//endregion Rewards

//region Rewards calculations

  /**
   * Calculate totalToken value for borrow case.
   *
   * See LendingContractsV2, RewardDistributorV3.sol, _updateDistributionState
   * */
  public static getTotalTokenForBorrowCase(totalBorrows: BigNumber, borrowIndex: BigNumber) : BigNumber {
    return this.rdiv(totalBorrows, borrowIndex);
  }

  /** See LendingContractsV2, RewardDistributorV3.sol, _updateDistributionState */
  public static calcDistributionStateSupply(
    currentBlock: BigNumber,
    stateBlock: BigNumber,
    stateIndex: BigNumber,
    distributionSpeed: BigNumber,
    totalToken: BigNumber,
  ) : BigNumber {
    // uint256 _totalDistributed = _speed.mul(_deltaBlocks);
    const totalDistributed = distributionSpeed.mul(currentBlock.sub(stateBlock));

    // uint256 _distributedPerToken = _totalToken > 0 ? _totalDistributed.rdiv(_totalToken) : 0;
    const distributedPerToken = totalToken.gt(0)
      ? this.rdiv(totalDistributed, totalToken)
      : BigNumber.from(0);

    console.log("block", currentBlock);
    console.log("stateBlock", stateBlock);
    console.log("stateIndex", stateIndex);
    console.log("distributionSpeed", distributionSpeed);
    console.log("totalDistributed", totalDistributed);
    console.log("distributedPerToken", distributedPerToken);
    console.log("totalToken", totalToken);
    console.log("Next state index=", stateIndex.add(distributedPerToken));

    // state.index = state.index.add(_distributedPerToken);
    return stateIndex.add(distributedPerToken);
  }

  /** See LendingContractsV2, RewardDistributorV3.sol, _updateReward */
  public static calcUpdateRewards(
    iTokenIndex: BigNumber,
    accountIndex: BigNumber,
    accountBalance: BigNumber,
  ) : BigNumber {
    // uint256 _deltaIndex = _iTokenIndex.sub(_accountIndex);
    const deltaIndex = iTokenIndex.sub(accountIndex);

    // uint256 _amount = _accountBalance.rmul(_deltaIndex);
    const amount = this.rmul(accountBalance, deltaIndex);
    console.log("iTokenIndex", iTokenIndex);
    console.log("accountIndex", accountIndex);
    console.log("accountBalance", accountBalance);

    return amount;
  }

  /**
   * Calculate amount of rewards
   * from the given point
   * up to the given block
   * in assumption, that the market data and the account data
   * are not changed in that period
   * @param pt
   * @param currentBlock
   */
  public static getSupplyRewardsAmount(
    pt: IRewardsStatePoint,
    currentBlock: BigNumber
  ) : {
    rewardsAmount: BigNumber,
    newSupplyStateIndex: BigNumber
  } {
    // manually calculate rewards for user 1
    const newSupplyStateIndex = DForceHelper.calcDistributionStateSupply(
      currentBlock,
      pt.stateBlock,
      pt.stateIndex,
      pt.distributionSpeed,
      pt.totalToken
    );

    const rewardsAmount = this.calcUpdateRewards(
      newSupplyStateIndex, // == iTokenIndex == distributionSupplyState[_iToken].index;
      pt.accountIndex,
      pt.accountBalance
    );
    return {rewardsAmount, newSupplyStateIndex};
  }

  public static getBorrowRewardsAmount(
    pt: IRewardsStatePoint,
    currentBlock: BigNumber
  ) : {
    rewardsAmount: BigNumber,
    newBorrowStateIndex: BigNumber
  } { //TODO: merge getSupplyRewardsAmount and getBorrowRewardsAmount
    // manually calculate rewards for user 1
    const newBorrowStateIndex = DForceHelper.calcDistributionStateSupply(
      currentBlock,
      pt.stateBlock,
      pt.stateIndex,
      pt.distributionSpeed,
      pt.totalToken
    );
    console.log("newBorrowStateIndex", newBorrowStateIndex);

    const rewardsAmount = this.calcUpdateRewards(
      newBorrowStateIndex,
      pt.accountIndex,
      pt.accountBalance
    );
    return {rewardsAmount, newBorrowStateIndex};
  }
//endregion Rewards calculations

//region Generate IRewardsStatePoint - supply
  public static getRewardsStatePointForSupply(
    marketData: IDForceMarketRewards,
    accountData: IDForceMarketAccount,
    totalSupply: BigNumber,
  ) : IRewardsStatePoint {
    return {
      stateIndex: marketData.distributionSupplyState_Index,
      stateBlock: marketData.distributionBorrowState_Block,
      distributionSpeed: marketData.distributionSupplySpeed,
      accountBalance: accountData.accountBalance,
      accountIndex: accountData.distributionSupplierIndex,
      totalToken: totalSupply
    }
  }

  public static getSupplyRewardsStatePoint(
    blockSupply: BigNumber,
    marketDataBeforeSupply: IDForceMarketRewards,
    totalSupplyBeforeSupply: BigNumber,
    supplyAmount: BigNumber
  ) : ISupplyRewardsStatePoint {
    return {
      blockSupply: blockSupply,
      beforeSupply: {
            stateIndex: marketDataBeforeSupply.distributionSupplyState_Index,
            stateBlock: marketDataBeforeSupply.distributionSupplyState_Block,
            distributionSpeed: marketDataBeforeSupply.distributionSupplySpeed,
            totalSupply: totalSupplyBeforeSupply
          },
      supplyAmount: supplyAmount
    }
  }

  public static predictRewardsStatePointAfterSupply(
    pt: ISupplyRewardsStatePoint
  ) : IRewardsStatePoint {
    let totalSupply = pt.beforeSupply.totalSupply;
    let stateIndex = pt.beforeSupply.stateIndex;
    const distributedPerToken = DForceHelper.rdiv(
      pt.beforeSupply.distributionSpeed.mul(pt.blockSupply.add(1).sub(pt.beforeSupply.stateBlock))
      , totalSupply
    );
    stateIndex = stateIndex.add(distributedPerToken);
    totalSupply = totalSupply.add(pt.supplyAmount);

    return {
      accountBalance: pt.supplyAmount,
      stateIndex: stateIndex,
      distributionSpeed: pt.beforeSupply.distributionSpeed,
      totalToken: totalSupply,
      accountIndex: stateIndex,
      stateBlock: pt.blockSupply
    }
  }
//endregion Generate IRewardsStatePoint - supply

//region Generate IRewardsStatePoint - borrow
  public static getRewardsStatePointForBorrow(
    marketData: IDForceMarketRewards,
    accountData: IDForceMarketAccount,
    borrowIndex: BigNumber,
    borrowBalanceStored: BigNumber,
    totalBorrows: BigNumber,
  ) : IRewardsStatePoint {
    return {
      stateIndex: marketData.distributionBorrowState_Index,
      stateBlock: marketData.distributionBorrowState_Block,
      distributionSpeed: marketData.distributionSpeed,
      accountBalance: this.rdiv(borrowBalanceStored, borrowIndex),
      accountIndex: accountData.distributionBorrowerIndex,
      totalToken: this.getTotalTokenForBorrowCase(totalBorrows, borrowIndex)
    }
  }

  public static getBorrowRewardsStatePoint(
    blockBorrow: BigNumber,
    marketDataBeforeBorrow: IDForceMarketRewards,
    totalBorrowBeforeBorrow: BigNumber,
    borrowIndex: BigNumber,
    borrowBalanceStored: BigNumber,
    borrowAmount: BigNumber,
    borrowIndexClaimRewards: BigNumber
  ) : IBorrowRewardsStatePoint {
    return {
      blockBorrow: blockBorrow,
      beforeBorrow: {
        stateIndex: marketDataBeforeBorrow.distributionBorrowState_Index,
        stateBlock: marketDataBeforeBorrow.distributionBorrowState_Block,
        distributionSpeed: marketDataBeforeBorrow.distributionSpeed,
        totalBorrow: totalBorrowBeforeBorrow,
        borrowIndex: borrowIndex,
        borrowBalanceStored: borrowBalanceStored
      },
      borrowAmount: borrowAmount,
      borrowIndexClaimRewards: borrowIndexClaimRewards
    }
  }

  public static predictRewardsStatePointAfterBorrow(
    pt: IBorrowRewardsStatePoint
  ) : IRewardsStatePoint {
    let totalBorrows = pt.beforeBorrow.totalBorrow;
    let stateIndex = pt.beforeBorrow.stateIndex;
    console.log("predictRewardsStatePointAfterBorrow");
    console.log("totalBorrows", totalBorrows);
    console.log("stateIndex", stateIndex);
    console.log("delta blocks", pt.blockBorrow.add(1).sub(pt.beforeBorrow.stateBlock).toString());
    console.log("borrowIndexClaimRewards", pt.borrowIndexClaimRewards);
    console.log("borrowBalanceStored", pt.beforeBorrow.borrowBalanceStored);

    const delta = BigNumber.from("32205071898991153");
    const deltab = BigNumber.from("10017490650148192751976");

    const borrowAmount = pt.borrowAmount.add(delta);
    totalBorrows = totalBorrows.add(deltab);

    const distributedPerToken = DForceHelper.rdiv(
      pt.beforeBorrow.distributionSpeed.mul(pt.blockBorrow.add(1).sub(pt.beforeBorrow.stateBlock))
      , totalBorrows
    );
    stateIndex = stateIndex.add(distributedPerToken);
    totalBorrows = totalBorrows.add(borrowAmount);

    return {
      accountBalance: this.rdiv(
        pt.beforeBorrow.borrowBalanceStored.add(borrowAmount),
        pt.borrowIndexClaimRewards
      ),
      stateIndex: stateIndex,
      distributionSpeed: pt.beforeBorrow.distributionSpeed,
      totalToken: this.getTotalTokenForBorrowCase(totalBorrows, pt.borrowIndexClaimRewards),
      accountIndex: stateIndex,
      stateBlock: pt.blockBorrow
    }
  }
//endregion Generate IRewardsStatePoint - borrow

//region Supply, borrow, repay
  public static async supply(
    user: SignerWithAddress,
    collateralToken: TokenDataTypes,
    collateralCToken: TokenDataTypes,
    collateralHolder: string,
    collateralAmount: BigNumber
  ) {
    console.log(`user ${user.address} supply ${collateralAmount.toString()}`);
    const comptroller = await DForceHelper.getController(user);
    const cTokenAsUser = IDForceCToken__factory.connect(collateralCToken.address, user);
    const tokenAsUser = IDForceCToken__factory.connect(collateralToken.address, user);

    // enter markets
    await comptroller.enterMarkets([collateralCToken.address]);

    // get collateral from the holder
    await collateralToken.token
      .connect(await DeployerUtils.startImpersonate(collateralHolder))
      .transfer(user.address, collateralAmount);
    console.log("User balance", await tokenAsUser.balanceOf(user.address));

    // supply the collateral
    await tokenAsUser.approve(
      collateralCToken.address
      , collateralAmount
    );
    await cTokenAsUser.mint(user.address, collateralAmount);
  }

  public static async borrow(
    user: SignerWithAddress,
    borrowCToken: TokenDataTypes,
    borrowAmount: BigNumber,
  ) {
    console.log(`user ${user.address} borrow ${borrowAmount.toString()}`);
    const comptroller = await DForceHelper.getController(user);
    const borrowCTokenAsUser = IDForceCToken__factory.connect(borrowCToken.address, user);

    // enter markets
    await comptroller.enterMarkets([borrowCToken.address]);

    // borrow
    await borrowCTokenAsUser.borrow(borrowAmount);
  }

  public static async repayAll(
    user: SignerWithAddress,
    borrowToken: TokenDataTypes,
    borrowCToken: TokenDataTypes,
    borrowHolder: string
  ) : Promise<BigNumber>{
    console.log(`user ${user.address} repay`);
    const borrowCTokenAsUser = IDForceCToken__factory.connect(borrowCToken.address, user);
    const borrowTokenAsUser = IDForceCToken__factory.connect(borrowToken.address, user);

    const amountToRepay = await borrowCTokenAsUser.borrowBalanceStored(user.address)
    const amountAvailable = await borrowTokenAsUser.balanceOf(user.address);

    console.log(`amountAvailable = ${amountAvailable.toString()} amountToRepay=${amountToRepay.toString()}`);

    await borrowToken.token
      .connect(await DeployerUtils.startImpersonate(borrowHolder))
      .transfer(user.address, amountToRepay.sub(amountAvailable));

    // repay amountToRepay
    await borrowTokenAsUser.approve(borrowCToken.address, amountToRepay);
    await borrowCTokenAsUser.repayBorrow(amountToRepay);

    const amountToRepayAfter = await borrowCTokenAsUser.borrowBalanceStored(user.address);
    console.log(`amountToRepay after repay = ${amountToRepayAfter.toString()}`);

    return amountToRepay;
  }
//endregion Supply, borrow, repay

}