import {
  AaveTwoPoolAdapter__factory,
  AaveTwoPoolAdapter,
  Borrower,
  BorrowManager__factory,
  ConverterController,
  IAaveTwoPool, IAaveTwoPool__factory,
  IAaveTwoPriceOracle, IAaveTwoProtocolDataProvider,
  IERC20__factory,
  IPoolAdapter__factory, Aave3PoolMock__factory
} from "../../../../typechain";
import {AaveTwoHelper, IAaveTwoReserveInfo} from "../../../../scripts/integration/helpers/AaveTwoHelper";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ethers} from "hardhat";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {MocksHelper} from "../../helpers/MocksHelper";
import {AdaptersHelper} from "../../helpers/AdaptersHelper";
import {BalanceUtils} from "../../utils/BalanceUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {makeInfinityApprove, transferAndApprove} from "../../utils/transferUtils";
import {IAaveTwoUserAccountDataResults} from "../../apr/aprAaveTwo";
import {AaveTwoChangePricesUtils} from "./AaveTwoChangePricesUtils";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {IPoolAdapterStatus} from "../../types/BorrowRepayDataTypes";
import {TetuConverterApp} from "../../helpers/TetuConverterApp";
import {Misc} from "../../../../scripts/utils/Misc";
import {GAS_LIMIT} from "../../GasLimit";

//region Data types
export interface IPrepareToBorrowResults {
  userContract: Borrower;

  aavePoolAdapterAsTC: AaveTwoPoolAdapter;
  aavePool: IAaveTwoPool;
  aavePrices: IAaveTwoPriceOracle;
  dataProvider: IAaveTwoProtocolDataProvider;

  controller: ConverterController;

  /** Amount that can be borrowed according to the conversion plan */
  amountToBorrow: BigNumber;
  /** Actual amount that was used as collateral */
  collateralAmount: BigNumber;

  converterNormal: string;

  collateralToken: TokenDataTypes;
  borrowToken: TokenDataTypes;

  priceCollateral: BigNumber;
  priceBorrow: BigNumber;

  collateralReserveInfo: IAaveTwoReserveInfo;
}

export interface IBorrowResults {
  collateralData: IAaveTwoReserveInfo;
  accountDataAfterBorrow: IAaveTwoUserAccountDataResults;
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
  useMockedAavePriceOracle?: boolean;
  useAaveTwoPoolMock?: boolean;
  ignoreSupply?: boolean;
  ignoreBorrow?: boolean;
  skipSendingATokens?: boolean;
}

export interface IAaveTwoPoolAdapterState {
  status: IPoolAdapterStatus;
  collateralBalanceATokens: BigNumber;
  balanceATokensForCollateral: BigNumber;
  accountState: IAaveTwoUserAccountDataResults;
}

export interface IInitialBorrowResults {
  d: IPrepareToBorrowResults;
  collateralToken: TokenDataTypes;
  borrowToken: TokenDataTypes;
  collateralAmount: BigNumber;
  stateAfterBorrow: IAaveTwoPoolAdapterState;
}

export interface IPrepareToBorrowOptionalSetup {
  useAaveTwoPoolMock?: boolean;
  useMockedAavePriceOracle?: boolean;
  targetHealthFactor2?: number;
}

interface IMakeRepayResults {
  userAccountData: IAaveTwoUserAccountDataResults;
  repayResultsCollateralAmountOut: BigNumber;
  repayResultsReturnedBorrowAmountOut?: BigNumber;
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
    controller: ConverterController,
    collateralToken: TokenDataTypes,
    collateralHolder: string,
    collateralAmountRequired: BigNumber | undefined,
    borrowToken: TokenDataTypes,
    additionalParams?: IPrepareToBorrowOptionalSetup
  ) : Promise<IPrepareToBorrowResults> {
    const periodInBlocks = 1000;

    const aavePool = additionalParams?.useAaveTwoPoolMock
      ? await MocksHelper.getAaveTwoPoolMock(deployer, collateralToken.address, borrowToken.address)
      : await AaveTwoHelper.getAavePool(deployer);
    if (additionalParams?.useMockedAavePriceOracle) {
      await AaveTwoChangePricesUtils.setupPriceOracleMock(deployer);
    }
    const dataProvider = await AaveTwoHelper.getAaveProtocolDataProvider(deployer);
    const aavePrices = await AaveTwoHelper.getAavePriceOracle(deployer);

    const userContract = await MocksHelper.deployBorrower(deployer.address, controller, periodInBlocks);
    await controller.connect(await DeployerUtils.startImpersonate(await controller.governance())).setWhitelistValues([userContract.address], true);

    const converterNormal = await AdaptersHelper.createAaveTwoPoolAdapter(deployer);
    const aavePlatformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
      deployer,
      controller.address,
      aavePool.address,
      converterNormal.address
    );

    const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
    await borrowManager.addAssetPairs(
      aavePlatformAdapter.address,
      [collateralToken.address],
      [borrowToken.address]
    );
    const bmAsTc = BorrowManager__factory.connect(
      borrowManager.address,
      await DeployerUtils.startImpersonate(await controller.tetuConverter())
    );
    await bmAsTc.registerPoolAdapter(
      converterNormal.address,
      userContract.address,
      collateralToken.address,
      borrowToken.address
    );
    const aavePoolAdapterAsTC = AaveTwoPoolAdapter__factory.connect(
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
      aavePoolAdapterAsTC.address,
      collateralToken.address,
      borrowToken.address
    );

    // put collateral amount on user's balance
    const holderBalance = await collateralToken.token.balanceOf(collateralHolder);
    const collateralAmount = collateralAmountRequired && holderBalance.gt(collateralAmountRequired)
      ? collateralAmountRequired
      : holderBalance;

    await collateralToken.token
      .connect(await DeployerUtils.startImpersonate(collateralHolder))
      .transfer(userContract.address, collateralAmount);

    if (additionalParams?.useAaveTwoPoolMock) {
      // see AaveTwoPoolMock.supply for explanation
      // we need to put additional amount to mock to be able to split a-tokens on two parts
      await BalanceUtils.getRequiredAmountFromHolders(
        collateralAmount,
        collateralToken.token,
        [collateralHolder],
        aavePool.address
      );
    }

    // calculate max allowed amount to borrow
    const countBlocks = 1;
    const plan = await aavePlatformAdapter.getConversionPlan(
      {
        collateralAsset: collateralToken.address,
        amountIn: collateralAmount,
        borrowAsset: borrowToken.address,
        countBlocks,
        entryData: "0x",
        user: userContract.address
      },
      additionalParams?.targetHealthFactor2 || await controller.targetHealthFactor2(),
      {gasLimit: GAS_LIMIT}
    );
    console.log("plan", plan);

    // prices of assets in base currency
    const prices = await aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);

    const collateralReserveInfo = await AaveTwoHelper.getReserveInfo(deployer, aavePool, dataProvider, collateralToken.address);

    return {
      controller,
      userContract,
      aavePrices,
      aavePool,
      aavePoolAdapterAsTC,
      dataProvider,
      amountToBorrow: plan.amountToBorrow,
      collateralAmount: plan.collateralAmount,
      converterNormal: converterNormal.address,
      borrowToken,
      collateralToken,
      priceCollateral: prices[0],
      priceBorrow: prices[1],
      collateralReserveInfo,
    }
  }

  public static async makeBorrow(
    deployer: SignerWithAddress,
    d: IPrepareToBorrowResults,
    borrowAmountRequired: BigNumber | undefined,
    badPathsParams?: IMakeBorrowOrRepayBadPathsParams
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

    const borrower = badPathsParams?.makeOperationAsNotTc
      ? AaveTwoPoolAdapter__factory.connect(d.aavePoolAdapterAsTC.address, deployer)
      : d.aavePoolAdapterAsTC;

    if (badPathsParams?.useAaveTwoPoolMock) {
      if (badPathsParams?.ignoreBorrow) {
        await Aave3PoolMock__factory.connect(d.aavePool.address, deployer).setIgnoreBorrow();
      }
      if (badPathsParams?.skipSendingATokens) {
        await Aave3PoolMock__factory.connect(d.aavePool.address, deployer).setSkipSendingATokens();
      }
    }

    await borrower.borrow(d.collateralAmount, borrowAmount, d.userContract.address, {gasLimit: GAS_LIMIT});

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
        ? AaveTwoPoolAdapter__factory.connect(
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

      await payer.repay(
        amountToRepay,
        d.userContract.address,
        closePosition === undefined ? false : closePosition,
        {gasLimit: GAS_LIMIT}
      );
      return {
        userAccountData: await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address),
        repayResultsCollateralAmountOut,
      }
    } else {
      // make full repayment
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
    controller: ConverterController,
    collateralAsset: string,
    collateralHolder: string,
    collateralAmountNum: number,
    borrowAsset: string,
    changePriceFactor: number = 10
  ) : Promise<IPrepareToLiquidationResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = getBigNumberFrom(collateralAmountNum, collateralToken.decimals);

    const d = await AaveTwoTestUtils.prepareToBorrow(
      deployer,
      controller,
      collateralToken,
      collateralHolder,
      collateralAmount,
      borrowToken,
      {targetHealthFactor2: 200}
    );
    // make a borrow
    await AaveTwoTestUtils.makeBorrow(deployer, d, undefined);
    const statusAfterBorrow = await d.aavePoolAdapterAsTC.getStatus();
    console.log("statusAfterBorrow", statusAfterBorrow);

    // reduce price of collateral to reduce health factor below 1
    await AaveTwoChangePricesUtils.changeAssetPrice(deployer, d.collateralToken.address, false, changePriceFactor);

    const statusBeforeLiquidation = await d.aavePoolAdapterAsTC.getStatus();
    console.log("statusBeforeLiquidation", statusBeforeLiquidation);

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

    const aavePoolAsLiquidator = IAaveTwoPool__factory.connect(d.aavePool.address, liquidator);
    const amountToLiquidate = d.amountToBorrow.div(4); // userReserveData.currentVariableDebt.div(2);

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

  public static async getState(d: IPrepareToBorrowResults) : Promise<IAaveTwoPoolAdapterState> {
    const status = await d.aavePoolAdapterAsTC.getStatus();
    const collateralBalanceATokens = await d.aavePoolAdapterAsTC.collateralBalanceATokens();
    const accountState = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
    const balanceATokensForCollateral = await IERC20__factory.connect(
      d.collateralReserveInfo.aTokenAddress,
      await DeployerUtils.startImpersonate(d.aavePoolAdapterAsTC.address)
    ).balanceOf(d.aavePoolAdapterAsTC.address);
    return {status, collateralBalanceATokens, accountState, balanceATokensForCollateral};
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
