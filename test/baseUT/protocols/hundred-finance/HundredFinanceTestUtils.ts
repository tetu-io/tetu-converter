import {
  Borrower,
  BorrowManager__factory,
  ConverterController, HfComptrollerMock,
  HfPlatformAdapter,
  HfPoolAdapter,
  HfPoolAdapter__factory,
  IERC20__factory,
  IERC20Metadata__factory,
  IHfComptroller,
  IHfCToken,
  IHfCToken__factory,
  IHfPriceOracle, IHfPriceOracle__factory,
  IPoolAdapter__factory
} from "../../../../typechain";
import {BigNumber} from "ethers";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Misc} from "../../../../scripts/utils/Misc";
import {ethers} from "hardhat";
import {
  HundredFinanceHelper,
  IHundredFinanceMarketData
} from "../../../../scripts/integration/hundred-finance/HundredFinanceHelper";
import {makeInfinityApprove, transferAndApprove} from "../../utils/transferUtils";
import {BalanceUtils} from "../../utils/BalanceUtils";
import {IHfAccountLiquidity, IHundredFinanceAccountSnapshot} from "./aprHundredFinance";
import {HundredFinanceChangePriceUtils} from "./HundredFinanceChangePriceUtils";
import {IPoolAdapterStatus} from "../../types/BorrowRepayDataTypes";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {GAS_LIMIT} from "../../types/GasLimit";
import {IConversionPlan} from "../../types/AppDataTypes";
import {TetuConverterApp} from "../../app/TetuConverterApp";
import {MocksHelper} from "../../app/MocksHelper";
import {AdaptersHelper} from "../../app/AdaptersHelper";

//region Data types
export interface IPrepareToBorrowResults {
  userContract: Borrower;
  hfPoolAdapterTC: HfPoolAdapter;
  hfPlatformAdapter: HfPlatformAdapter;
  priceOracle: IHfPriceOracle;
  comptroller: IHfComptroller;

  controller: ConverterController;

  /** Amount that can be borrowed according to the conversion plan */
  amountToBorrow: BigNumber;
  /** Actual amount that was used as collateral */
  collateralAmount: BigNumber;

  collateralCToken: IHfCToken;
  borrowCToken: IHfCToken;

  converterNormal: string;

  collateralToken: TokenDataTypes;
  borrowToken: TokenDataTypes;

  priceCollateral: BigNumber;
  priceBorrow: BigNumber;

  plan: IConversionPlan;
}

export interface IMarketsInfo {
  borrowData: IHundredFinanceMarketData;
  collateralData: IHundredFinanceMarketData;

  priceCollateral: BigNumber;
  priceBorrow: BigNumber;
}

export interface IBorrowResults {
  accountLiquidity: IHfAccountLiquidity;
  userBalanceBorrowAsset: BigNumber;
  poolAdapterBalanceCollateralCToken: BigNumber;
  expectedLiquidity: BigNumber;
  borrowedAmount: BigNumber;
  marketsInfo: IMarketsInfo;
}

export interface ILiquidationResults {
  liquidatorAddress: string;
  collateralAmountReceivedByLiquidator: BigNumber;
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

export interface IMakeBorrowOrRepayBadPathsParams {
  makeOperationAsNotTc?: boolean;
  useHfComptrollerMock?: HfComptrollerMock;
}

export interface IHundredFinancePoolAdapterState {
  status: IPoolAdapterStatus;
  collateralBalanceBase: BigNumber;
  accountLiquidity: IHfAccountLiquidity;
  accountSnapshotCollateral: IHundredFinanceAccountSnapshot;
  accountSnapshotBorrow: IHundredFinanceAccountSnapshot;
}

export interface IInitialBorrowResults {
  d: IPrepareToBorrowResults;
  collateralToken: TokenDataTypes;
  borrowToken: TokenDataTypes;
  collateralAmount: BigNumber;
  stateAfterBorrow: IHundredFinancePoolAdapterState;
}

export interface IPrepareBorrowBadPathsParams {
  targetHealthFactor2?: number;
  useHfComptrollerMock?: HfComptrollerMock;
}

interface IMakeRepayResults {
  userAccountData: IHfAccountLiquidity;
  repayResultsCollateralAmountOut: BigNumber;
  repayResultsReturnedBorrowAmountOut?: BigNumber;
}
//endregion Data types

export class HundredFinanceTestUtils {
  /**
   * Initialize TetuConverter app and HundredFinance pool adapter.
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
    badPathsParams?: IPrepareBorrowBadPathsParams,
  ) : Promise<IPrepareToBorrowResults> {
    const periodInBlocks = 1000;

    // controller, dm, bm
    const controller = await TetuConverterApp.createController(deployer);
    const userContract = await MocksHelper.deployBorrower(deployer.address, controller, periodInBlocks);
    await controller.connect(await DeployerUtils.startImpersonate(await controller.governance())).setWhitelistValues([userContract.address], true);

    const converter = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);

    const comptroller = badPathsParams?.useHfComptrollerMock
      ? badPathsParams.useHfComptrollerMock
      : await HundredFinanceHelper.getComptroller(deployer);
    console.log("Comptroller", comptroller.address);
    if (badPathsParams?.useHfComptrollerMock) {
      // we need to provide prices for mocked cTokens - exactly the same as prices for real cTokens
      const priceOracleMocked = await HundredFinanceChangePriceUtils.setupPriceOracleMock(deployer);
      const collateralCToken: string = await badPathsParams?.useHfComptrollerMock.collateralCToken();
      const mockedCollateralCToken = await badPathsParams?.useHfComptrollerMock.mockedCollateralCToken();
      await priceOracleMocked.setUnderlyingPrice(
        mockedCollateralCToken,
        await priceOracleMocked.getUnderlyingPrice(collateralCToken)
      );
      await priceOracleMocked.setUnderlyingPrice(
        await badPathsParams?.useHfComptrollerMock.mockedBorrowCToken(),
        await priceOracleMocked.getUnderlyingPrice(await badPathsParams?.useHfComptrollerMock.borrowCToken())
      );
    }
    const priceOracle = IHfPriceOracle__factory.connect(await comptroller.oracle(), deployer);

    const hfPlatformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
      deployer,
      controller.address,
      comptroller.address,
      converter.address,
      [collateralCTokenAddress, borrowCTokenAddress],
    );

    const borrowManager = BorrowManager__factory.connect(
      await controller.borrowManager(),
      deployer
    );
    await borrowManager.addAssetPairs(
      hfPlatformAdapter.address,
      [collateralToken.address],
      [borrowToken.address]
    );
    const bmAsTc = BorrowManager__factory.connect(
      borrowManager.address,
      await DeployerUtils.startImpersonate(await controller.tetuConverter())
    );
    await bmAsTc.registerPoolAdapter(
      converter.address,
      userContract.address,
      collateralToken.address,
      borrowToken.address
    );
    const hfPoolAdapterTC = HfPoolAdapter__factory.connect(
      await borrowManager.getPoolAdapter(
        converter.address,
        userContract.address,
        collateralToken.address,
        borrowToken.address
      ),
      await DeployerUtils.startImpersonate(await controller.tetuConverter())
    );
    // TetuConverter gives infinity approve to the pool adapter after pool adapter creation (see TetuConverter.convert implementation)
    await makeInfinityApprove(
      await controller.tetuConverter(),
      hfPoolAdapterTC.address,
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
    const plan: IConversionPlan = await hfPlatformAdapter.getConversionPlan(
      {
        collateralAsset: collateralToken.address,
        amountIn: collateralAmount,
        borrowAsset: borrowToken.address,
        countBlocks,
        entryData: "0x",
      },
      badPathsParams?.targetHealthFactor2 || await controller.targetHealthFactor2(),
      {gasLimit: GAS_LIMIT}
    );
    console.log("plan", plan);

    await collateralToken.token
      .connect(await DeployerUtils.startImpersonate(collateralHolder))
      .transfer(userContract.address, plan.collateralAmount);

    const priceCollateral = await priceOracle.getUnderlyingPrice(collateralCTokenAddress);
    const priceBorrow = await priceOracle.getUnderlyingPrice(borrowCTokenAddress);

    return {
      controller,
      userContract,
      amountToBorrow: plan.amountToBorrow,
      comptroller,
      hfPlatformAdapter,
      hfPoolAdapterTC,
      priceOracle,
      collateralAmount: plan.collateralAmount,
      collateralCToken: IHfCToken__factory.connect(collateralCTokenAddress, deployer),
      borrowCToken: IHfCToken__factory.connect(borrowCTokenAddress, deployer),
      converterNormal: converter.address,
      borrowToken,
      collateralToken,
      priceBorrow,
      priceCollateral,
      plan
    }
  }

  public static async getMarketsInfo(
    deployer: SignerWithAddress,
    d: IPrepareToBorrowResults,
    collateralCTokenAddress: string,
    borrowCTokenAddress: string
  ) : Promise<IMarketsInfo> {
    // tokens data
    const borrowData = await HundredFinanceHelper.getCTokenData(deployer, d.comptroller
      , IHfCToken__factory.connect(borrowCTokenAddress, deployer)
    );
    const collateralData = await HundredFinanceHelper.getCTokenData(deployer, d.comptroller
      , IHfCToken__factory.connect(collateralCTokenAddress, deployer)
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
  public static getExpectedLiquidity(
    collateralData: IHundredFinanceMarketData,
    priceCollateral: BigNumber,
    priceBorrow: BigNumber,
    cTokenBalance: BigNumber,
    bBorrowBalance: BigNumber
  ): BigNumber {
    const cf1 = collateralData.collateralFactorMantissa;
    const er1 = collateralData.exchangeRateStored;
    const pr1 = priceCollateral;
    const sc1 = cTokenBalance.mul(cf1).mul(er1).div(Misc.WEI).mul(pr1).div(Misc.WEI).div(Misc.WEI);
    const sb1 = priceBorrow.mul(bBorrowBalance).div(Misc.WEI);
    const expectedLiquiditiy = sc1.sub(sb1);
    console.log(`cf1=${cf1} er1=${er1} pr1=${pr1} sc1=${sc1} sb1=${sb1} L1=${expectedLiquiditiy}`);
    console.log("health factor", ethers.utils.formatUnits(sc1.mul(Misc.WEI).div(sb1)));
    return expectedLiquiditiy;
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
      d.hfPoolAdapterTC.address
    );
    const borrower = badPathsParams?.makeOperationAsNotTc
      ? HfPoolAdapter__factory.connect(d.hfPoolAdapterTC.address,
        await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
      )
      : d.hfPoolAdapterTC;
    await borrower.borrow(d.collateralAmount, borrowAmount, d.userContract.address, {gasLimit: GAS_LIMIT});
    console.log(`borrow: success`);

    const marketsInfo = await HundredFinanceTestUtils.getMarketsInfo(deployer,
      d,
      d.collateralCToken.address,
      d.borrowCToken.address
    );

    // check results
    const accountLiquidity = await d.comptroller.getAccountLiquidity(d.hfPoolAdapterTC.address);
    const sb = await IHfCToken__factory.connect(d.borrowCToken.address, deployer)
      .getAccountSnapshot(d.hfPoolAdapterTC.address);
    console.log(`Borrow token: balance=${sb.borrowBalance} tokenBalance=${sb.tokenBalance} exchangeRate=${sb.exchangeRateMantissa}`);
    const sc = await IHfCToken__factory.connect(d.collateralCToken.address, deployer)
      .getAccountSnapshot(d.hfPoolAdapterTC.address);
    console.log(`Collateral token: balance=${sc.borrowBalance} tokenBalance=${sc.tokenBalance} exchangeRate=${sc.exchangeRateMantissa}`);

    const userBalanceBorrowAsset = await d.borrowToken.token.balanceOf(d.userContract.address);
    const poolAdapterBalanceCollateralCToken = await IERC20Metadata__factory.connect(
      d.collateralCToken.address, deployer
    ).balanceOf(d.hfPoolAdapterTC.address);

    const expectedLiquidity = HundredFinanceTestUtils.getExpectedLiquidity(
      marketsInfo.collateralData,
      marketsInfo.priceCollateral,
      marketsInfo.priceBorrow,
      sc.tokenBalance,
      sb.borrowBalance
    );

    return {
      borrowedAmount: borrowAmount,
      userBalanceBorrowAsset,
      poolAdapterBalanceCollateralCToken,
      accountLiquidity,
      expectedLiquidity,
      marketsInfo
    }
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
        d.hfPoolAdapterTC.address,
        await DeployerUtils.startImpersonate(tetuConverter)
      );

      await transferAndApprove(
        d.borrowToken.address,
        d.userContract.address,
        tetuConverter,
        amountToRepay,
        d.hfPoolAdapterTC.address
      );

      const payer = badPathsParams?.makeOperationAsNotTc
        ? HfPoolAdapter__factory.connect(
          d.hfPoolAdapterTC.address,
          await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
        )
        : poolAdapterAsCaller;

      const repayResultsCollateralAmountOut = await payer.callStatic.repay(
        amountToRepay,
        d.userContract.address,
        closePosition === undefined ? false : closePosition,
        {gasLimit: GAS_LIMIT}
      );
      await payer.repay(
        amountToRepay,
        d.userContract.address,
        closePosition === undefined ? false : closePosition,
        {gasLimit: GAS_LIMIT}
      );
      return {
        userAccountData: await d.comptroller.getAccountLiquidity(d.userContract.address),
        repayResultsCollateralAmountOut,
      }
    } else {
      // make full repayment
      await d.userContract.callStatic.makeRepayComplete(
        d.collateralToken.address,
        d.borrowToken.address,
        d.userContract.address
      );
      await d.userContract.makeRepayComplete(
        d.collateralToken.address,
        d.borrowToken.address,
        d.userContract.address
      );
      const repayResults = await d.userContract.repayResults();
      return {
        userAccountData: await d.comptroller.getAccountLiquidity(d.userContract.address),
        repayResultsCollateralAmountOut: repayResults.collateralAmountOut,
        repayResultsReturnedBorrowAmountOut: repayResults.returnedBorrowAmountOut
      }
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
    const priceOracleMock = await HundredFinanceChangePriceUtils.setupPriceOracleMock(deployer);
    console.log("priceOracleMock", priceOracleMock.address);

    const d = await HundredFinanceTestUtils.prepareToBorrow(deployer,
      collateralToken,
      collateralHolder,
      collateralCTokenAddress,
      collateralAmount,
      borrowToken,
      borrowCTokenAddress,
      {targetHealthFactor2: 200},
    );
    // make a borrow
    await HundredFinanceTestUtils.makeBorrow(deployer, d, undefined);
    const statusAfterBorrow = await d.hfPoolAdapterTC.getStatus();
    console.log("statusAfterBorrow", statusAfterBorrow);

    // reduce price of collateral to reduce health factor below 1

    console.log("HundredFinanceChangePriceUtils.changeCTokenPrice");
    await HundredFinanceChangePriceUtils.changeCTokenPrice(
      priceOracleMock,
      deployer,
      collateralCTokenAddress,
      false,
      changePriceFactor
    );

    const statusBeforeLiquidation = await d.hfPoolAdapterTC.getStatus();
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
    borrowHolder: string,
    amountDivider: number = 5
  ) : Promise<ILiquidationResults> {
    const liquidatorAddress = ethers.Wallet.createRandom().address;

    const liquidator = await DeployerUtils.startImpersonate(liquidatorAddress);
    const borrowerAddress = d.hfPoolAdapterTC.address;

    const borrowCTokenAsLiquidator = IHfCToken__factory.connect(d.borrowCToken.address, liquidator);
    const collateralCTokenAsLiquidator = IHfCToken__factory.connect(d.collateralCToken.address, liquidator);
    const accountBefore = await d.comptroller.getAccountLiquidity(borrowerAddress);
    // https://docs.hundred.finance/developers/liquidation
    // Collateral factor CF (also known as Liquidation threshold),
    // Close ratio set to 50%, means the liquidator can only pay 50% of the debt in a single transaction,
    // Liquidation bonus set to 108%, means the liquidator can purchase the collateral at a 8% discount.
    const borrowDebt = d.amountToBorrow.div(amountDivider); // accountBefore.shortfall.mul(parseUnits("1", d.borrowToken.decimals)).div(borrowPrice).div(3);
    console.log("borrowed amount", d.amountToBorrow);
    console.log("debt", borrowDebt);

    await BalanceUtils.getAmountFromHolder(d.borrowToken.address, borrowHolder, liquidatorAddress, borrowDebt);
    await IERC20__factory.connect(d.borrowToken.address, liquidator).approve(borrowCTokenAsLiquidator.address, Misc.MAX_UINT);

    console.log("Before liquidation, user account", accountBefore);
    console.log("User collateral before liquidation, collateral token", await d.collateralCToken.getAccountSnapshot(d.hfPoolAdapterTC.address));
    console.log("User borrow before liquidation, collateral token", await d.borrowCToken.getAccountSnapshot(d.hfPoolAdapterTC.address));
    console.log("Liquidator collateral before liquidation, collateral token", await d.collateralCToken.getAccountSnapshot(liquidatorAddress));
    console.log("Liquidator borrow before liquidation, collateral token", await d.borrowCToken.getAccountSnapshot(liquidatorAddress));
    const liquidationAllowed = await d.comptroller.callStatic.liquidateBorrowAllowed(
      borrowCTokenAsLiquidator.address,
      d.collateralCToken.address,
      liquidatorAddress,
      borrowerAddress,
      borrowDebt
    );
    console.log("liquidationAllowed", liquidationAllowed);
    const liquidateBorrowResult = await borrowCTokenAsLiquidator.callStatic.liquidateBorrow(borrowerAddress, borrowDebt, d.collateralCToken.address);
    console.log("liquidateBorrowResult", liquidateBorrowResult);

    await borrowCTokenAsLiquidator.liquidateBorrow(borrowerAddress, borrowDebt, d.collateralCToken.address);
    // const receipt = await tx.wait();

    // if (receipt?.events) {
    //   for (const event of receipt.events) {
    //     console.log("Event", event);
    //   }
    // }

    const accountAfter = await d.comptroller.getAccountLiquidity(borrowerAddress);
    console.log("After liquidation, user account", accountAfter);
    console.log("User collateral after liquidation, collateral token", await d.collateralCToken.getAccountSnapshot(d.hfPoolAdapterTC.address));
    console.log("User borrow after liquidation, collateral token", await d.borrowCToken.getAccountSnapshot(d.hfPoolAdapterTC.address));
    const liquidatorCollateralSnapshotAfterLiquidation = await d.collateralCToken.getAccountSnapshot(liquidatorAddress);
    console.log("Liquidator collateral after liquidation, collateral token", liquidatorCollateralSnapshotAfterLiquidation);
    console.log("Liquidator borrow after liquidation, collateral token", await d.borrowCToken.getAccountSnapshot(liquidatorAddress));


    await collateralCTokenAsLiquidator.redeem(liquidatorCollateralSnapshotAfterLiquidation.tokenBalance);
    const collateralAmountReceivedByLiquidator = await IERC20__factory.connect(d.collateralToken.address, deployer).balanceOf(liquidatorAddress);

    return {
      liquidatorAddress,
      collateralAmountReceivedByLiquidator
    }
  }

  public static async getState(d: IPrepareToBorrowResults) : Promise<IHundredFinancePoolAdapterState> {
    const status = await d.hfPoolAdapterTC.getStatus();
    const collateralBalanceBase = await d.hfPoolAdapterTC.collateralTokensBalance();
    const accountLiquidity = await d.comptroller.getAccountLiquidity(d.hfPoolAdapterTC.address);
    const accountSnapshotCollateral = await d.collateralCToken.getAccountSnapshot(d.hfPoolAdapterTC.address);
    const accountSnapshotBorrow = await d.borrowCToken.getAccountSnapshot(d.hfPoolAdapterTC.address);
    return {status, collateralBalanceBase, accountLiquidity, accountSnapshotCollateral, accountSnapshotBorrow};
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
