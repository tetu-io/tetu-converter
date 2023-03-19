import {BigNumber} from "ethers";
import {BalanceUtils, IUserBalancesWithGas} from "../utils/BalanceUtils";
import {
  IPoolAdapter__factory,
  Borrower,
  BorrowManager__factory,
  IPlatformAdapter__factory,
  ITetuConverter__factory,
  ConverterController, IERC20__factory, TetuConverter__factory, IERC20Metadata__factory
} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {IMockTestInputParams, ITestSingleBorrowParams, ITestTwoBorrowsParams} from "../types/BorrowRepayDataTypes";
import {ILendingPlatformFabric} from "../fabrics/ILendingPlatformFabric";
import {TetuConverterApp} from "../helpers/TetuConverterApp";
import {MocksHelper} from "../helpers/MocksHelper";
import {areAlmostEqual, setInitialBalance} from "../utils/CommonUtils";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {BorrowAction} from "../actions/BorrowAction";
import {RepayAction} from "../actions/RepayAction";
import {MockPlatformFabric} from "../fabrics/MockPlatformFabric";
import {BorrowMockAction} from "../actions/BorrowMockAction";
import {RepayMockAction} from "../actions/RepayMockAction";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {makeInfinityApprove} from "../utils/transferUtils";
import {IStrategyToConvert} from "../apr/aprDataTypes";
import {RepayActionUsingSwap} from "../actions/RepayActionUsingSwap";
import {ClaimRewardsAction} from "../actions/ClaimRewardsAction";
import {parseUnits} from "ethers/lib/utils";

export interface IBorrowAction {
  collateralToken: TokenDataTypes,
  collateralAmount: BigNumber;
  borrowToken: TokenDataTypes,
  // eslint-disable-next-line no-unused-vars
  doAction: (user: Borrower) => Promise<IUserBalancesWithGas>;
}

export interface IRepayAction {
  collateralToken: TokenDataTypes,
  borrowToken: TokenDataTypes,
  /** if undefined - repay all and close position */
  amountToRepay: BigNumber | undefined;
  // eslint-disable-next-line no-unused-vars
  doAction: (user: Borrower) => Promise<IUserBalancesWithGas>;
}

export interface IResultExpectations {
  /**
   * true for HundredFinance.
   *    HundredFinance has small supply fee, so result collateral can be a bit less than initial one
   * false for other protocols
   */
  resultCollateralCanBeLessThenInitial?: boolean
}

export interface IMakeBorrowRepayActionsResults {
  userBalances: IUserBalancesWithGas[],
  borrowBalances: BigNumber[]
}

export interface IMakeSingleBorrowSingleFullRepayBaseResults {
  uc: Borrower;
  ucBalanceCollateral0: BigNumber;
  ucBalanceBorrow0: BigNumber;
  collateralAmount: BigNumber;
  userBalances: IUserBalancesWithGas[];
  borrowBalances: BigNumber[];
  strategyToConvert: IStrategyToConvert;
  rewardsInBorrowAssetReceived: BigNumber;
}

export interface IMakeTestSingleBorrowInstantRepayResults {
  sret: string;
  sexpected: string;
  gasUsedByBorrow: BigNumber;
  gasUsedByRepay: BigNumber;
}

export interface IMakeTwoBorrowsTwoRepaysResults {
  initialBalanceCollateral: BigNumber;
  initialBalanceBorrow: BigNumber;
  totalCollateralAmount: BigNumber;
  userBalances: IUserBalancesWithGas[];
  borrowBalances: BigNumber[];
  userContract: Borrower;
}

export interface IActionsResults {
  uc: Borrower;
  ucBalanceCollateral0: BigNumber;
  ucBalanceBorrow0: BigNumber;
  collateralAmount: BigNumber;
  userBalances: IUserBalancesWithGas[];
  borrowBalances: BigNumber[];
  strategyToConvert: IStrategyToConvert;
}

export interface IQuoteRepayResults extends IActionsResults {
  quoteRepayResultCollateralAmount: BigNumber;
  quoteRepayGasConsumption: BigNumber;
}

export class BorrowRepayUsesCase {
  /**
   * Perform a series of actions, control user balances and total borrow balance after each action.
   * We assume, that user has enough amount of collateral and borrow assets to make required actions.
   */
  static async makeBorrowRepayActions(
    signer: SignerWithAddress,
    user: Borrower,
    actions: (IBorrowAction | IRepayAction)[],
  ) : Promise<IMakeBorrowRepayActionsResults>{
    const userBalances: IUserBalancesWithGas[] = [];
    const borrowBalances: BigNumber[] = [];
    for (const action of actions) {
      const balances = await action.doAction(user);
      const poolAdapters: string[] = await user.getBorrows(action.collateralToken.address, action.borrowToken.address);
      console.log(poolAdapters);
      borrowBalances.push(
        await poolAdapters.reduce(
          async (prevPromise, curPoolAdapterAddress) => {
            return prevPromise.then(async prevValue => {
              const pa = IPoolAdapter__factory.connect(curPoolAdapterAddress, signer);
              const status = await pa.getStatus();
              return prevValue.add(status.amountToPay);
            });
          }
          , Promise.resolve(BigNumber.from(0))
        )
      );
      userBalances.push(balances);
    }
    return {userBalances, borrowBalances};
  }

//region Utils
  static getSingleBorrowSingleRepayResults(
    c0: BigNumber,
    b0: BigNumber,
    collateralAmount: BigNumber,
    userBalances: IUserBalancesWithGas[],
    borrowBalances: BigNumber[],
    totalBorrowedAmount: BigNumber,
    totalRepaidAmount: BigNumber,
    expectations: IResultExpectations,
    indexBorrow: number = 0,
    indexRepay: number = 2,
  ) : {sret: string, sexpected: string} {
    console.log("c0", c0);
    console.log("b0", b0);
    console.log("collateralAmount", collateralAmount);
    console.log("userBalances", userBalances);
    console.log("borrowBalances", borrowBalances);
    console.log("totalBorrowedAmount", totalBorrowedAmount);
    console.log("totalRepaidAmount", totalRepaidAmount);
    const sret = [
      // collateral after borrow
      userBalances[indexBorrow].collateral,
      // borrowed amount > 0
      !totalBorrowedAmount.eq(BigNumber.from(0)),
      // contract borrow balance - initial borrow balance == borrowed amount
      userBalances[indexBorrow].borrow.sub(b0),

      // after repay
      // collateral >= initial collateral
      expectations.resultCollateralCanBeLessThenInitial
        ? areAlmostEqual(userBalances[indexRepay].collateral, c0)
        : userBalances[indexRepay].collateral.gte(c0),
      // borrowed balance <= initial borrowed balance
      b0.gte(userBalances[indexRepay].borrow),
      // contract borrowed balance is 0
      borrowBalances[indexRepay],

      // paid amount >= borrowed amount
      totalRepaidAmount.gte(totalBorrowedAmount),
    ].map(x => BalanceUtils.toString(x)).join("\n");

    const sexpected = [
      // collateral after borrow
      c0.sub(collateralAmount),
      // borrowed amount > 0
      true,
      // contract borrow balance == borrowed amount
      totalBorrowedAmount,

      // after repay
      // collateral >= initial collateral
      // TODO: hundred finance has supply fee, so we check collateral ~ initial collateral
      true,
      // borrowed balance <= initial borrowed balance
      true,
      // contract borrowed balance is 0
      BigNumber.from(0),

      // paid amount >= borrowed amount
      true

    ].map(x => BalanceUtils.toString(x)).join("\n");

    console.log(`after borrow: collateral=${userBalances[0].collateral.toString()} borrow=${userBalances[0].borrow.toString()} borrowBalance=${borrowBalances[0].toString()}`);
    console.log(`after repay: collateral=${userBalances[1].collateral.toString()} borrow=${userBalances[1].borrow.toString()} borrowBalance=${borrowBalances[1].toString()}`);
    console.log(`borrowedAmount: ${totalBorrowedAmount} paidAmount: ${totalRepaidAmount}`);

    return {sret, sexpected};
  }

  static getTwoBorrowsTwoRepaysResults(
    c0: BigNumber,
    b0: BigNumber,
    collateralAmount: BigNumber,
    userBalances: IUserBalancesWithGas[],
    borrowBalances: BigNumber[],
    totalBorrowedAmount: BigNumber,
    totalRepaidAmount: BigNumber,
    expectations: IResultExpectations,
    indexLastBorrow: number = 1,
    indexLastRepay: number = 3,
  ) : {sret: string, sexpected: string} {
    console.log("c0", c0);
    console.log("b0", b0);
    console.log("collateralAmount", collateralAmount);
    console.log("userBalances", userBalances);
    console.log("borrowBalances", borrowBalances);
    console.log("totalBorrowedAmount", totalBorrowedAmount);
    console.log("totalRepaidAmount", totalRepaidAmount);
    const sret = [
      // collateral after borrow 2
      userBalances[indexLastBorrow].collateral,
      // borrowed amount > 0
      !totalBorrowedAmount.eq(BigNumber.from(0)),
      // contract borrow balance - initial borrow balance == borrowed amount
      userBalances[indexLastBorrow].borrow.sub(b0),

      // after repay
      // collateral >= initial collateral
      expectations.resultCollateralCanBeLessThenInitial
        ? areAlmostEqual(userBalances[indexLastRepay].collateral, c0)
        : userBalances[indexLastRepay].collateral.gte(c0),

      // borrowed balance <= initial borrowed balance
      b0.gte(userBalances[indexLastRepay].borrow),
      // contract borrowed balance is 0
      borrowBalances[indexLastRepay],

      // paid amount >= borrowed amount
      totalRepaidAmount.gte(totalBorrowedAmount),
    ].map(x => BalanceUtils.toString(x)).join("\n");

    const sexpected = [
      // collateral after borrow
      c0.sub(collateralAmount),
      // borrowed amount > 0
      true,
      // contract borrow balance ~ borrowed amount
      totalBorrowedAmount,

      // after repay
      // collateral >= initial collateral
      // TODO: aave can keep dust collateral on balance, so we check collateral ~ initial collateral
      true,
      // borrowed balance <= initial borrowed balance
      true,
      // contract borrowed balance is 0
      BigNumber.from(0),

      // paid amount >= borrowed amount
      true,
    ].map(x => BalanceUtils.toString(x)).join("\n");

    console.log(`after borrow: collateral=${userBalances[1].collateral.toString()} borrow=${userBalances[1].borrow.toString()} borrowBalance=${borrowBalances[1].toString()}`);
    console.log(`after repay: collateral=${userBalances[3].collateral.toString()} borrow=${userBalances[3].borrow.toString()} borrowBalance=${borrowBalances[3].toString()}`);
    console.log(`borrowedAmount: ${totalBorrowedAmount} paidAmount: ${totalRepaidAmount}`);

    return {sret, sexpected};
  }
//endregion Utils

//region Test single borrow, single repay
  static async makeTestSingleBorrowInstantRepay_Mock(
    deployer: SignerWithAddress,
    p: ITestSingleBorrowParams,
    m: IMockTestInputParams
  ) : Promise<{sret: string, sexpected: string}> {
    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const amountToRepay = undefined; // full repay

    const underlying = [p.collateral.asset, p.borrow.asset];
    const pricesUSD = [1, 1];
    const cTokenDecimals = [m.collateral.decimals, m.borrow.decimals];
    const cTokens = await MocksHelper.createCTokensMocks(deployer, underlying, cTokenDecimals);

    const fabric = new MockPlatformFabric(
      underlying,
      [m.collateral.borrowRate, m.borrow.borrowRate],
      [m.collateral.collateralFactor, m.borrow.collateralFactor],
      [m.collateral.liquidity, m.borrow.liquidity],
      [p.collateral.holder, p.borrow.holder],
      cTokens,
      pricesUSD.map((x) => BigNumber.from(10)
        .pow(18 - 2)
        .mul(x * 100))
    );
    const {controller} = await TetuConverterApp.buildApp(
      deployer,
      [fabric],
      {}
    );
    const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.countBlocks);

    const c0 = await setInitialBalance(deployer,
      collateralToken.address,
      p.collateral.holder, p.collateral.initialLiquidity, uc.address);
    const b0 = await setInitialBalance(deployer,
      borrowToken.address,
      p.borrow.holder, p.borrow.initialLiquidity, uc.address);
    const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);
    console.log("Balance of collateral of the user", await collateralToken.token.balanceOf(uc.address));
    console.log("Balance of borrow of the user", await borrowToken.token.balanceOf(uc.address));

    const {
      userBalances,
      borrowBalances
    } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer,
      uc,
      [
        new BorrowAction(
          collateralToken,
          collateralAmount,
          borrowToken,
        ),
        new RepayAction(
          collateralToken,
          borrowToken,
          amountToRepay,
          {}
        )
      ]
    );

    return BorrowRepayUsesCase.getSingleBorrowSingleRepayResults(
      c0,
      b0,
      collateralAmount,
      userBalances,
      borrowBalances,
      await uc.totalBorrowedAmount(),
      await uc.totalAmountBorrowAssetRepaid(),
      {
        resultCollateralCanBeLessThenInitial: false
      },
      0,
      1
    );
  }

  static async makeSingleBorrowSingleFullRepayBase(
    deployer: SignerWithAddress,
    p: ITestSingleBorrowParams,
    controller: ConverterController,
    countBlocksToSkipAfterBorrow?: number
  ) : Promise<IMakeSingleBorrowSingleFullRepayBaseResults>{
    const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.countBlocks);

    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const amountToRepay = undefined; // full repay

    const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);
    const initialLiquidityCollateral0 = getBigNumberFrom(p.collateral.initialLiquidity, collateralToken.decimals);
    const initialLiquidityBorrow0 = getBigNumberFrom(p.borrow.initialLiquidity, collateralToken.decimals);

    // set up initial liquidity for borrow and collateral assets
    // these liquidity can be set manually (!== 0) or calculated automatically (=== 0)
    // For automatic calculation we assume following:
    // p.collateral.initialLiquidity === 0: we need to get all available amount from the holder
    // p.borrow.initialLiquidity === 0: let's take some amount from the holder (we need amount > 0 to be able to repay)
    const initialLiquidityCollateral = initialLiquidityCollateral0.eq(0)
      ? collateralAmount
      : initialLiquidityCollateral0;
    const initialLiquidityBorrow = initialLiquidityBorrow0.eq(0)
      ? (await IERC20__factory.connect(p.borrow.asset, deployer).balanceOf(p.borrow.holder)).div(10)
      : initialLiquidityBorrow0;


    const ucBalanceCollateral0 = await setInitialBalance(deployer,
      collateralToken.address,
      p.collateral.holder,
      initialLiquidityCollateral,
      uc.address
    );
    const ucBalanceBorrow0 = await setInitialBalance(deployer,
      borrowToken.address,
      p.borrow.holder,
      initialLiquidityBorrow,
      uc.address
    );

    const tetuConverter = ITetuConverter__factory.connect(await controller.tetuConverter(), deployer);
    await IERC20__factory.connect(collateralToken.address, await DeployerUtils.startImpersonate(uc.address)).approve(
      tetuConverter.address,
      collateralAmount
    );
    const tetuConverterAsUser = await TetuConverter__factory.connect(
      await controller.tetuConverter(),
      await DeployerUtils.startImpersonate(uc.address)
    );
    const strategyToConvert: IStrategyToConvert = await tetuConverterAsUser.callStatic.findConversionStrategy(
      "0x",
      p.collateral.asset,
      collateralAmount,
      p.borrow.asset,
      p.countBlocks,
    );

    // TetuConverter gives infinity approve to the pool adapter after pool adapter creation (see TetuConverter.convert implementation)
    const borrowAction = new BorrowAction(collateralToken, strategyToConvert.collateralAmountOut, borrowToken, p.countBlocks);
    const repayAction = (strategyToConvert.converter.toLowerCase() === (await controller.swapManager()).toLowerCase())
      ? new RepayActionUsingSwap(controller, collateralToken, borrowToken, ucBalanceBorrow0)
      : new RepayAction(collateralToken, borrowToken, amountToRepay, {countBlocksToSkipAfterAction: countBlocksToSkipAfterBorrow});
    const claimRewardsAction = new ClaimRewardsAction(controller, collateralToken, borrowToken);


    const {
      userBalances,
      borrowBalances
    } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer, uc, [borrowAction, claimRewardsAction, repayAction]);

    return {
      uc,
      ucBalanceCollateral0,
      ucBalanceBorrow0,
      borrowBalances,
      userBalances,
      collateralAmount: strategyToConvert.collateralAmountOut,
      strategyToConvert,
      rewardsInBorrowAssetReceived: claimRewardsAction.rewardsInBorrowAssetReceived
    }
  }

  static async makeTestSingleBorrowInstantRepay(
    deployer: SignerWithAddress,
    p: ITestSingleBorrowParams,
    fabric: ILendingPlatformFabric,
    expectations: IResultExpectations,
  ) : Promise<IMakeTestSingleBorrowInstantRepayResults> {
    const {controller} = await TetuConverterApp.buildApp(
      deployer,
      [fabric],
      {} // disable swap
    );
    const r = await BorrowRepayUsesCase.makeSingleBorrowSingleFullRepayBase(deployer, p, controller);

    const ret = BorrowRepayUsesCase.getSingleBorrowSingleRepayResults(
      r.ucBalanceCollateral0,
      r.ucBalanceBorrow0,
      r.collateralAmount,
      r.userBalances,
      r.borrowBalances,
      await r.uc.totalBorrowedAmount(),
      await r.uc.totalAmountBorrowAssetRepaid(),
      expectations
    );

    return {
      sret: ret.sret,
      sexpected: ret.sexpected,
      gasUsedByBorrow: r.userBalances[0].gasUsed,
      gasUsedByRepay: r.userBalances[2].gasUsed,
    };
  }
//endregion Test single borrow, single repay

//region Test two borrows, two repays
  static async makeTwoBorrowsTwoRepays_Mock(
    deployer: SignerWithAddress,
    p: ITestTwoBorrowsParams,
    m: IMockTestInputParams
  ) : Promise<{sret: string, sexpected: string}> {
    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const amountToRepay1 = getBigNumberFrom(p.repayAmount1, borrowToken.decimals);
    const amountToRepay2 = undefined; // full repay

    const underlyings = [p.collateral.asset, p.borrow.asset];
    const pricesUSD = [1, 1];
    const cTokenDecimals = [m.collateral.decimals, m.borrow.decimals];
    const cTokens = await MocksHelper.createCTokensMocks(deployer, underlyings, cTokenDecimals);

    const fabric = new MockPlatformFabric(
      underlyings,
      [m.collateral.borrowRate, m.borrow.borrowRate],
      [m.collateral.collateralFactor, m.borrow.collateralFactor],
      [m.collateral.liquidity, m.borrow.liquidity],
      [p.collateral.holder, p.borrow.holder],
      cTokens,
      pricesUSD.map((x) => BigNumber.from(10)
        .pow(18 - 2)
        .mul(x * 100))
    );
    const {controller} = await TetuConverterApp.buildApp(
      deployer,
      [fabric],
      {} // disable swap
    );
    const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.countBlocks);

    const c0 = await setInitialBalance(deployer, collateralToken.address,
      p.collateral.holder, p.collateral.initialLiquidity, uc.address);
    const b0 = await setInitialBalance(deployer, borrowToken.address,
      p.borrow.holder, p.borrow.initialLiquidity, uc.address);

    const collateralAmount1 = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);
    const collateralAmount2 = getBigNumberFrom(p.collateralAmount2, collateralToken.decimals);

    // we need an address of the mock pool adapter, so let's initialize the pool adapter right now
    const bm = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
    const platformAdapter = IPlatformAdapter__factory.connect(await bm.platformAdaptersAt(0), deployer);
    const bmAsTc = BorrowManager__factory.connect(await controller.borrowManager(),
      await DeployerUtils.startImpersonate(await controller.tetuConverter())
    );
    const converter = (await platformAdapter.converters())[0];
    await bmAsTc.registerPoolAdapter(converter,
      uc.address,
      collateralToken.address,
      borrowToken.address,
    );
    const poolAdapter = await bm.getPoolAdapter(converter,
      uc.address,
      collateralToken.address,
      borrowToken.address,
    );
    // TetuConverter gives infinity approve to the pool adapter after pool adapter creation (see TetuConverter.convert implementation)
    await makeInfinityApprove(
      await controller.tetuConverter(),
      poolAdapter,
      collateralToken.address,
      borrowToken.address
    );

    const {
      userBalances,
      borrowBalances
    } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer,
      uc,
      [
        new BorrowMockAction(
          collateralToken,
          collateralAmount1,
          borrowToken,
          p.deltaBlocksBetweenBorrows,
          poolAdapter,
        ),
        new BorrowMockAction(
          collateralToken,
          collateralAmount2,
          borrowToken,
          p.countBlocks,
        ),
        new RepayMockAction(
          collateralToken,
          borrowToken,
          amountToRepay1,
          p.deltaBlocksBetweenRepays,
          poolAdapter,
        ),
        new RepayMockAction(
          collateralToken,
          borrowToken,
          amountToRepay2,
        ),
      ]
    );

    return BorrowRepayUsesCase.getTwoBorrowsTwoRepaysResults(
      c0,
      b0,
      collateralAmount1.add(collateralAmount2),
      userBalances,
      borrowBalances,
      await uc.totalBorrowedAmount(),
      await uc.totalAmountBorrowAssetRepaid(),
      {
        resultCollateralCanBeLessThenInitial: false
      }
    );
  }

  static async makeTwoBorrowsTwoRepays(
    deployer: SignerWithAddress,
    p: ITestTwoBorrowsParams,
    fabric: ILendingPlatformFabric,
  ) : Promise<IMakeTwoBorrowsTwoRepaysResults> {
    const {controller} = await TetuConverterApp.buildApp(
      deployer,
      [fabric],
      {} // disable swap
    );
    const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.countBlocks);

    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const amountToRepay1 = getBigNumberFrom(p.repayAmount1, borrowToken.decimals);
    const amountToRepay2 = undefined; // full repay

    const initialBalanceCollateral = await setInitialBalance(deployer, collateralToken.address,
      p.collateral.holder, p.collateral.initialLiquidity, uc.address);
    const initialBalanceBorrow = await setInitialBalance(deployer, borrowToken.address,
      p.borrow.holder, p.borrow.initialLiquidity, uc.address);

    const collateralAmount1 = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);
    const collateralAmount2 = getBigNumberFrom(p.collateralAmount2, collateralToken.decimals);

    const {
      userBalances,
      borrowBalances
    } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer,
      uc,
      [
        new BorrowAction(collateralToken, collateralAmount1, borrowToken, p.deltaBlocksBetweenBorrows),
        new BorrowAction(collateralToken, collateralAmount2, borrowToken, p.countBlocks),
        new RepayAction(collateralToken, borrowToken, amountToRepay1, {countBlocksToSkipAfterAction: p.deltaBlocksBetweenRepays}),
        new RepayAction(collateralToken, borrowToken, amountToRepay2, {}),
      ]
    );

    return {
      borrowBalances,
      userBalances,
      initialBalanceBorrow,
      initialBalanceCollateral,
      totalCollateralAmount: collateralAmount1.add(collateralAmount2),
      userContract: uc
    }
  }

  static async makeTwoBorrowsTwoRepaysTest(
    deployer: SignerWithAddress,
    p: ITestTwoBorrowsParams,
    fabric: ILendingPlatformFabric,
    expectations: IResultExpectations,
  ) : Promise<{sret: string, sexpected: string}> {
    const r = await this.makeTwoBorrowsTwoRepays(deployer, p, fabric);

    return BorrowRepayUsesCase.getTwoBorrowsTwoRepaysResults(
      r.initialBalanceCollateral,
      r.initialBalanceBorrow,
      r.totalCollateralAmount,
      r.userBalances,
      r.borrowBalances,
      await r.userContract.totalBorrowedAmount(),
      await r.userContract.totalAmountBorrowAssetRepaid(),
      expectations,
    );
  }
//endregion Test two borrows, two repays

//region borrow, quoteRepay, repay
  static async makeQuoteRepay(
    deployer: SignerWithAddress,
    p: ITestSingleBorrowParams,
    controller: ConverterController,
    countBlocksToSkipAfterBorrow?: number,
    additionalAmountToPassToQuoteRepay?: number
  ) : Promise<IQuoteRepayResults>{
    const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.countBlocks);

    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const amountToRepay = undefined; // full repay

    // let's pass additional amount to quoteRepay
    // as result, swapping code will be used, and we will be able to estimate a gas for full quoteRepay code
    if (additionalAmountToPassToQuoteRepay) {
      await uc.setAdditionalAmountForQuoteRepay(
        parseUnits(additionalAmountToPassToQuoteRepay.toString(), borrowToken.decimals)
      )
    }

    const ucBalanceCollateral0 = await setInitialBalance(deployer, collateralToken.address,
      p.collateral.holder, p.collateral.initialLiquidity, uc.address);
    const ucBalanceBorrow0 = await setInitialBalance(deployer, borrowToken.address,
      p.borrow.holder, p.borrow.initialLiquidity, uc.address);
    const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

    const tetuConverter = ITetuConverter__factory.connect(await controller.tetuConverter(), deployer);
    await IERC20__factory.connect(collateralToken.address, await DeployerUtils.startImpersonate(uc.address)).approve(
      tetuConverter.address,
      collateralAmount
    );
    const tetuConverterAsUser = await TetuConverter__factory.connect(
      await controller.tetuConverter(),
      await DeployerUtils.startImpersonate(uc.address)
    );
    const strategyToConvert: IStrategyToConvert = await tetuConverterAsUser.callStatic.findConversionStrategy(
      "0x",
      p.collateral.asset,
      collateralAmount,
      p.borrow.asset,
      p.countBlocks,
    );

    // TetuConverter gives infinity approve to the pool adapter after pool adapter creation (see TetuConverter.convert implementation)
    const borrowAction = new BorrowAction(collateralToken, collateralAmount, borrowToken, p.countBlocks);
    const repayAction = new RepayAction(collateralToken, borrowToken, amountToRepay, {countBlocksToSkipAfterAction: countBlocksToSkipAfterBorrow});
    const {
      userBalances,
      borrowBalances
    } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer, uc, [borrowAction, repayAction]);

    return {
      uc,
      ucBalanceCollateral0,
      ucBalanceBorrow0,
      borrowBalances,
      userBalances,
      collateralAmount,
      strategyToConvert,
      quoteRepayResultCollateralAmount: await uc.lastQuoteRepayResultCollateralAmount(),
      quoteRepayGasConsumption: await uc.lastQuoteRepayGasConsumption()
    }
  }
//endregion borrow, quoteRepay, repay

//region borrow only
  static async makeBorrow(
    deployer: SignerWithAddress,
    p: ITestSingleBorrowParams,
    controller: ConverterController
  ) : Promise<IActionsResults>{
    const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.countBlocks);

    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const ucBalanceCollateral0 = await setInitialBalance(deployer, collateralToken.address,
      p.collateral.holder, p.collateral.initialLiquidity, uc.address);
    const ucBalanceBorrow0 = await setInitialBalance(deployer, borrowToken.address,
      p.borrow.holder, p.borrow.initialLiquidity, uc.address);
    const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

    const tetuConverter = ITetuConverter__factory.connect(await controller.tetuConverter(), deployer);
    await IERC20__factory.connect(collateralToken.address, await DeployerUtils.startImpersonate(uc.address)).approve(
      tetuConverter.address,
      collateralAmount
    );
    const tetuConverterAsUser = await TetuConverter__factory.connect(
      await controller.tetuConverter(),
      await DeployerUtils.startImpersonate(uc.address)
    );
    const strategyToConvert: IStrategyToConvert = await tetuConverterAsUser.callStatic.findConversionStrategy(
      "0x",
      p.collateral.asset,
      collateralAmount,
      p.borrow.asset,
      p.countBlocks,
    );

    // TetuConverter gives infinity approve to the pool adapter after pool adapter creation (see TetuConverter.convert implementation)
    const borrowAction = new BorrowAction(collateralToken, collateralAmount, borrowToken, p.countBlocks);
    const {
      userBalances,
      borrowBalances
    } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer, uc, [borrowAction]);

    return {
      uc,
      ucBalanceCollateral0,
      ucBalanceBorrow0,
      borrowBalances,
      userBalances,
      collateralAmount,
      strategyToConvert,
    }
  }
//endregion borrow only
}
