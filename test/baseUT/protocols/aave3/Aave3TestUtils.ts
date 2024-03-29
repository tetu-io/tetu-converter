import {
  Aave3PoolAdapter, Aave3PoolAdapter__factory, Aave3PoolMock, Aave3PoolMock__factory,
  Borrower, BorrowManager__factory,
  ConverterController, DebtMonitor__factory,
  IAavePool, IAavePool__factory,
  IAavePriceOracle,
  IAaveProtocolDataProvider, IERC20__factory, IERC20Metadata__factory
} from "../../../../typechain";
import {Aave3Helper, IAave3ReserveInfo} from "../../../../scripts/integration/aave3/Aave3Helper";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ethers} from "hardhat";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {BalanceUtils} from "../../utils/BalanceUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {makeInfinityApprove, transferAndApprove} from "../../utils/transferUtils";
import {IAave3UserAccountDataResults} from "./aprAave3";
import {Aave3ChangePricesUtils} from "./Aave3ChangePricesUtils";
import {IPoolAdapterStatus} from "../../types/BorrowRepayDataTypes";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {parseUnits} from "ethers/lib/utils";
import {GAS_LIMIT} from "../../types/GasLimit";
import {ICoreAave3} from "./Aave3DataTypes";
import {IConversionPlan} from "../../types/AppDataTypes";
import {AdaptersHelper} from "../../app/AdaptersHelper";
import {MocksHelper} from "../../app/MocksHelper";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";

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

  collateralToken: string;
  borrowToken: string;

  priceCollateral: BigNumber;
  priceBorrow: BigNumber;

  collateralReserveInfo: IAave3ReserveInfo;
}

export interface IPrepareToBorrowOptionalSetup {
  targetHealthFactor2?: number;
  useAave3PoolMock?: Aave3PoolMock;
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
  isPositionOpened: boolean;
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

export interface IMakeBorrowParams {
  makeOperationAsNotTc?: boolean;
  useAave3PoolMock?: boolean;
  ignoreSupply?: boolean;
  ignoreBorrow?: boolean;
  skipSendingATokens?: boolean;
  useMockedAavePriceOracle?: boolean;
  borrowAmountRequired?: string;
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
  gasUsed: BigNumber;
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
    core: ICoreAave3,
    controller: ConverterController,
    collateralAsset: string,
    collateralAmountRequired: BigNumber,
    borrowAsset: string,
    useEMode: boolean,
    additionalParams?: IPrepareToBorrowOptionalSetup
  ) : Promise<IPrepareToBorrowResults> {
    const periodInBlocks = 1000;

    // initialize pool, adapters and helper for the adapters
    const h: Aave3Helper = new Aave3Helper(deployer, core.pool);

    const aavePool = additionalParams?.useAave3PoolMock
      ? additionalParams?.useAave3PoolMock
      : await Aave3Helper.getAavePool(deployer, core.pool);
    if (additionalParams?.useMockedAavePriceOracle) {
      await Aave3ChangePricesUtils.setupPriceOracleMock(deployer, core);
    }

    const dataProvider = await Aave3Helper.getAaveProtocolDataProvider(deployer, core.pool);
    const aavePrices = await Aave3Helper.getAavePriceOracle(deployer, core.pool);

    const userContract = await MocksHelper.deployBorrower(deployer.address, controller, periodInBlocks);
    await controller.connect(await DeployerUtils.startImpersonate(await controller.governance())).setWhitelistValues([userContract.address], true);

    const converterNormal = await AdaptersHelper.createAave3PoolAdapter(deployer);
    const converterEMode = await AdaptersHelper.createAave3PoolAdapterEMode(deployer);
    const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
      deployer,
      controller.address,
      aavePool.address,
      converterNormal.address,
      converterEMode.address
    );

    const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
    await borrowManager.addAssetPairs(aavePlatformAdapter.address,[collateralAsset], [borrowAsset]);
    const bmAsTc = borrowManager.connect(await DeployerUtils.startImpersonate(await controller.tetuConverter()));
    await bmAsTc.registerPoolAdapter(
      useEMode ? converterEMode.address : converterNormal.address,
      userContract.address,
      collateralAsset,
      borrowAsset
    );
    const aavePoolAdapterAsTC = Aave3PoolAdapter__factory.connect(
      await borrowManager.getPoolAdapter(
        useEMode ? converterEMode.address : converterNormal.address,
        userContract.address,
        collateralAsset,
        borrowAsset
      ),
      await DeployerUtils.startImpersonate(await controller.tetuConverter())
    );
    // TetuConverter gives infinity approve to the pool adapter after pool adapter creation (see TetuConverter.convert implementation)
    await makeInfinityApprove(
      await controller.tetuConverter(),
      aavePoolAdapterAsTC.address,
      collateralAsset,
      borrowAsset
    );
    // put collateral amount on user's balance
    const collateralAmount = collateralAmountRequired;
    await TokenUtils.getToken(collateralAsset, userContract.address, collateralAmount);

    // todo
    // console.log(`Put collateral=${collateralAmount} on user balance`);
    // if (additionalParams?.borrowHolders) {
    //   // get max allowed amount to supply
    //   const reversePlan: IConversionPlan = await aavePlatformAdapter.getConversionPlan(
    //     {
    //       collateralAsset: borrowAsset,
    //       amountIn: parseUnits("1", await IERC20Metadata__factory.connect(borrowAsset, deployer).decimals()),
    //       borrowAsset: collateralAsset,
    //       countBlocks: 1,
    //       entryData: "0x",
    //     },
    //     additionalParams?.targetHealthFactor2 || await controller.targetHealthFactor2(),
    //     {gasLimit: GAS_LIMIT}
    //   );
    //   await supplyEnoughBorrowAssetToAavePool(
    //     aavePool.address,
    //     additionalParams?.borrowHolders,
    //     borrowAsset,
    //     reversePlan.maxAmountToSupply.div(2)
    //   );
    // }

    if (additionalParams?.useAave3PoolMock) {
      // see Aave3PoolMock.supply for explanation
      // we need to put additional amount to mock to be able to split a-tokens on two parts
      await TokenUtils.getToken(collateralAsset, aavePool.address, collateralAmount);
    }

    // calculate max allowed amount to borrow
    const countBlocks = 1;

    const plan: IConversionPlan = await aavePlatformAdapter.getConversionPlan(
      {
        collateralAsset,
        amountIn: collateralAmount,
        borrowAsset,
        countBlocks,
        entryData: "0x",
      },
      additionalParams?.targetHealthFactor2 || await controller.targetHealthFactor2(),
      {gasLimit: GAS_LIMIT}
    );
    console.log("plan", plan);

    // prices of assets in base currency
    const prices = await aavePrices.getAssetsPrices([collateralAsset, borrowAsset]);

    const collateralReserveInfo = await h.getReserveInfo(deployer, aavePool, dataProvider, collateralAsset);

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
      priceCollateral: prices[0],
      priceBorrow: prices[1],
      collateralReserveInfo,
      collateralToken: collateralAsset,
      borrowToken: borrowAsset
    }
  }

  public static async makeBorrow(deployer: SignerWithAddress, d: IPrepareToBorrowResults, p?: IMakeBorrowParams): Promise<IBorrowResults> {
    const collateralData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, d.collateralToken);
    const borrowedAmount = p?.borrowAmountRequired
      ? parseUnits(p.borrowAmountRequired, await IERC20Metadata__factory.connect(d.borrowToken, deployer).decimals())
      : d.amountToBorrow;
    console.log("borrowAmountRequired", p?.borrowAmountRequired);
    console.log("d.collateralAmount", d.collateralAmount);
    console.log("borrowAmount", borrowedAmount);

    await transferAndApprove(
      d.collateralToken,
      d.userContract.address,
      await d.controller.tetuConverter(),
      d.collateralAmount,
      d.aavePoolAdapterAsTC.address
    );

    const borrower = p?.makeOperationAsNotTc
      ? Aave3PoolAdapter__factory.connect(d.aavePoolAdapterAsTC.address, deployer)
      : d.aavePoolAdapterAsTC;

    if (p?.useAave3PoolMock) {
      if (p?.ignoreBorrow) {
        await Aave3PoolMock__factory.connect(d.aavePool.address, deployer).setIgnoreBorrow();
      }
      if (p?.skipSendingATokens) {
        await Aave3PoolMock__factory.connect(d.aavePool.address, deployer).setSkipSendingATokens();
      }
    }

    await borrower.borrow(d.collateralAmount, borrowedAmount, d.userContract.address, {gasLimit: GAS_LIMIT});

    const isPositionOpened = await DebtMonitor__factory.connect(
      await d.controller.debtMonitor(),
      await DeployerUtils.startImpersonate(d.aavePoolAdapterAsTC.address)
    ).isPositionOpened();

    return {
      collateralData,
      accountDataAfterBorrow: await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address),
      borrowedAmount,
      isPositionOpened
    };
  }

  public static async makeRepay(
    d: IPrepareToBorrowResults,
    amountToRepay?: BigNumber,
    closePosition?: boolean,
    badPathsParams?: IMakeBorrowParams
  ) : Promise<IMakeRepayResults>{
    if (amountToRepay) {
      console.log("Make partial repay");
      // partial repay
      const tetuConverter = await d.controller.tetuConverter();
      const poolAdapterAsCaller = d.aavePoolAdapterAsTC.connect(await DeployerUtils.startImpersonate(tetuConverter));

      console.log("d.borrowToken", d.borrowToken);
      console.log("d.userContract.address", d.userContract.address);
      console.log("tetuConverter", tetuConverter);
      console.log("amountToRepay", amountToRepay);
      console.log("d.aavePoolAdapterAsTC.address", d.aavePoolAdapterAsTC.address);
      await transferAndApprove(
        d.borrowToken,
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
        closePosition === undefined ? false : closePosition,
        {gasLimit: GAS_LIMIT}
      );
      const tx = await payer.repay(
        amountToRepay,
        d.userContract.address,
        closePosition === undefined ? false : closePosition,
        {gasLimit: GAS_LIMIT}
      );
      const gasUsed = (await tx.wait()).gasUsed;
      return {
        userAccountData: await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address),
        repayResultsCollateralAmountOut,
        gasUsed
      }
    } else {
      // make full repayment
      console.log("makeRepayComplete...");
      const tx = await d.userContract.makeRepayComplete(d.collateralToken, d.borrowToken, d.userContract.address);
      const gasUsed = (await tx.wait()).gasUsed;
      const repayResults = await d.userContract.repayResults();
      return {
        userAccountData: await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address),
        repayResultsCollateralAmountOut: repayResults.collateralAmountOut,
        repayResultsReturnedBorrowAmountOut: repayResults.returnedBorrowAmountOut,
        gasUsed
      }
    }
  }

  public static async prepareToLiquidation(
    deployer: SignerWithAddress,
    core: ICoreAave3,
    controller: ConverterController,
    collateralAsset: string,
    collateralHolder: string,
    collateralAmountNum: number,
    borrowAsset: string,
    changePriceFactor: number = 10
  ) : Promise<IPrepareToLiquidationResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = parseUnits(collateralAmountNum.toString(), collateralToken.decimals);

    const d = await Aave3TestUtils.prepareToBorrow(
      deployer,
      core,
      controller,
      collateralToken.address,
      collateralAmount,
      borrowToken.address,
      false
    );
    // make a borrow
    await Aave3TestUtils.makeBorrow(deployer, d);
    console.log("After borrow, user account", await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address));

    // reduce price of collateral to reduce health factor below 1
    await Aave3ChangePricesUtils.changeAssetPrice(deployer, core, d.collateralToken, false, changePriceFactor);

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
    core: ICoreAave3,
    d: IPrepareToBorrowResults,
    borrowHolder: string
  ) : Promise<ILiquidationResults> {
    const liquidatorAddress = ethers.Wallet.createRandom().address;

    const liquidator = await DeployerUtils.startImpersonate(liquidatorAddress);
    const liquidatorBorrowAmountToPay = d.amountToBorrow;
    const borrowerAddress = d.aavePoolAdapterAsTC.address;
    await BalanceUtils.getAmountFromHolder(d.borrowToken, borrowHolder, liquidatorAddress, liquidatorBorrowAmountToPay);
    await IERC20__factory.connect(d.borrowToken, liquidator).approve(d.aavePool.address, Misc.MAX_UINT);

    const aavePoolAsLiquidator = IAavePool__factory.connect(d.aavePool.address, liquidator);
    const dataProvider = await Aave3Helper.getAaveProtocolDataProvider(liquidator, core.pool);
    const userReserveData = await dataProvider.getUserReserveData(d.borrowToken, borrowerAddress);
    const amountToLiquidate = userReserveData.currentVariableDebt.div(2);

    console.log("Before liquidation, user account", await d.aavePool.getUserAccountData(borrowerAddress));
    await aavePoolAsLiquidator.liquidationCall(
      d.collateralToken,
      d.borrowToken,
      borrowerAddress,
      amountToLiquidate,
      false // we need to receive underlying
    );
    console.log("After liquidation, user account", await d.aavePool.getUserAccountData(borrowerAddress));

    const collateralAmountReceivedByLiquidator = await IERC20__factory.connect(d.collateralToken, deployer).balanceOf(liquidatorAddress);

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

  public static async putCollateralAmountOnUserBalance(init: IInitialBorrowResults) {
    await TokenUtils.getToken(init.collateralToken.address, init.d.userContract.address, init.collateralAmount);
  }

  public static async putDoubleBorrowAmountOnUserBalance(signer: SignerWithAddress, init: IPrepareToBorrowResults) {
    await TokenUtils.getToken(init.borrowToken, init.userContract.address, init.amountToBorrow.mul(2));
  }
}
