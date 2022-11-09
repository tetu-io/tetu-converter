import {
  Aave3PoolAdapter__factory,
  AaveTwoPoolAdapter,
  AaveTwoPoolAdapter__factory,
  Borrower,
  BorrowManager__factory,
  Controller,
  IAavePool,
  IAavePool__factory,
  IAavePriceOracle,
  IAaveProtocolDataProvider,
  IAaveTwoPool,
  IAaveTwoPriceOracle, IAaveTwoProtocolDataProvider,
  IERC20__factory,
  IERC20Extended__factory,
  IPoolAdapter__factory
} from "../../../../typechain";
import {AaveTwoHelper, IAaveTwoReserveInfo} from "../../../../scripts/integration/helpers/AaveTwoHelper";
import {IConversionPlan} from "../../apr/aprDataTypes";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ethers} from "hardhat";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {CoreContractsHelper} from "../../helpers/CoreContractsHelper";
import {MocksHelper} from "../../helpers/MocksHelper";
import {AdaptersHelper} from "../../helpers/AdaptersHelper";
import {BalanceUtils} from "../../utils/BalanceUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {transferAndApprove} from "../../utils/transferUtils";
import {IAaveTwoUserAccountDataResults} from "../../apr/aprAaveTwo";
import {AaveTwoChangePricesUtils} from "./AaveTwoChangePricesUtils";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";

//region Data types
export interface IPrepareToBorrowResults {
  userContract: Borrower;

  aavePoolAdapterAsTC: AaveTwoPoolAdapter;
  aavePool: IAaveTwoPool;
  aavePrices: IAaveTwoPriceOracle;
  dataProvider: IAaveTwoProtocolDataProvider;

  controller: Controller;

  /** Amount that can be borrowed according to the conversion plan */
  amountToBorrow: BigNumber;
  /** Actual amount that was used as collateral */
  collateralAmount: BigNumber;

  converterNormal: string;

  collateralToken: TokenDataTypes;
  borrowToken: TokenDataTypes;

  priceCollateral: BigNumber;
  priceBorrow: BigNumber;
}

interface IBorrowResults {
  collateralData: IAaveTwoReserveInfo;
  accountDataAfterBorrow: IAaveTwoUserAccountDataResults;
  borrowedAmount: BigNumber;
}
//endregion Data types

export class AaveTwoTestUtils {
  /**
   * Initialize TetuConverter app and aave pool adapter.
   * Put the collateral amount on pool-adapter's balance.
   *
   * If collateralAmount is undefined, we should use all available amount as the collateral.
   */
  public static async prepareToBorrow(
    deployer: SignerWithAddress,
    collateralToken: TokenDataTypes,
    collateralHolder: string,
    collateralAmountRequired: BigNumber | undefined,
    borrowToken: TokenDataTypes,
    targetHealthFactor2?: number
  ) : Promise<IPrepareToBorrowResults> {
    const periodInBlocks = 1000;

    const aavePool = await AaveTwoHelper.getAavePool(deployer);
    const dataProvider = await AaveTwoHelper.getAaveProtocolDataProvider(deployer);
    const aavePrices = await AaveTwoHelper.getAavePriceOracle(deployer);

    // controller: we need TC (as a caller) and DM (to register borrow position)
    const controller = await CoreContractsHelper.createController(deployer);
    const tetuConverter = await CoreContractsHelper.createTetuConverter(deployer, controller);
    const dm = await CoreContractsHelper.createDebtMonitor(deployer, controller);
    // const bm = await MocksHelper.createBorrowManagerStub(deployer, true);
    const bm = await CoreContractsHelper.createBorrowManager(deployer, controller);
    await controller.setBorrowManager(bm.address);
    await controller.setDebtMonitor(dm.address);
    await controller.setTetuConverter(tetuConverter.address);

    const userContract = await MocksHelper.deployBorrower(deployer.address, controller, periodInBlocks);

    const converterNormal = await AdaptersHelper.createAaveTwoPoolAdapter(deployer);
    const aavePlatformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
      deployer, controller.address, aavePool.address,
      converterNormal.address
    );

    await bm.addAssetPairs(
      aavePlatformAdapter.address,
      [collateralToken.address],
      [borrowToken.address]
    );
    const bmAsTc = BorrowManager__factory.connect(
      bm.address,
      await DeployerUtils.startImpersonate(tetuConverter.address)
    );
    await bmAsTc.registerPoolAdapter(
      converterNormal.address,
      userContract.address,
      collateralToken.address,
      borrowToken.address
    );
    const aavePoolAdapterAsTC = Aave3PoolAdapter__factory.connect(
      await bm.getPoolAdapter(
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

    await collateralToken.token
      .connect(await DeployerUtils.startImpersonate(collateralHolder))
      .transfer(userContract.address, collateralAmount);

    // calculate max allowed amount to borrow
    const countBlocks = 1;
    const plan = await aavePlatformAdapter.getConversionPlan(
      collateralToken.address,
      collateralAmount,
      borrowToken.address,
      targetHealthFactor2 || await controller.targetHealthFactor2(),
      countBlocks
    );
    console.log("plan", plan);

    // prices of assets in base currency
    const prices = await aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);

    return {
      controller,
      userContract,
      aavePrices,
      aavePool,
      aavePoolAdapterAsTC,
      dataProvider,
      amountToBorrow: plan.amountToBorrow,
      collateralAmount,
      converterNormal: converterNormal.address,
      borrowToken,
      collateralToken,
      priceCollateral: prices[0],
      priceBorrow: prices[1],
    }
  }

  public static async makeBorrow(
    deployer: SignerWithAddress,
    d: IPrepareToBorrowResults,
    borrowAmountRequired: BigNumber | undefined
  ) : Promise<IBorrowResults>{
    const collateralData = await AaveTwoHelper.getReserveInfo(
      deployer,
      d.aavePool,
      d.dataProvider,
      d.collateralToken.address
    );
    const borrowAmount = borrowAmountRequired
      ? borrowAmountRequired
      : d.amountToBorrow;

    // make borrow
    await transferAndApprove(
      d.collateralToken.address,
      d.userContract.address,
      await d.controller.tetuConverter(),
      d.collateralAmount,
      d.aavePoolAdapterAsTC.address
    );
    await d.aavePoolAdapterAsTC.borrow(
      d.collateralAmount,
      borrowAmount,
      d.userContract.address
    );

    // check results
    const accountDataAfterBorrow = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);

    return {
      collateralData,
      borrowedAmount: borrowAmount,
      accountDataAfterBorrow
    }
  }

  public static async makeRepay(
    d: IPrepareToBorrowResults,
    amountToRepay?: BigNumber
  ) : Promise<IAaveTwoUserAccountDataResults>{
    if (amountToRepay) {
      // partial repay
      const tetuConverter = await d.controller.tetuConverter();
      const poolAdapterAsCaller = IPoolAdapter__factory.connect(
        d.aavePoolAdapterAsTC.address,
        await DeployerUtils.startImpersonate(tetuConverter)
      );

      await transferAndApprove(
        d.borrowToken.address,
        d.userContract.address,
        tetuConverter,
        amountToRepay,
        d.aavePoolAdapterAsTC.address
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

    return d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
  }

  public static async makeLiquidation(
    deployer: SignerWithAddress,
    d: IPrepareToBorrowResults,
    borrowHolder: string
  ) {
    const MAX_UINT_AMOUNT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    await AaveTwoChangePricesUtils.changeAssetPrice(deployer, d.collateralToken.address, false, 10);

    const liquidatorAddress = ethers.Wallet.createRandom().address;

    const liquidator = await DeployerUtils.startImpersonate(liquidatorAddress);
    const liquidatorBorrowAmountToPay = d.amountToBorrow;
    const borrowerAddress = d.aavePoolAdapterAsTC.address;
    await BalanceUtils.getAmountFromHolder(d.borrowToken.address, borrowHolder, liquidatorAddress, liquidatorBorrowAmountToPay);
    await IERC20__factory.connect(d.borrowToken.address, liquidator).approve(d.aavePool.address, MAX_UINT_AMOUNT);

    const aavePoolAsLiquidator = IAavePool__factory.connect(d.aavePool.address, liquidator);
    const dataProvider = await AaveTwoHelper.getAaveProtocolDataProvider(liquidator);
    const userReserveData = await dataProvider.getUserReserveData(d.borrowToken.address, borrowerAddress);
    const amountToLiquidate = userReserveData.currentVariableDebt.div(2);

    await aavePoolAsLiquidator.liquidationCall(
      d.collateralToken.address,
      d.borrowToken.address,
      borrowerAddress,
      amountToLiquidate,
      false // we need to receive underlying
    );
  }
}