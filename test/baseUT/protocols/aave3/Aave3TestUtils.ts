import {
  Aave3PoolAdapter, Aave3PoolAdapter__factory, Aave3PoolMock__factory,
  Borrower, BorrowManager__factory,
  ConverterController,
  IAavePool, IAavePool__factory,
  IAavePriceOracle,
  IAaveProtocolDataProvider, IERC20__factory, IERC20Metadata__factory, IPoolAdapter__factory
} from "../../../../typechain";
import {Aave3Helper, IAave3ReserveInfo} from "../../../../scripts/integration/helpers/Aave3Helper";
import {IConversionPlan} from "../../apr/aprDataTypes";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ethers} from "hardhat";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {MocksHelper} from "../../helpers/MocksHelper";
import {AdaptersHelper} from "../../helpers/AdaptersHelper";
import {BalanceUtils} from "../../utils/BalanceUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {makeInfinityApprove, transferAndApprove} from "../../utils/transferUtils";
import {IAave3UserAccountDataResults} from "../../apr/aprAave3";
import {Aave3ChangePricesUtils} from "./Aave3ChangePricesUtils";
import {IPoolAdapterStatus} from "../../types/BorrowRepayDataTypes";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {TetuConverterApp} from "../../helpers/TetuConverterApp";
import {Misc} from "../../../../scripts/utils/Misc";
import {IAaveTwoUserAccountDataResults} from "../../apr/aprAaveTwo";
import {parseUnits} from "ethers/lib/utils";

//region Data types
export interface IPrepareToBorrowResults {
  userContract: Borrower;
  h: Aave3Helper;

  aavePoolAdapterAsTC: Aave3PoolAdapter;
  aavePool: IAavePool;
  dataProvider: IAaveProtocolDataProvider;
  aavePrices: IAavePriceOracle;

  controller: ConverterController;
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

  collateralReserveInfo: IAave3ReserveInfo;
}

export interface IPrepareToBorrowOptionalSetup {
  borrowHolders?: string[];
  targetHealthFactor2?: number;
  useAave3PoolMock?: boolean;
  useMockedAavePriceOracle?: boolean;
}

async function supplyEnoughBorrowAssetToAavePool(
  aavePool: string,
  borrowHolders: string[],
  borrowAsset: string,
  maxAmountToSupply: BigNumber
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

  // supply all available borrow asset to aave pool,
  // but we cannot supply an amount greater than supply cap
  const user2CollateralBalance = await IERC20__factory.connect(borrowAsset, user2).balanceOf(user2.address);
  await IERC20Metadata__factory.connect(borrowAsset, user2).approve(aavePool, user2CollateralBalance);
  console.log(`Supply collateral ${borrowAsset} amount ${user2CollateralBalance} maxAmountToSupply=${maxAmountToSupply}`);
  await IAavePool__factory.connect(aavePool, await DeployerUtils.startImpersonate(user2.address))
    .supply(
      borrowAsset,
      maxAmountToSupply.eq(0) || maxAmountToSupply.gt(user2CollateralBalance)
        ? user2CollateralBalance
        : maxAmountToSupply,
      user2.address,
      0
    );
}

export interface IBorrowResults {
  collateralData: IAave3ReserveInfo;
  accountDataAfterBorrow: IAave3UserAccountDataResults;
  borrowedAmount: BigNumber;
}

export interface IPrepareToLiquidationResults {
  collateralToken: TokenDataTypes;
  borrowToken: TokenDataTypes;
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
  useAave3PoolMock?: boolean;
  ignoreSupply?: boolean;
  ignoreBorrow?: boolean;
  skipSendingATokens?: boolean;
  useMockedAavePriceOracle?: boolean;
}

export interface IMakeRepayBadPathsParams {
  amountToRepayStr?: string;
  makeRepayAsNotTc?: boolean;
  closePosition?: boolean;
  useAave3PoolMock?: boolean;
  grabAllBorrowAssetFromSenderOnRepay?: boolean;
  collateralPriceIsZero?: boolean;
  ignoreRepay?: boolean;
  ignoreWithdraw?: boolean;
}

export interface IAave3PoolAdapterState {
  status: IPoolAdapterStatus;
  collateralBalanceATokens: BigNumber;
  balanceATokensForCollateral: BigNumber;
  accountState: IAave3UserAccountDataResults;
}

export interface IInitialBorrowResults {
  d: IPrepareToBorrowResults;
  collateralToken: TokenDataTypes;
  borrowToken: TokenDataTypes;
  collateralAmount: BigNumber;
  stateAfterBorrow: IAave3PoolAdapterState;
}

interface IMakeRepayResults {
  userAccountData: IAave3UserAccountDataResults;
  repayResultsCollateralAmountOut: BigNumber;
  repayResultsReturnedBorrowAmountOut?: BigNumber;
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

    const aavePool = additionalParams?.useAave3PoolMock
      ? await MocksHelper.getAave3PoolMock(deployer, collateralToken.address, borrowToken.address)
      : await Aave3Helper.getAavePool(deployer);
    if (additionalParams?.useMockedAavePriceOracle) {
      await Aave3ChangePricesUtils.setupPriceOracleMock(deployer);
    }

    const dataProvider = await Aave3Helper.getAaveProtocolDataProvider(deployer);
    const aavePrices = await Aave3Helper.getAavePriceOracle(deployer);

    // controller: we need TC (as a caller) and DM (to register borrow position)
    const controller = await TetuConverterApp.createController(deployer);
    const userContract = await MocksHelper.deployBorrower(deployer.address, controller, periodInBlocks);

    const converterNormal = await AdaptersHelper.createAave3PoolAdapter(deployer);
    const converterEMode = await AdaptersHelper.createAave3PoolAdapterEMode(deployer);
    const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
      deployer,
      controller.address,
      aavePool.address,
      converterNormal.address,
      converterEMode.address
    );

    const borrowManager = BorrowManager__factory.connect(
      await controller.borrowManager(),
      deployer
    );
    await borrowManager.addAssetPairs(
      aavePlatformAdapter.address,
      [collateralToken.address],
      [borrowToken.address]
    );
    const bmAsTc = BorrowManager__factory.connect(
      await controller.borrowManager(),
      await DeployerUtils.startImpersonate(await controller.tetuConverter())
    );
    await bmAsTc.registerPoolAdapter(
      useEMode ? converterEMode.address : converterNormal.address,
      userContract.address,
      collateralToken.address,
      borrowToken.address
    );
    const aavePoolAdapterAsTC = Aave3PoolAdapter__factory.connect(
      await borrowManager.getPoolAdapter(
        useEMode ? converterEMode.address : converterNormal.address,
        userContract.address,
        collateralToken.address,
        borrowToken.address
      ),
      await DeployerUtils.startImpersonate(await controller.tetuConverter())
    );
    // TetuConverter gives infinity approve to the pool adapter after pool adapter creation (see TetuConverter.convert implementation)
    await makeInfinityApprove(
      await controller.tetuConverter(),
      aavePoolAdapterAsTC.address,
      collateralToken.address,
      borrowToken.address
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
      // get max allowed amount to supply
      const reversePlan: IConversionPlan = await aavePlatformAdapter.getConversionPlan(
        {
          collateralAsset: borrowToken.address,
          amountIn: parseUnits("1", borrowToken.decimals),
          borrowAsset: collateralToken.address,
          countBlocks: 1,
          entryData: "0x"
        },
        additionalParams?.targetHealthFactor2 || await controller.targetHealthFactor2(),
      );
      await supplyEnoughBorrowAssetToAavePool(
        aavePool.address,
        additionalParams?.borrowHolders,
        borrowToken.address,
        reversePlan.maxAmountToSupply.div(2)
      );
    }

    if (additionalParams?.useAave3PoolMock) {
      // see Aave3PoolMock.supply for explanation
      // we need to put additional amount to mock to be able to split a-tokens on two parts
      await BalanceUtils.getRequiredAmountFromHolders(
        collateralAmount,
        collateralToken.token,
        collateralHolders,
        aavePool.address
      );
    }

    // calculate max allowed amount to borrow
    const countBlocks = 1;

    const plan: IConversionPlan = await aavePlatformAdapter.getConversionPlan(
      {
        collateralAsset: collateralToken.address,
        amountIn: collateralAmount,
        borrowAsset: borrowToken.address,
        countBlocks,
        entryData: "0x"
      },
      additionalParams?.targetHealthFactor2 || await controller.targetHealthFactor2(),
    );
    console.log("plan", plan);

    // prices of assets in base currency
    const prices = await aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);

    const collateralReserveInfo = await h.getReserveInfo(deployer, aavePool, dataProvider, collateralToken.address);

    return {
      controller,
      h,
      userContract,
      aavePrices,
      aavePool,
      aavePoolAdapterAsTC,
      dataProvider,
      amountToBorrow: plan.amountToBorrow,
      collateralAmount: plan.collateralAmount,
      plan,
      converterNormal: converterNormal.address,
      converterEMode: converterEMode.address,
      collateralToken,
      borrowToken,
      priceCollateral: prices[0],
      priceBorrow: prices[1],
      collateralReserveInfo
    }
  }

  public static async makeBorrow(
    deployer: SignerWithAddress,
    d: IPrepareToBorrowResults,
    borrowAmountRequired: BigNumber | undefined,
    badPathsParams?: IMakeBorrowOrRepayBadPathsParams
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

    const borrower = badPathsParams?.makeOperationAsNotTc
      ? Aave3PoolAdapter__factory.connect(d.aavePoolAdapterAsTC.address, deployer)
      : d.aavePoolAdapterAsTC;

    if (badPathsParams?.useAave3PoolMock) {
      if (badPathsParams?.ignoreBorrow) {
        await Aave3PoolMock__factory.connect(d.aavePool.address, deployer).setIgnoreBorrow();
      }
      if (badPathsParams?.skipSendingATokens) {
        await Aave3PoolMock__factory.connect(d.aavePool.address, deployer).setSkipSendingATokens();
      }
    }

    await borrower.borrow(
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

  public static async makeRepay(
    d: IPrepareToBorrowResults,
    amountToRepay?: BigNumber,
    closePosition?: boolean,
    badPathsParams?: IMakeBorrowOrRepayBadPathsParams
  ) : Promise<IMakeRepayResults>{
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

      const payer = badPathsParams?.makeOperationAsNotTc
        ? Aave3PoolAdapter__factory.connect(
          d.aavePoolAdapterAsTC.address,
          await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
        )
        : poolAdapterAsCaller;

      const repayResultsCollateralAmountOut = await payer.callStatic.repay(
        amountToRepay,
        d.userContract.address,
        closePosition === undefined ? false : closePosition
      );
      await payer.repay(
        amountToRepay,
        d.userContract.address,
        closePosition === undefined ? false : closePosition
      );
      return {
        userAccountData: await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address),
        repayResultsCollateralAmountOut,
      }
    } else {
      // make full repayment
      console.log("makeRepayComplete...");
      await d.userContract.makeRepayComplete(
        d.collateralToken.address,
        d.borrowToken.address,
        d.userContract.address
      );
      const repayResults = await d.userContract.repayResults();
      return {
        userAccountData: await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address),
        repayResultsCollateralAmountOut: repayResults.collateralAmountOut,
        repayResultsReturnedBorrowAmountOut: repayResults.returnedBorrowAmountOut
      }
    }
  }

  public static async prepareToLiquidation(
    deployer: SignerWithAddress,
    collateralAsset: string,
    collateralHolder: string,
    collateralAmountNum: number,
    borrowAsset: string,
    changePriceFactor: number = 10
  ) : Promise<IPrepareToLiquidationResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = getBigNumberFrom(collateralAmountNum, collateralToken.decimals);

    const d = await Aave3TestUtils.prepareToBorrow(deployer,
      collateralToken,
      [collateralHolder],
      collateralAmount,
      borrowToken,
      false
    );
    // make a borrow
    await Aave3TestUtils.makeBorrow(deployer, d, undefined);
    console.log("After borrow, user account", await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address));

    // reduce price of collateral to reduce health factor below 1
    await Aave3ChangePricesUtils.changeAssetPrice(deployer, d.collateralToken.address, false, changePriceFactor);

    const statusBeforeLiquidation = await d.aavePoolAdapterAsTC.getStatus();
    return {
      collateralToken,
      borrowToken,
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
    const liquidatorBorrowAmountToPay = d.amountToBorrow;
    const borrowerAddress = d.aavePoolAdapterAsTC.address;
    await BalanceUtils.getAmountFromHolder(d.borrowToken.address, borrowHolder, liquidatorAddress, liquidatorBorrowAmountToPay);
    await IERC20__factory.connect(d.borrowToken.address, liquidator).approve(d.aavePool.address, Misc.MAX_UINT);

    const aavePoolAsLiquidator = IAavePool__factory.connect(d.aavePool.address, liquidator);
    const dataProvider = await Aave3Helper.getAaveProtocolDataProvider(liquidator);
    const userReserveData = await dataProvider.getUserReserveData(d.borrowToken.address, borrowerAddress);
    const amountToLiquidate = userReserveData.currentVariableDebt.div(2);

    console.log("Before liquidation, user account", await d.aavePool.getUserAccountData(borrowerAddress));
    await aavePoolAsLiquidator.liquidationCall(
      d.collateralToken.address,
      d.borrowToken.address,
      borrowerAddress,
      amountToLiquidate,
      false // we need to receive underlying
    );
    console.log("After liquidation, user account", await d.aavePool.getUserAccountData(borrowerAddress));

    const collateralAmountReceivedByLiquidator = await IERC20__factory.connect(d.collateralToken.address, deployer).balanceOf(liquidatorAddress);

    return {
      liquidatorAddress,
      collateralAmountReceivedByLiquidator
    }
  }

  public static async getState(d: IPrepareToBorrowResults) : Promise<IAave3PoolAdapterState> {
    const status = await d.aavePoolAdapterAsTC.getStatus();
    const collateralBalanceBase = await d.aavePoolAdapterAsTC.collateralBalanceATokens();
    const accountState = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
    const balanceATokensForCollateral = await IERC20__factory.connect(
      d.collateralReserveInfo.aTokenAddress,
      await DeployerUtils.startImpersonate(d.aavePoolAdapterAsTC.address)
    ).balanceOf(d.aavePoolAdapterAsTC.address);
    return {status, collateralBalanceATokens: collateralBalanceBase, accountState, balanceATokensForCollateral};
  }

  public static async putCollateralAmountOnUserBalance(init: IInitialBorrowResults, collateralHolder: string) {
    await BalanceUtils.getRequiredAmountFromHolders(
      init.collateralAmount,
      init.collateralToken.token,
      [collateralHolder],
      init.d.userContract.address
    );
  }
  public static async putDoubleBorrowAmountOnUserBalance(init: IPrepareToBorrowResults, borrowHolder: string) {
    await BalanceUtils.getRequiredAmountFromHolders(
      init.amountToBorrow.mul(2),
      init.borrowToken.token,
      [borrowHolder],
      init.userContract.address
    );
  }
}
