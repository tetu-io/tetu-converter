import {
  Borrower, BorrowManager__factory, Controller,
  DForcePlatformAdapter,
  DForcePoolAdapter, DForcePoolAdapter__factory,
  IDForceController, IDForceCToken, IDForceCToken__factory,
  IDForcePriceOracle, IERC20__factory, IERC20Extended__factory, IPoolAdapter__factory
} from "../../../../typechain";
import {BigNumber} from "ethers";
import {DForceHelper, IDForceMarketData} from "../../../../scripts/integration/helpers/DForceHelper";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {CoreContractsHelper} from "../../helpers/CoreContractsHelper";
import {MocksHelper} from "../../helpers/MocksHelper";
import {AdaptersHelper} from "../../helpers/AdaptersHelper";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {transferAndApprove} from "../../utils/transferUtils";
import {BalanceUtils} from "../../utils/BalanceUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {ethers} from "hardhat";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {IDForceCalcAccountEquityResults} from "../../apr/aprDForce";
import {DForceChangePriceUtils} from "./DForceChangePriceUtils";
import {IPoolAdapterStatus} from "../../types/BorrowRepayDataTypes";

//region Data types
export interface IPrepareToBorrowResults {
  userContract: Borrower;
  dfPoolAdapterTC: DForcePoolAdapter;
  dfPlatformAdapter: DForcePlatformAdapter;
  priceOracle: IDForcePriceOracle;
  comptroller: IDForceController;

  controller: Controller;

  /** Amount that can be borrowed according to the conversion plan */
  amountToBorrow: BigNumber;
  /** Actual amount that was used as collateral */
  collateralAmount: BigNumber;

  collateralCToken: IDForceCToken;
  borrowCToken: IDForceCToken;

  converterNormal: string;

  collateralToken: TokenDataTypes;
  borrowToken: TokenDataTypes;

  priceCollateral: BigNumber;
  priceBorrow: BigNumber;
}

export interface IMarketsInfo {
  borrowData: IDForceMarketData;
  collateralData: IDForceMarketData;

  priceCollateral: BigNumber;
  priceBorrow: BigNumber;
}

export interface IBorrowResults {
  accountLiquidity: IDForceCalcAccountEquityResults;
  userBalanceBorrowAsset: BigNumber;
  poolAdapterBalanceCollateralCToken: BigNumber;
  expectedLiquidity: BigNumber;
  borrowedAmount: BigNumber;
  marketsInfo: IMarketsInfo;
}

export interface IPrepareToLiquidationResults {
  collateralToken: TokenDataTypes;
  borrowToken: TokenDataTypes;
  collateralCToken: TokenDataTypes;
  borrowCToken: TokenDataTypes;
  collateralAmount: BigNumber;
  statusBeforeLiquidation: IPoolAdapterStatus;
  d: IPrepareToBorrowResults;
}

export interface ILiquidationResults {
  liquidatorAddress: string;
  collateralAmountReceivedByLiquidator: BigNumber;
}

//endregion Data types

export class DForceTestUtils {
  /**
   * Initialize TetuConverter app and DForce pool adapter.
   * Put the collateral amount on pool-adapter's balance.
   */
  public static async prepareToBorrow(
    deployer: SignerWithAddress,
    collateralToken: TokenDataTypes,
    collateralHolder: string,
    collateralCTokenAddress: string,
    collateralAmountRequired: BigNumber | undefined,
    borrowToken: TokenDataTypes,
    borrowCTokenAddress: string,
    targetHealthFactor2?: number
  ) : Promise<IPrepareToBorrowResults> {
    const periodInBlocks = 1000;

    // controller, dm, bm
    const controller = await CoreContractsHelper.createController(deployer);
    const tetuConverter = await CoreContractsHelper.createTetuConverter(deployer, controller);
    const debtMonitor = await CoreContractsHelper.createDebtMonitor(deployer, controller.address);
    // const borrowManager = await MocksHelper.createBorrowManagerStub(deployer, true);
    const borrowManager = await CoreContractsHelper.createBorrowManager(deployer, controller);
    await controller.setBorrowManager(borrowManager.address);
    await controller.setDebtMonitor(debtMonitor.address);
    await controller.setTetuConverter(tetuConverter.address);

    const userContract = await MocksHelper.deployBorrower(deployer.address, controller, periodInBlocks);

    const converterNormal = await AdaptersHelper.createDForcePoolAdapter(deployer);

    const comptroller = await DForceHelper.getController(deployer);
    const priceOracle = await DForceHelper.getPriceOracle(comptroller, deployer);

    const dfPlatformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
      deployer,
      controller.address,
      MaticAddresses.DFORCE_CONTROLLER,
      converterNormal.address,
      [collateralCTokenAddress, borrowCTokenAddress],
    );

    await borrowManager.addAssetPairs(
      dfPlatformAdapter.address,
      [collateralToken.address],
      [borrowToken.address]
    );
    const bmAsTc = BorrowManager__factory.connect(
      borrowManager.address,
      await DeployerUtils.startImpersonate(tetuConverter.address)
    );
    await bmAsTc.registerPoolAdapter(
      converterNormal.address,
      userContract.address,
      collateralToken.address,
      borrowToken.address
    );
    const dfPoolAdapterTC = DForcePoolAdapter__factory.connect(
      await borrowManager.getPoolAdapter(
        converterNormal.address,
        userContract.address,
        collateralToken.address,
        borrowToken.address
      ),
      await DeployerUtils.startImpersonate(tetuConverter.address)
    );

    // put collateral amount on user's balance
    const holderBalance = await collateralToken.token.balanceOf(collateralHolder);
    const collateralAmount = collateralAmountRequired && holderBalance.gt(collateralAmountRequired)
      ? collateralAmountRequired
      : holderBalance;

    // collateral asset
    await collateralToken.token
      .connect(await DeployerUtils.startImpersonate(collateralHolder))
      .transfer(userContract.address, collateralAmount);

    // calculate max allowed amount to borrow
    const countBlocks = 1;
    const plan = await dfPlatformAdapter.getConversionPlan(
      collateralToken.address,
      collateralAmount,
      borrowToken.address,
      targetHealthFactor2 || await controller.targetHealthFactor2(),
      countBlocks
    );
    console.log("plan", plan);

    return {
      controller,
      comptroller,
      dfPoolAdapterTC,
      dfPlatformAdapter,
      amountToBorrow: plan.amountToBorrow,
      userContract,
      priceOracle,
      collateralAmount,
      collateralCToken: IDForceCToken__factory.connect(collateralCTokenAddress, deployer),
      borrowCToken: IDForceCToken__factory.connect(borrowCTokenAddress, deployer),
      converterNormal: converterNormal.address,
      borrowToken,
      collateralToken,
      priceBorrow: await priceOracle.getUnderlyingPrice(borrowCTokenAddress),
      priceCollateral: await priceOracle.getUnderlyingPrice(collateralCTokenAddress)
    }
  }

  static async makeBorrow(
    deployer: SignerWithAddress,
    d: IPrepareToBorrowResults,
    borrowAmountRequired: BigNumber | undefined
  ) : Promise<IBorrowResults>{
    const borrowAmount = borrowAmountRequired
      ? borrowAmountRequired
      : d.amountToBorrow;

    await transferAndApprove(
      d.collateralToken.address,
      d.userContract.address,
      await d.controller.tetuConverter(),
      d.collateralAmount,
      d.dfPoolAdapterTC.address
    );
    await d.dfPoolAdapterTC.borrow(
      d.collateralAmount,
      borrowAmount,
      d.userContract.address
    );
    console.log(`borrow: success`);

    // get market's info afer borrowing
    const marketsInfo = await this.getMarketsInfo(
      deployer,
      d,
      d.collateralCToken.address,
      d.borrowCToken.address
    );

    // check results

    // https://developers.dforce.network/lend/lend-and-synth/controller#calcaccountequity
    // Collaterals and borrows represent the current collateral and borrow value is USD with 36 integer precision
    // which for example, 360000000000000000000000000000000000000000 indicates 360000 in USD.
    const accountLiquidity = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);

    const cTokenBorrow = await IDForceCToken__factory.connect(d.borrowCToken.address, deployer);
    const bBorrowBalance = await cTokenBorrow.borrowBalanceStored(d.dfPoolAdapterTC.address);
    const bTokenBalance = await cTokenBorrow.balanceOf(d.dfPoolAdapterTC.address);
    const bExchangeRateMantissa = await cTokenBorrow.exchangeRateStored();
    console.log(`Borrow token: balance=${bBorrowBalance} tokenBalance=${bTokenBalance} exchangeRate=${bExchangeRateMantissa}`);

    const cTokenCollateral = await IDForceCToken__factory.connect(d.collateralCToken.address, deployer);
    const cBorrowBalance = await cTokenCollateral.borrowBalanceStored(d.dfPoolAdapterTC.address);
    const cTokenBalance = await cTokenCollateral.balanceOf(d.dfPoolAdapterTC.address);
    const cExchangeRateMantissa = await cTokenCollateral.exchangeRateStored();
    console.log(`Collateral token: balance=${cBorrowBalance} tokenBalance=${cTokenBalance} exchangeRate=${cExchangeRateMantissa}`);

    const userBalanceBorrowAsset = await d.borrowToken.token.balanceOf(d.userContract.address);
    const poolAdapterBalanceCollateralCToken = await IERC20Extended__factory.connect(
      d.collateralCToken.address, deployer
    ).balanceOf(d.dfPoolAdapterTC.address);

    const expectedLiquidity = this.getExpectedLiquidity(
      marketsInfo.collateralData,
      marketsInfo.priceCollateral,
      marketsInfo.priceBorrow,
      cTokenBalance,
      bBorrowBalance
    )

    return {
      borrowedAmount: borrowAmount,
      userBalanceBorrowAsset,
      poolAdapterBalanceCollateralCToken,
      accountLiquidity,
      expectedLiquidity,
      marketsInfo
    }
  }

  static async getMarketsInfo(
    deployer: SignerWithAddress,
    d: IPrepareToBorrowResults,
    collateralCTokenAddress: string,
    borrowCTokenAddress: string
  ) : Promise<IMarketsInfo> {
    // tokens data
    const borrowData = await DForceHelper.getCTokenData(deployer, d.comptroller
      , IDForceCToken__factory.connect(borrowCTokenAddress, deployer)
    );
    const collateralData = await DForceHelper.getCTokenData(deployer, d.comptroller
      , IDForceCToken__factory.connect(collateralCTokenAddress, deployer)
    );

    // prices of assets in base currency
    // From sources: The underlying asset price mantissa (scaled by 1e18).
    // WRONG: The price of the asset in USD as an unsigned integer scaled up by 10 ^ (36 - underlying asset decimals).
    // WRONG: see https://compound.finance/docs/prices#price
    const priceCollateral = await d.priceOracle.getUnderlyingPrice(collateralCTokenAddress);
    const priceBorrow = await d.priceOracle.getUnderlyingPrice(borrowCTokenAddress);
    console.log("priceCollateral", priceCollateral);
    console.log("priceBorrow", priceBorrow);

    return {
      borrowData,
      collateralData,
      priceBorrow,
      priceCollateral
    }
  }

  /**
   *  ALl calculations are explained here:
   *  https://docs.google.com/spreadsheets/d/1oLeF7nlTefoN0_9RWCuNc62Y7W72-Yk7
   *  sheet: HundredFinance
   */
  static getExpectedLiquidity(
    collateralData: IDForceMarketData,
    priceCollateral: BigNumber,
    priceBorrow: BigNumber,
    cTokenBalance: BigNumber,
    bBorrowBalance: BigNumber
  ): BigNumber {

    const cf1 = collateralData.collateralFactorMantissa;
    const er1 = collateralData.exchangeRateStored;
    const pr1 = priceCollateral;
    const sc1 = cTokenBalance.mul(cf1).mul(er1).div(Misc.WEI).mul(pr1).div(Misc.WEI);
    const sb1 = priceBorrow.mul(bBorrowBalance);
    const expectedLiquiditiy = sc1.sub(sb1);
    console.log(`cf1=${cf1} er1=${er1} pr1=${pr1} sc1=${sc1} sb1=${sb1} L1=${expectedLiquiditiy}`);
    console.log("health factor", ethers.utils.formatUnits(sc1.mul(Misc.WEI).div(sb1)));
    return expectedLiquiditiy;
  }

  public static async makeRepay(
    d: IPrepareToBorrowResults,
    amountToRepay?: BigNumber
  ) {
    if (amountToRepay) {
      // partial repay
      const tetuConverter = await d.controller.tetuConverter();
      const poolAdapterAsCaller = IPoolAdapter__factory.connect(
        d.dfPoolAdapterTC.address,
        await DeployerUtils.startImpersonate(tetuConverter)
      );

      await transferAndApprove(
        d.borrowToken.address,
        d.userContract.address,
        tetuConverter,
        amountToRepay,
        d.dfPoolAdapterTC.address
      );

      await poolAdapterAsCaller.repay(
        amountToRepay,
        d.userContract.address,
        false
      );
    } else {
      // make full repayment
      await d.userContract.makeRepayComplete(
        d.collateralToken.address,
        d.borrowToken.address,
        d.userContract.address
      );
    }
  }

  public static async prepareToLiquidation(
    deployer: SignerWithAddress,
    collateralAsset: string,
    collateralHolder: string,
    collateralCTokenAddress: string,
    collateralAmountNum: number,
    borrowAsset: string,
    borrowCTokenAddress: string,
    changePriceFactor: number = 10
  ) : Promise<IPrepareToLiquidationResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
    const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
    const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

    const collateralAmount = getBigNumberFrom(collateralAmountNum, collateralToken.decimals);

    // set up our own price oracle
    // we should do it before creation of the pool adapter
    const priceOracleMock = await DForceChangePriceUtils.setupPriceOracleMock(deployer);
    console.log("priceOracleMock", priceOracleMock.address);

    const d = await DForceTestUtils.prepareToBorrow(deployer,
      collateralToken,
      collateralHolder,
      collateralCTokenAddress,
      collateralAmount,
      borrowToken,
      borrowCTokenAddress,
      200,
    );
    // make a borrow
    await DForceTestUtils.makeBorrow(deployer, d, undefined);
    const statusAfterBorrow = await d.dfPoolAdapterTC.getStatus();
    console.log("statusAfterBorrow", statusAfterBorrow);

    // reduce price of collateral to reduce health factor below 1

    console.log("DForceChangePriceUtils.changeCTokenPrice");
    await DForceChangePriceUtils.changeCTokenPrice(
      priceOracleMock,
      deployer,
      collateralCTokenAddress,
      false,
      changePriceFactor
    );

    const statusBeforeLiquidation = await d.dfPoolAdapterTC.getStatus();
    console.log("statusBeforeLiquidation", statusBeforeLiquidation);
    return {
      collateralToken,
      borrowToken,
      collateralCToken,
      borrowCToken,
      collateralAmount,
      statusBeforeLiquidation,
      d
    };
  }

  public static async makeLiquidation(
    deployer: SignerWithAddress,
    d: IPrepareToBorrowResults,
    borrowHolder: string
  ) : Promise<ILiquidationResults> {
    const MAX_UINT_AMOUNT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    const liquidatorAddress = ethers.Wallet.createRandom().address;

    const liquidator = await DeployerUtils.startImpersonate(liquidatorAddress);
    const borrowerAddress = d.dfPoolAdapterTC.address;

    const borrowCTokenAsLiquidator = IDForceCToken__factory.connect(d.borrowCToken.address, liquidator);
    const collateralCTokenAsLiquidator = IDForceCToken__factory.connect(d.collateralCToken.address, liquidator);
    const accountBefore = await d.comptroller.calcAccountEquity(borrowerAddress);
    const borrowPrice = await d.priceOracle.getUnderlyingPrice(d.borrowCToken.address);
    const borrowDebt = d.amountToBorrow.div(10); // accountBefore.shortfall.mul(borrowPrice).div(Misc.WEI);
    console.log("borrowed amount", d.amountToBorrow);
    console.log("debt", borrowDebt);

    await BalanceUtils.getAmountFromHolder(d.borrowToken.address, borrowHolder, liquidatorAddress, borrowDebt);
    await IERC20__factory.connect(d.borrowToken.address, liquidator).approve(borrowCTokenAsLiquidator.address, MAX_UINT_AMOUNT);

    console.log("Before liquidation, user account", accountBefore);
    console.log("User collateral before liquidation, collateral token", await d.collateralCToken.balanceOf(d.dfPoolAdapterTC.address));
    console.log("User borrow before liquidation, borrow token", await d.borrowCToken.balanceOf(d.dfPoolAdapterTC.address));
    console.log("Liquidator collateral before liquidation, collateral token", await d.collateralCToken.balanceOf(liquidatorAddress));
    console.log("Liquidator borrow before liquidation, borrow token", await d.borrowCToken.balanceOf(liquidatorAddress));

    await borrowCTokenAsLiquidator.callStatic.liquidateBorrow(
      borrowerAddress,
      borrowDebt,
      d.collateralCToken.address
    );

    await borrowCTokenAsLiquidator.liquidateBorrow(
      borrowerAddress,
      borrowDebt,
      d.collateralCToken.address
    );

    const accountAfter = await d.comptroller.calcAccountEquity(borrowerAddress);
    console.log("After liquidation, user account", accountAfter);
    console.log("User collateral after liquidation, collateral token", await d.collateralCToken.balanceOf(d.dfPoolAdapterTC.address));
    console.log("User borrow after liquidation, borrow token", await d.borrowCToken.balanceOf(d.dfPoolAdapterTC.address));
    const liquidatorCollateralSnapshotAfterLiquidation = await d.collateralCToken.balanceOf(liquidatorAddress);
    console.log("Liquidator collateral after liquidation, collateral token", liquidatorCollateralSnapshotAfterLiquidation);
    console.log("Liquidator borrow after liquidation, borrow token", await d.borrowCToken.balanceOf(liquidatorAddress));


    await collateralCTokenAsLiquidator.redeem(liquidatorAddress, liquidatorCollateralSnapshotAfterLiquidation);
    const collateralAmountReceivedByLiquidator = await IERC20__factory.connect(d.collateralToken.address, deployer).balanceOf(liquidatorAddress);

    return {
      liquidatorAddress,
      collateralAmountReceivedByLiquidator
    }
  }
}