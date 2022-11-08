import {
  Borrower, BorrowManager__factory, Controller,
  HfPlatformAdapter, HfPoolAdapter, HfPoolAdapter__factory, IERC20Extended__factory,
  IHfComptroller, IHfCToken, IHfCToken__factory, IHfPriceOracle
} from "../../../../typechain";
import {BigNumber} from "ethers";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {CoreContractsHelper} from "../../helpers/CoreContractsHelper";
import {MocksHelper} from "../../helpers/MocksHelper";
import {AdaptersHelper} from "../../helpers/AdaptersHelper";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Misc} from "../../../../scripts/utils/Misc";
import {ethers} from "hardhat";
import {
  HundredFinanceHelper,
  IHundredFinanceMarketData
} from "../../../../scripts/integration/helpers/HundredFinanceHelper";
import {transferAndApprove} from "../../utils/transferUtils";
import {BalanceUtils} from "../../utils/BalanceUtils";

export interface IPrepareToBorrowResults {
  userContract: Borrower;
  hfPoolAdapterTC: HfPoolAdapter;
  hfPlatformAdapter: HfPlatformAdapter;
  priceOracle: IHfPriceOracle;
  comptroller: IHfComptroller;

  controller: Controller;

  /** Amount that can be borrowed according to the conversion plan */
  amountToBorrow: BigNumber;
  /** Actual amount that was used as collateral */
  collateralAmount: BigNumber;

  collateralCToken: IHfCToken;
  borrowCToken: IHfCToken;

  converterNormal: string;
}

export interface IMarketsInfo {
  borrowData: IHundredFinanceMarketData;
  collateralData: IHundredFinanceMarketData;

  priceCollateral: BigNumber;
  priceBorrow: BigNumber;
}

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

    const converter = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);

    const comptroller = await HundredFinanceHelper.getComptroller(deployer);
    const priceOracle = HundredFinanceHelper.getPriceOracle(deployer);

    const hfPlatformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
      deployer,
      controller.address,
      comptroller.address,
      converter.address,
      [collateralCTokenAddress, borrowCTokenAddress],
      MaticAddresses.HUNDRED_FINANCE_PRICE_ORACLE
    )

    await borrowManager.addAssetPairs(
      hfPlatformAdapter.address,
      [collateralToken.address],
      [borrowToken.address]
    );
    const bmAsTc = BorrowManager__factory.connect(
      borrowManager.address,
      await DeployerUtils.startImpersonate(tetuConverter.address)
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
      await DeployerUtils.startImpersonate(tetuConverter.address)
    );

    // put collateral amount on user's balance
    const holderBalance = await collateralToken.token.balanceOf(collateralHolder);
    const collateralAmount = collateralAmountRequired && holderBalance.gt(collateralAmountRequired)
      ? collateralAmountRequired
      : holderBalance;

    await collateralToken.token
      .connect(await DeployerUtils.startImpersonate(collateralHolder))
      .transfer(userContract.address, collateralAmount);

    // calculate max allowed amount to borrow
    const countBlocks = 1;
    const plan = await hfPlatformAdapter.getConversionPlan(
      collateralToken.address,
      collateralAmount,
      borrowToken.address,
      targetHealthFactor2 || await controller.targetHealthFactor2(),
      countBlocks
    );
    console.log("plan", plan);

    return {
      controller,
      userContract,
      amountToBorrow: plan.amountToBorrow,
      comptroller,
      hfPlatformAdapter,
      hfPoolAdapterTC,
      priceOracle,
      collateralAmount,
      collateralCToken: IHfCToken__factory.connect(collateralCTokenAddress, deployer),
      borrowCToken: IHfCToken__factory.connect(borrowCTokenAddress, deployer),
      converterNormal: converter.address,
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
    collateralToken: TokenDataTypes,
    collateralCToken: TokenDataTypes,
    collateralHolder: string,
    collateralAmountRequired: BigNumber | undefined,
    borrowToken: TokenDataTypes,
    borrowCToken: TokenDataTypes,
    borrowAmountRequired: BigNumber | undefined
  ) : Promise<{sret: string, sexpected: string}>{
    const d = await HundredFinanceTestUtils.prepareToBorrow(
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
      d.hfPoolAdapterTC.address
    );
    await d.hfPoolAdapterTC.borrow(
      d.collateralAmount,
      borrowAmount,
      d.userContract.address
    );
    console.log(`borrow: success`);

    const info = await HundredFinanceTestUtils.getMarketsInfo(deployer, d, collateralCToken.address, borrowCToken.address);

    // check results
    const {error, liquidity, shortfall} = await d.comptroller.getAccountLiquidity(d.hfPoolAdapterTC.address);
    const sb = await IHfCToken__factory.connect(borrowCToken.address, deployer)
      .getAccountSnapshot(d.hfPoolAdapterTC.address);
    console.log(`Borrow token: balance=${sb.borrowBalance} tokenBalance=${sb.tokenBalance} exchangeRate=${sb.exchangeRateMantissa}`);
    const sc = await IHfCToken__factory.connect(collateralCToken.address, deployer)
      .getAccountSnapshot(d.hfPoolAdapterTC.address);
    console.log(`Collateral token: balance=${sc.borrowBalance} tokenBalance=${sc.tokenBalance} exchangeRate=${sc.exchangeRateMantissa}`);

    const retBalanceBorrowUser = await borrowToken.token.balanceOf(d.userContract.address);
    const retBalanceCollateralTokensPoolAdapter = await IERC20Extended__factory.connect(
      collateralCToken.address, deployer
    ).balanceOf(d.hfPoolAdapterTC.address);

    const sret = [
      error,
      retBalanceBorrowUser,
      retBalanceCollateralTokensPoolAdapter,
      liquidity,
      shortfall,
    ].map(x => BalanceUtils.toString(x)).join("\n");

    const expectedLiquidity = HundredFinanceTestUtils.getExpectedLiquidity(
      info.collateralData,
      info.priceCollateral,
      info.priceBorrow,
      sc.tokenBalance,
      sb.borrowBalance
    )
    const sexpected = [
      0,
      borrowAmount, // borrowed amount on user's balance
      d.collateralAmount
        .mul(Misc.WEI)
        .div(info.collateralData.exchangeRateStored),
      expectedLiquidity,
      0,
    ].map(x => BalanceUtils.toString(x)).join("\n");

    return {sret, sexpected};
  }
}