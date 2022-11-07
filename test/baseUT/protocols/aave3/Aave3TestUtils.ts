import {
  Aave3PoolAdapter, Aave3PoolAdapter__factory,
  Borrower, BorrowManager__factory,
  Controller,
  IAavePool, IAavePool__factory,
  IAavePriceOracle,
  IAaveProtocolDataProvider, IERC20__factory, IERC20Extended__factory
} from "../../../../typechain";
import {Aave3Helper, IAave3ReserveInfo} from "../../../../scripts/integration/helpers/Aave3Helper";
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
import {IAave3UserAccountDataResults} from "../../apr/aprAave3";

//region Data types
export interface IPrepareToBorrowResults {
  userContract: Borrower;
  h: Aave3Helper;

  aavePoolAdapterAsTC: Aave3PoolAdapter;
  aavePool: IAavePool;
  dataProvider: IAaveProtocolDataProvider;
  aavePrices: IAavePriceOracle;

  controller: Controller;
  plan: IConversionPlan;

  /** Amount that can be borrowed according to the conversion plan */
  amountToBorrow: BigNumber;
  /** Actual amount that was used as collateral */
  collateralAmount: BigNumber;

  converterNormal: string;
  converterEMode: string;

  collateralToken: TokenDataTypes;
  borrowToken: TokenDataTypes;

  priceCollateral: BigNumber;
  priceBorrow: BigNumber;
}

export interface IPrepareToBorrowOptionalSetup {
  borrowHolders?: string[];
  targetHealthFactor2?: number;
}

async function supplyEnoughBorrowAssetToAavePool(
  aavePool: string,
  borrowHolders: string[],
  borrowAsset: string
) {
  const user2 = await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address);

  // user2 provides DAI amount enough to borrow by user1
  for (const h of borrowHolders) {
    const caAsH = IERC20__factory.connect(borrowAsset, await DeployerUtils.startImpersonate(h));
    const holderBalance = await caAsH.balanceOf(h);
    console.log("Holder balance:", holderBalance.toString());
    await caAsH.transfer(user2.address, await caAsH.balanceOf(h));
    const userBalance = await caAsH.balanceOf(user2.address);
    console.log("User balance:", userBalance.toString());
  }

  // supply all available borrow asset to aave pool
  const user2CollateralBalance = await IERC20__factory.connect(borrowAsset, user2).balanceOf(user2.address);
  await IERC20Extended__factory.connect(borrowAsset, user2).approve(aavePool, user2CollateralBalance);
  console.log(`Supply collateral ${borrowAsset} amount ${user2CollateralBalance}`);
  await IAavePool__factory.connect(aavePool, await DeployerUtils.startImpersonate(user2.address))
    .supply(borrowAsset, user2CollateralBalance, user2.address, 0);
}

interface IBorrowResults {
  collateralData: IAave3ReserveInfo;
  accountDataAfterBorrow: IAave3UserAccountDataResults;
  borrowedAmount: BigNumber;
}
//endregion Data types

export class Aave3TestUtils {
  /**
   * Initialize TetuConverter app and aave pool adapter.
   * Put the collateral amount on pool-adapter's balance.
   *
   * If collateralAmount is undefined, we should use all available amount as the collateral.
   */
  public static async prepareToBorrow(
    deployer: SignerWithAddress,
    collateralToken: TokenDataTypes,
    collateralHolders: string[],
    collateralAmountRequired: BigNumber | undefined,
    borrowToken: TokenDataTypes,
    useEMode: boolean,
    additionalParams?: IPrepareToBorrowOptionalSetup
  ) : Promise<IPrepareToBorrowResults> {
    const periodInBlocks = 1000;

    // initialize pool, adapters and helper for the adapters
    const h: Aave3Helper = new Aave3Helper(deployer);

    const aavePool = await Aave3Helper.getAavePool(deployer);
    const dataProvider = await Aave3Helper.getAaveProtocolDataProvider(deployer);
    const aavePrices = await Aave3Helper.getAavePriceOracle(deployer);

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

    const converterNormal = await AdaptersHelper.createAave3PoolAdapter(deployer);
    const converterEMode = await AdaptersHelper.createAave3PoolAdapterEMode(deployer);
    const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
      deployer, controller.address, aavePool.address,
      converterNormal.address,
      converterEMode.address
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
      useEMode ? converterEMode.address : converterNormal.address,
      userContract.address,
      collateralToken.address,
      borrowToken.address
    );
    const aavePoolAdapterAsTC = Aave3PoolAdapter__factory.connect(
      await bm.getPoolAdapter(
        useEMode ? converterEMode.address : converterNormal.address,
        userContract.address,
        collateralToken.address,
        borrowToken.address
      ),
      await DeployerUtils.startImpersonate(tetuConverter.address)
    );

    // put collateral amount on user's balance
    const collateralAmount = await BalanceUtils.getRequiredAmountFromHolders(
      collateralAmountRequired,
      collateralToken.token,
      collateralHolders,
      userContract.address
    );
    console.log(`Put collateral=${collateralAmount} on user balance`);

    if (additionalParams?.borrowHolders) {
      await supplyEnoughBorrowAssetToAavePool(
        aavePool.address,
        additionalParams?.borrowHolders,
        borrowToken.address
      );
    }

    // calculate max allowed amount to borrow
    const countBlocks = 1;

    const plan: IConversionPlan = await aavePlatformAdapter.getConversionPlan(
      collateralToken.address,
      collateralAmount,
      borrowToken.address,
      additionalParams?.targetHealthFactor2 || await controller.targetHealthFactor2(),
      countBlocks
    );
    console.log("plan", plan);

    // prices of assets in base currency
    const prices = await aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);


    return {
      controller,
      h,
      userContract,
      aavePrices,
      aavePool,
      aavePoolAdapterAsTC,
      dataProvider,
      amountToBorrow: plan.amountToBorrow,
      collateralAmount,
      plan,
      converterNormal: converterNormal.address,
      converterEMode: converterEMode.address,
      collateralToken,
      borrowToken,
      priceCollateral: prices[0],
      priceBorrow: prices[1]
    }
  }

  public static async makeBorrow(
    deployer: SignerWithAddress,
    d: IPrepareToBorrowResults,
    borrowAmountRequired: BigNumber | undefined
  ): Promise<IBorrowResults> {
    const collateralData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, d.collateralToken.address);
    const borrowAmount = borrowAmountRequired
      ? borrowAmountRequired
      : d.amountToBorrow;
    console.log("borrowAmountRequired", borrowAmountRequired);
    console.log("d.collateralAmount", d.collateralAmount);
    console.log("borrowAmount", borrowAmount);

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

    return {
      collateralData,
      accountDataAfterBorrow: await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address),
      borrowedAmount: borrowAmount
    };
  }
}