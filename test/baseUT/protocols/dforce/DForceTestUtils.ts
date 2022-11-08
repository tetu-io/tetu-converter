import {
  Borrower, BorrowManager__factory, Controller,
  DForcePlatformAdapter,
  DForcePoolAdapter, DForcePoolAdapter__factory,
  IDForceController, IDForceCToken, IDForceCToken__factory,
  IDForcePriceOracle, IERC20Extended__factory
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
import {areAlmostEqual} from "../../utils/CommonUtils";
import {BalanceUtils} from "../../utils/BalanceUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {ethers} from "hardhat";

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
    const debtMonitor = await CoreContractsHelper.createDebtMonitor(deployer, controller);
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
    collateralToken: TokenDataTypes,
    collateralCToken: TokenDataTypes,
    collateralHolder: string,
    collateralAmountRequired: BigNumber | undefined,
    borrowToken: TokenDataTypes,
    borrowCToken: TokenDataTypes,
    borrowAmountRequired: BigNumber | undefined
  ) : Promise<{sret: string, sexpected: string, prepareResults: IPrepareToBorrowResults}>{
    const d = await DForceTestUtils.prepareToBorrow(
      deployer,
      collateralToken,
      collateralHolder,
      collateralCToken.address,
      collateralAmountRequired,
      borrowToken,
      borrowCToken.address
    );
    const borrowAmount = borrowAmountRequired
      ? borrowAmountRequired
      : d.amountToBorrow;
    console.log("collateralAmountRequired", collateralAmountRequired);
    console.log("borrowAmountRequired", borrowAmountRequired);
    console.log("d.collateralAmount", d.collateralAmount);
    console.log("borrowAmount", borrowAmount);

    await transferAndApprove(
      collateralToken.address,
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
    const info = await this.getMarketsInfo(
      deployer,
      d,
      collateralCToken.address,
      borrowCToken.address
    );

    // check results

    // https://developers.dforce.network/lend/lend-and-synth/controller#calcaccountequity
    // Collaterals and borrows represent the current collateral and borrow value is USD with 36 integer precision
    // which for example, 360000000000000000000000000000000000000000 indicates 360000 in USD.
    const {
      accountEquity,
      shortfall,
      collateralValue,
      borrowedValue
    } = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
    console.log(`calcAccountEquity: accountEquity=${accountEquity} shortfall=${shortfall} collateralValue=${collateralValue} borrowedValue=${borrowedValue}`);

    const cTokenBorrow = await IDForceCToken__factory.connect(borrowCToken.address, deployer);
    const bBorrowBalance = await cTokenBorrow.borrowBalanceStored(d.dfPoolAdapterTC.address);
    const bTokenBalance = await cTokenBorrow.balanceOf(d.dfPoolAdapterTC.address);
    const bExchangeRateMantissa = await cTokenBorrow.exchangeRateStored();
    console.log(`Borrow token: balance=${bBorrowBalance} tokenBalance=${bTokenBalance} exchangeRate=${bExchangeRateMantissa}`);

    const cTokenCollateral = await IDForceCToken__factory.connect(collateralCToken.address, deployer);
    const cBorrowBalance = await cTokenCollateral.borrowBalanceStored(d.dfPoolAdapterTC.address);
    const cTokenBalance = await cTokenCollateral.balanceOf(d.dfPoolAdapterTC.address);
    const cExchangeRateMantissa = await cTokenCollateral.exchangeRateStored();
    console.log(`Collateral token: balance=${cBorrowBalance} tokenBalance=${cTokenBalance} exchangeRate=${cExchangeRateMantissa}`);

    const retBalanceBorrowUser = await borrowToken.token.balanceOf(d.userContract.address);
    const retBalanceCollateralTokensPoolAdapter = await IERC20Extended__factory.connect(
      collateralCToken.address, deployer
    ).balanceOf(d.dfPoolAdapterTC.address);

    const expectedLiquidity = this.getExpectedLiquidity(
      info.collateralData,
      info.priceCollateral,
      info.priceBorrow,
      cTokenBalance,
      bBorrowBalance
    )

    const sret = [
      retBalanceBorrowUser,
      retBalanceCollateralTokensPoolAdapter,
      areAlmostEqual(accountEquity, expectedLiquidity),
      shortfall,
    ].map(x => BalanceUtils.toString(x)).join("\n");

    const sexpected = [
      borrowAmount, // borrowed amount on user's balance
      d.collateralAmount
        .mul(Misc.WEI)
        .div(info.collateralData.exchangeRateStored),
      true,
      0,
    ].map(x => BalanceUtils.toString(x)).join("\n");

    return {sret, sexpected, prepareResults: d};
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
}