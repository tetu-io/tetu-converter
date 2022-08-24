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
import {BigNumber, Signer} from "ethers";
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
        ? "" //iMatic doesn't support CErc20Storage and doesn't have underlying property
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
  public static async getRewardsForMarket(
    controller: IDForceController,
    rd: IDForceRewardDistributor,
    cToken: IDForceCToken,
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
      paused: await rd.paused()
    }
  }

  public static async getRewardsData(
    signer: SignerWithAddress,
    controller: IDForceController
  ) : Promise<string[]> {
    const rd = await DForceHelper.getRewardDistributor(controller, signer);
    const markets = await controller.getAlliTokens();

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
      "paused"
    ].join(","));

    for (const market of markets) {
      console.log(`Market ${market}`);

      const cToken = IDForceCToken__factory.connect(market, signer);

      const row = await DForceHelper.getRewardsForMarket(controller, rd, cToken);
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
        row.paused
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
//endregion Rewards

//region Rewards calculations
  /** See LendingContractsV2, RewardDistributorV3.sol, _updateDistributionState */
  public static calcDistributionState(
    block: BigNumber,
    supplyStateBlock: BigNumber,
    supplyStateIndex: BigNumber,
    supplySpeed: BigNumber,
    totalSupply: BigNumber,
  ) : BigNumber {
    // uint256 _totalDistributed = _speed.mul(_deltaBlocks);
    const totalDistributed = supplySpeed.mul(block.sub(supplyStateBlock));

    // uint256 _distributedPerToken = _totalToken > 0 ? _totalDistributed.rdiv(_totalToken) : 0;
    const totalToken = totalSupply;
    const distributedPerToken = totalToken.gt(0)
      ? this.rdiv(totalDistributed, totalToken)
      : BigNumber.from(0);

    // state.index = state.index.add(_distributedPerToken);
    return supplyStateIndex.add(distributedPerToken);
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

    return amount;
  }
//endregion Rewards calculations

//region Supply, borrow, repay
  public static async supply(
    user: SignerWithAddress,
    collateralToken: TokenDataTypes,
    collateralCToken: TokenDataTypes,
    collateralHolder: string,
    collateralAmount: BigNumber,
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
  ) {
    console.log(`user ${user.address} repay`);
    const comptroller = await DForceHelper.getController(user);
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
  }
//endregion Supply, borrow, repay

}