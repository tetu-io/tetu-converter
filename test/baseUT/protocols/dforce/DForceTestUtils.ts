import {
  Borrower, BorrowManager__factory, ConverterController, DForceControllerMock,
  DForcePlatformAdapter,
  DForcePoolAdapter, DForcePoolAdapter__factory,
  IDForceController, IDForceCToken, IDForceCToken__factory,
  IDForcePriceOracle, IERC20__factory, IERC20Metadata__factory, IPoolAdapter__factory
} from "../../../../typechain";
import {BigNumber} from "ethers";
import {DForceHelper, IDForceMarketData} from "../../../../scripts/integration/helpers/DForceHelper";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {MocksHelper} from "../../helpers/MocksHelper";
import {AdaptersHelper} from "../../helpers/AdaptersHelper";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {makeInfinityApprove, transferAndApprove} from "../../utils/transferUtils";
import {BalanceUtils} from "../../utils/BalanceUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {ethers} from "hardhat";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {IDForceCalcAccountEquityResults} from "../../apr/aprDForce";
import {DForceChangePriceUtils} from "./DForceChangePriceUtils";
import {IPoolAdapterStatus} from "../../types/BorrowRepayDataTypes";
import {TetuConverterApp} from "../../helpers/TetuConverterApp";
import {IAaveTwoUserAccountDataResults} from "../../apr/aprAaveTwo";
import {GAS_LIMIT} from "../../GasLimit";
import {AppDataTypes} from "../../../../typechain/contracts/protocols/dforce/DForcePlatformAdapter";
import {IConversionPlan} from "../../apr/aprDataTypes";

//region Data types
export interface IPrepareToBorrowResults {
  userContract: Borrower;
  dfPoolAdapterTC: DForcePoolAdapter;
  dfPlatformAdapter: DForcePlatformAdapter;
  priceOracle: IDForcePriceOracle;
  comptroller: IDForceController;

  controller: ConverterController;

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

  plan: IConversionPlan;
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

export interface IMakeBorrowOrRepayBadPathsParams {
  makeOperationAsNotTc?: boolean;
  useDForceControllerMock?: DForceControllerMock;
  receiver?: string;
}

export interface IDForcePoolAdapterState {
  status: IPoolAdapterStatus;
  collateralBalanceBase: BigNumber;
  accountLiquidity: IDForceCalcAccountEquityResults;
  accountCollateralTokenBalance: BigNumber;
  accountBorrowTokenBalance: BigNumber;
}

export interface IInitialBorrowResults {
  d: IPrepareToBorrowResults;
  collateralToken: TokenDataTypes;
  borrowToken: TokenDataTypes;
  collateralAmount: BigNumber;
  stateAfterBorrow: IDForcePoolAdapterState;
}

export interface IPrepareBorrowBadPathsParams {
  targetHealthFactor2?: number;
  useDForceControllerMock?: DForceControllerMock;
}

interface IMakeRepayResults {
  userAccountData: IDForceCalcAccountEquityResults;
  repayResultsCollateralAmountOut: BigNumber;
  repayResultsReturnedBorrowAmountOut?: BigNumber;
}
//endregion Data types

export class DForceTestUtils {
  /**
   * Initialize TetuConverter app and DForce pool adapter.
   * Put the collateral amount on pool-adapter's balance.
   */
  public static async prepareToBorrow(
    deployer: SignerWithAddress,
    controller: ConverterController,
    collateralToken: TokenDataTypes,
    collateralHolder: string,
    collateralCTokenAddress: string,
    collateralAmountRequired: BigNumber | undefined,
    borrowToken: TokenDataTypes,
    borrowCTokenAddress: string,
    badPathsParams?: IPrepareBorrowBadPathsParams
  ) : Promise<IPrepareToBorrowResults> {
    const periodInBlocks = 1000;

    const userContract = await MocksHelper.deployBorrower(deployer.address, controller, periodInBlocks);
    await controller.connect(await DeployerUtils.startImpersonate(await controller.governance())).setWhitelistValues([userContract.address], true);


    const converterNormal = await AdaptersHelper.createDForcePoolAdapter(deployer);

    const comptroller = badPathsParams?.useDForceControllerMock
      ? badPathsParams.useDForceControllerMock
      : await DForceHelper.getController(deployer);
    if (badPathsParams?.useDForceControllerMock) {
      // we need to provide prices for mocked cTokens - exactly the same as prices for real cTokens
      const priceOracleMocked = await DForceChangePriceUtils.setupPriceOracleMock(deployer);
      await priceOracleMocked.setUnderlyingPrice(
        await badPathsParams?.useDForceControllerMock.mockedCollateralCToken(),
        await priceOracleMocked.getUnderlyingPrice(await badPathsParams?.useDForceControllerMock.collateralCToken())
      );
      await priceOracleMocked.setUnderlyingPrice(
        await badPathsParams?.useDForceControllerMock.mockedBorrowCToken(),
        await priceOracleMocked.getUnderlyingPrice(await badPathsParams?.useDForceControllerMock.borrowCToken())
      );
    }
    const priceOracle = await DForceHelper.getPriceOracle(comptroller, deployer);

    const dfPlatformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
      deployer,
      controller.address,
      badPathsParams?.useDForceControllerMock
        ? badPathsParams?.useDForceControllerMock.address
        : MaticAddresses.DFORCE_CONTROLLER,
      converterNormal.address,
      [collateralCTokenAddress, borrowCTokenAddress],
    );

    const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
    await borrowManager.addAssetPairs(
      dfPlatformAdapter.address,
      [collateralToken.address],
      [borrowToken.address]
    );

    const bmAsTc = borrowManager.connect(await DeployerUtils.startImpersonate(await controller.tetuConverter()));
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
      await DeployerUtils.startImpersonate(await controller.tetuConverter())
    );

    // TetuConverter gives infinity approve to the pool adapter after pool adapter creation (see TetuConverter.convert implementation)
    await makeInfinityApprove(
      await controller.tetuConverter(),
      dfPoolAdapterTC.address,
      collateralToken.address,
      borrowToken.address
    );

    // put collateral amount on user's balance
    const holderBalance = await collateralToken.token.balanceOf(collateralHolder);
    const collateralAmount = collateralAmountRequired && holderBalance.gt(collateralAmountRequired)
      ? collateralAmountRequired
      : holderBalance;

    // calculate max allowed amount to borrow
    const countBlocks = 1;
    const plan = await dfPlatformAdapter.getConversionPlan(
      {
        collateralAsset: collateralToken.address,
        amountIn: collateralAmount,
        borrowAsset: borrowToken.address,
        countBlocks,
        entryData: "0x",
        user: userContract.address
      },
      badPathsParams?.targetHealthFactor2 || await controller.targetHealthFactor2(),
      {gasLimit: GAS_LIMIT}
    );
    console.log("plan", plan);

    // collateral asset
    await collateralToken.token
      .connect(await DeployerUtils.startImpersonate(collateralHolder))
      .transfer(userContract.address, plan.collateralAmount);

    return {
      controller,
      comptroller,
      dfPoolAdapterTC,
      dfPlatformAdapter,
      amountToBorrow: plan.amountToBorrow,
      userContract,
      priceOracle,
      collateralAmount: plan.collateralAmount,
      collateralCToken: IDForceCToken__factory.connect(collateralCTokenAddress, deployer),
      borrowCToken: IDForceCToken__factory.connect(borrowCTokenAddress, deployer),
      converterNormal: converterNormal.address,
      borrowToken,
      collateralToken,
      priceBorrow: await priceOracle.getUnderlyingPrice(borrowCTokenAddress),
      priceCollateral: await priceOracle.getUnderlyingPrice(collateralCTokenAddress),
      plan
    }
  }

  static async makeBorrow(
    deployer: SignerWithAddress,
    d: IPrepareToBorrowResults,
    borrowAmountRequired: BigNumber | undefined,
    badPathsParams?: IMakeBorrowOrRepayBadPathsParams
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
    const borrower = badPathsParams?.makeOperationAsNotTc
      ? DForcePoolAdapter__factory.connect(d.dfPoolAdapterTC.address,
        await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
      )
      : d.dfPoolAdapterTC;

    await borrower.borrow(d.collateralAmount, borrowAmount, d.userContract.address, {gasLimit: GAS_LIMIT});
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
    const poolAdapterBalanceCollateralCToken = await IERC20Metadata__factory.connect(
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
    amountToRepay?: BigNumber,
    closePosition?: boolean,
    badPathsParams?: IMakeBorrowOrRepayBadPathsParams
  ) : Promise<IMakeRepayResults> {
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

      const payer = badPathsParams?.makeOperationAsNotTc
        ? DForcePoolAdapter__factory.connect(
            d.dfPoolAdapterTC.address,
            await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
          )
        : poolAdapterAsCaller;


      const repayResultsCollateralAmountOut = await payer.callStatic.repay(
        amountToRepay,
        badPathsParams?.receiver || d.userContract.address,
        closePosition === undefined ? false : closePosition,
        {gasLimit: GAS_LIMIT}
      );

      await payer.repay(
        amountToRepay,
        badPathsParams?.receiver || d.userContract.address,
        closePosition === undefined ? false : closePosition,
        {gasLimit: GAS_LIMIT}
      );

      return {
        userAccountData: await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address),
        repayResultsCollateralAmountOut,
      };
    } else {
      // make full repayment
      await d.userContract.makeRepayComplete(
        d.collateralToken.address,
        d.borrowToken.address,
        d.userContract.address
      );
      const repayResults = await d.userContract.repayResults();
      return {
        userAccountData: await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address),
        repayResultsCollateralAmountOut: repayResults.collateralAmountOut,
        repayResultsReturnedBorrowAmountOut: repayResults.returnedBorrowAmountOut
      };
    }
  }

  public static async prepareToLiquidation(
    deployer: SignerWithAddress,
    controller: ConverterController,
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

    const d = await DForceTestUtils.prepareToBorrow(
      deployer,
      controller,
      collateralToken,
      collateralHolder,
      collateralCTokenAddress,
      collateralAmount,
      borrowToken,
      borrowCTokenAddress,
      {targetHealthFactor2: 200},
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
    await IERC20__factory.connect(d.borrowToken.address, liquidator).approve(borrowCTokenAsLiquidator.address, Misc.MAX_UINT);

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

  public static async getState(d: IPrepareToBorrowResults) : Promise<IDForcePoolAdapterState> {
    const status = await d.dfPoolAdapterTC.getStatus();
    const collateralBalanceBase = await d.dfPoolAdapterTC.collateralTokensBalance();
    const accountLiquidity = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
    const accountCollateralTokenBalance = await d.collateralCToken.balanceOf(d.dfPoolAdapterTC.address);
    const accountBorrowTokenBalance = await d.borrowCToken.balanceOf(d.dfPoolAdapterTC.address);
    return {
      status,
      collateralBalanceBase,
      accountLiquidity,
      accountCollateralTokenBalance,
      accountBorrowTokenBalance
    };
  }

  public static async putCollateralAmountOnUserBalance(init: IInitialBorrowResults, collateralHolder: string) {
    await BalanceUtils.getRequiredAmountFromHolders(
      init.collateralAmount,
      init.collateralToken.token,
      [collateralHolder],
      init.d.userContract.address
    );
  }
  public static async putDoubleBorrowAmountOnUserBalance(d: IPrepareToBorrowResults, borrowHolder: string) {
    await BalanceUtils.getRequiredAmountFromHolders(
      d.amountToBorrow.mul(2),
      d.borrowToken.token,
      [borrowHolder],
      d.userContract.address
    );
  }
}
