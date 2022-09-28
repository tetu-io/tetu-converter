import {BigNumber} from "ethers";
import {BalanceUtils, IUserBalances} from "../utils/BalanceUtils";
import {
  IPoolAdapter__factory,
  Borrower, BorrowManager__factory, IPlatformAdapter__factory
} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {MockTestInputParams, TestSingleBorrowParams, TestTwoBorrowsParams} from "../types/BorrowRepayDataTypes";
import {ILendingPlatformFabric} from "../fabrics/ILendingPlatformFabric";
import {TetuConverterApp} from "../helpers/TetuConverterApp";
import {MocksHelper} from "../helpers/MocksHelper";
import {areAlmostEqual, setInitialBalance} from "../utils/CommonUtils";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {BorrowAction} from "../actions/BorrowAction";
import {RepayAction} from "../actions/RepayAction";
import {RegisterPoolAdapterAction} from "../actions/RegisterPoolAdapterAction";
import {MockPlatformFabric} from "../fabrics/MockPlatformFabric";
import {BorrowMockAction} from "../actions/BorrowMockAction";
import {RepayMockAction} from "../actions/RepayMockAction";

export interface IBorrowAction {
  collateralToken: TokenDataTypes,
  collateralAmount: BigNumber;
  borrowToken: TokenDataTypes,
  doAction: (user: Borrower) => Promise<IUserBalances>;
}

export interface IRepayAction {
  collateralToken: TokenDataTypes,
  borrowToken: TokenDataTypes,
  /** if undefined - repay all and close position */
  amountToRepay: BigNumber | undefined;
  doAction: (user: Borrower) => Promise<IUserBalances>;
}

export interface IResultExpectations {
  /**
   * true for Hundred finance
   *    Hundred Finance has small supply fee, so result collateral can be a bit less than initial one
   * false for other protocols
   */
  resultCollateralCanBeLessThenInitial?: boolean
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
  ) : Promise<{
    userBalances: IUserBalances[],
    borrowBalances: BigNumber[]
  }>{
    const userBalances: IUserBalances[] = [];
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
    userBalances: IUserBalances[],
    borrowBalances: BigNumber[],
    totalBorrowedAmount: BigNumber,
    totalRepaidAmount: BigNumber,
    expectations: IResultExpectations,
    indexBorrow: number = 0,
    indexRepay: number = 1,
  ) : {sret: string, sexpected: string} {
    // console.log("c0", c0);
    // console.log("b0", b0);
    // console.log("collateralAmount", collateralAmount);
    // console.log("userBalances", userBalances);
    // console.log("borrowBalances", borrowBalances);
    // console.log("totalBorrowedAmount", totalBorrowedAmount);
    // console.log("totalRepaidAmount", totalRepaidAmount);
    const sret = [
      // collateral after borrow
      userBalances[indexBorrow].collateral
      // borrowed amount > 0
      , !totalBorrowedAmount.eq(BigNumber.from(0))
      // contract borrow balance - initial borrow balance == borrowed amount
      , userBalances[indexBorrow].borrow.sub(b0)

      // after repay
      // collateral >= initial collateral
      , expectations.resultCollateralCanBeLessThenInitial
        ? areAlmostEqual(userBalances[indexRepay].collateral, c0)
        : userBalances[indexRepay].collateral.gte(c0)
      // borrowed balance <= initial borrowed balance
      , b0.gte(userBalances[indexRepay].borrow)
      // contract borrowed balance is 0
      , borrowBalances[indexRepay]

      // paid amount >= borrowed amount
      , totalRepaidAmount.gte(totalBorrowedAmount)
    ].map(x => BalanceUtils.toString(x)).join("\n");

    const sexpected = [
      // collateral after borrow
      c0.sub(collateralAmount)
      // borrowed amount > 0
      , true
      // contract borrow balance == borrowed amount
      , totalBorrowedAmount

      //after repay
      // collateral >= initial collateral
      // TODO: hundred finance has supply fee, so we check collateral ~ initial collateral
      , true
      // borrowed balance <= initial borrowed balance
      , true
      // contract borrowed balance is 0
      , BigNumber.from(0)

      // paid amount >= borrowed amount
      , true

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
    userBalances: IUserBalances[],
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
      userBalances[indexLastBorrow].collateral
      // borrowed amount > 0
      , !totalBorrowedAmount.eq(BigNumber.from(0))
      // contract borrow balance - initial borrow balance == borrowed amount
      , userBalances[indexLastBorrow].borrow.sub(b0)

      // after repay
      // collateral >= initial collateral
      , expectations.resultCollateralCanBeLessThenInitial
        ? areAlmostEqual(userBalances[indexLastRepay].collateral, c0)
        : userBalances[indexLastRepay].collateral.gte(c0)

      // borrowed balance <= initial borrowed balance
      , b0.gte(userBalances[indexLastRepay].borrow)
      // contract borrowed balance is 0
      , borrowBalances[indexLastRepay]

      // paid amount >= borrowed amount
      , totalRepaidAmount.gte(totalBorrowedAmount)
    ].map(x => BalanceUtils.toString(x)).join("\n");

    const sexpected = [
      // collateral after borrow
      c0.sub(collateralAmount)
      // borrowed amount > 0
      , true
      // contract borrow balance ~ borrowed amount
      , totalBorrowedAmount

      //after repay
      // collateral >= initial collateral
      // TODO: aave can keep dust collateral on balance, so we check collateral ~ initial collateral
      , true
      // borrowed balance <= initial borrowed balance
      , true
      // contract borrowed balance is 0
      , BigNumber.from(0)

      // paid amount >= borrowed amount
      , true

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
    p: TestSingleBorrowParams,
    m: MockTestInputParams
  ) : Promise<{sret: string, sexpected: string}> {
    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const amountToRepay = undefined; //full repay

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
      pricesUSD.map((x, index) => BigNumber.from(10)
        .pow(18 - 2)
        .mul(x * 100))
    );
    const {tc, controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
    const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.healthFactor2, p.countBlocks);

    const c0 = await setInitialBalance(deployer
      , collateralToken.address
      , p.collateral.holder, p.collateral.initialLiquidity, uc.address);
    const b0 = await setInitialBalance(deployer
      , borrowToken.address
      , p.borrow.holder, p.borrow.initialLiquidity, uc.address);
    const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

    const {
      userBalances,
      borrowBalances
    } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer
      , uc
      , [
        new BorrowAction(
          collateralToken
          , collateralAmount
          , borrowToken
        ),
        new RepayAction(
          collateralToken
          , borrowToken
          , amountToRepay
          , {}
        )
      ]
    );

    return BorrowRepayUsesCase.getSingleBorrowSingleRepayResults(
      c0
      , b0
      , collateralAmount
      , userBalances
      , borrowBalances
      , await uc.totalBorrowedAmount()
      , await uc.totalRepaidAmount()
      , {
        resultCollateralCanBeLessThenInitial: false
      }
    );
  }

  static async makeTestSingleBorrowInstantRepayBase(
    deployer: SignerWithAddress,
    p: TestSingleBorrowParams,
    fabric: ILendingPlatformFabric,
    checkGasUsed: boolean = false,
  ) : Promise<{
    uc: Borrower
    ucBalanceCollateral0: BigNumber,
    ucBalanceBorrow0: BigNumber,
    collateralAmount: BigNumber,
    userBalances: IUserBalances[],
    borrowBalances: BigNumber[],
  }>{
    const {controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
    const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.healthFactor2, p.countBlocks);

    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const amountToRepay = undefined; //full repay

    const c0 = await setInitialBalance(deployer, collateralToken.address
      , p.collateral.holder, p.collateral.initialLiquidity, uc.address);
    const b0 = await setInitialBalance(deployer, borrowToken.address
      , p.borrow.holder, p.borrow.initialLiquidity, uc.address);
    const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

    const borrowAction = new BorrowAction(
      collateralToken
      , collateralAmount
      , borrowToken
      , p.countBlocks
      , checkGasUsed
    );

    const repayAction = new RepayAction(
      collateralToken
      , borrowToken
      , amountToRepay
      , {
        controlGas: checkGasUsed
      }
    );

    const preInitializePaAction = new RegisterPoolAdapterAction(
      collateralToken
      , collateralAmount
      , borrowToken
      , checkGasUsed
    );

    const {
      userBalances,
      borrowBalances
    } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer
      , uc
      , checkGasUsed
        ? [preInitializePaAction, borrowAction, repayAction]
        : [borrowAction, repayAction]
    );

    return {
      uc,
      ucBalanceCollateral0: c0,
      ucBalanceBorrow0: b0,
      borrowBalances,
      userBalances,
      collateralAmount,
    }
  }

  static async makeTestSingleBorrowInstantRepay(
    deployer: SignerWithAddress,
    p: TestSingleBorrowParams,
    fabric: ILendingPlatformFabric,
    expectations: IResultExpectations,
    checkGasUsed: boolean = false,
  ) : Promise<{
    sret: string,
    sexpected: string,
    gasUsedByBorrow?: BigNumber,
    gasUsedByRepay?: BigNumber,
    gasUsedByPaInitialization?: BigNumber
  }> {
    const r = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepayBase(deployer, p, fabric, checkGasUsed);

    const ret = BorrowRepayUsesCase.getSingleBorrowSingleRepayResults(
      r.ucBalanceCollateral0
      , r.ucBalanceBorrow0
      , r.collateralAmount
      , r.userBalances
      , r.borrowBalances
      , await r.uc.totalBorrowedAmount()
      , await r.uc.totalRepaidAmount()
      , expectations
    );

    return {
      sret: ret.sret,
      sexpected: ret.sexpected,
      gasUsedByPaInitialization: checkGasUsed ? r.userBalances[0].gasUsed : BigNumber.from(0),
      gasUsedByBorrow: checkGasUsed ? r.userBalances[1].gasUsed : BigNumber.from(0),
      gasUsedByRepay: checkGasUsed ? r.userBalances[2].gasUsed : BigNumber.from(0),
    };
  }
//endregion Test single borrow, single repay

//region Test two borrows, two repays
  static async makeTestTwoBorrowsTwoRepays_Mock(
    deployer: SignerWithAddress,
    p: TestTwoBorrowsParams,
    m: MockTestInputParams
  ) : Promise<{sret: string, sexpected: string}> {
    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const amountToRepay1 = getBigNumberFrom(p.repayAmount1, borrowToken.decimals);
    const amountToRepay2 = undefined; //full repay

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
      pricesUSD.map((x, index) => BigNumber.from(10)
        .pow(18 - 2)
        .mul(x * 100))
    );
    const {tc, controller, pools} = await TetuConverterApp.buildApp(deployer, [fabric]);
    const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.healthFactor2, p.countBlocks);

    const c0 = await setInitialBalance(deployer, collateralToken.address
      , p.collateral.holder, p.collateral.initialLiquidity, uc.address);
    const b0 = await setInitialBalance(deployer, borrowToken.address
      , p.borrow.holder, p.borrow.initialLiquidity, uc.address);

    const collateralAmount1 = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);
    const collateralAmount2 = getBigNumberFrom(p.collateralAmount2, collateralToken.decimals);

    // we need an address of the mock pool adapter, so let's initialize the pool adapter right now
    const bm = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
    const platformAdapter = IPlatformAdapter__factory.connect(await bm.platformAdaptersAt(0), deployer);
    const converter = (await platformAdapter.converters())[0];
    await bm.registerPoolAdapter(converter
      , uc.address
      , collateralToken.address
      , borrowToken.address
    );
    const poolAdapter = await bm.getPoolAdapter(converter
      , uc.address
      , collateralToken.address
      , borrowToken.address
    );

    const {
      userBalances,
      borrowBalances
    } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer
      , uc
      , [
        new BorrowMockAction(
          collateralToken
          , collateralAmount1
          , borrowToken
          , p.deltaBlocksBetweenBorrows
          , poolAdapter
        ),
        new BorrowMockAction(
          collateralToken
          , collateralAmount2
          , borrowToken
          , p.countBlocks
        ),
        new RepayMockAction(
          collateralToken
          , borrowToken
          , amountToRepay1
          , p.deltaBlocksBetweenRepays
          , poolAdapter
        ),
        new RepayMockAction(
          collateralToken
          , borrowToken
          , amountToRepay2
        ),
      ]
    );

    return BorrowRepayUsesCase.getTwoBorrowsTwoRepaysResults(
      c0
      , b0
      , collateralAmount1.add(collateralAmount2)
      , userBalances
      , borrowBalances
      , await uc.totalBorrowedAmount()
      , await uc.totalRepaidAmount()
      , {
        resultCollateralCanBeLessThenInitial: false
      }
    );
  }

  static async makeTestTwoBorrowsTwoRepays(
    deployer: SignerWithAddress,
    p: TestTwoBorrowsParams,
    fabric: ILendingPlatformFabric,
    expectations: IResultExpectations,
  ) : Promise<{sret: string, sexpected: string}> {
    const {tc, controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
    const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.healthFactor2, p.countBlocks);

    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const amountToRepay1 = getBigNumberFrom(p.repayAmount1, borrowToken.decimals);
    const amountToRepay2 = undefined; //full repay

    const c0 = await setInitialBalance(deployer, collateralToken.address
      , p.collateral.holder, p.collateral.initialLiquidity, uc.address);
    const b0 = await setInitialBalance(deployer, borrowToken.address
      , p.borrow.holder, p.borrow.initialLiquidity, uc.address);

    const collateralAmount1 = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);
    const collateralAmount2 = getBigNumberFrom(p.collateralAmount2, collateralToken.decimals);

    const {
      userBalances,
      borrowBalances
    } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer
      , uc
      , [
        new BorrowAction(
          collateralToken
          , collateralAmount1
          , borrowToken
          , p.deltaBlocksBetweenBorrows
        ),
        new BorrowAction(
          collateralToken
          , collateralAmount2
          , borrowToken
          , p.countBlocks
        ),
        new RepayAction(
          collateralToken
          , borrowToken
          , amountToRepay1
          , {
            countBlocksToSkipAfterAction: p.deltaBlocksBetweenRepays
          }

        ),
        new RepayAction(
          collateralToken
          , borrowToken
          , amountToRepay2
          , {}
        ),
      ]
    );

    return BorrowRepayUsesCase.getTwoBorrowsTwoRepaysResults(
      c0
      , b0
      , collateralAmount1.add(collateralAmount2)
      , userBalances
      , borrowBalances
      , await uc.totalBorrowedAmount()
      , await uc.totalRepaidAmount()
      , expectations
    );
  }
//endregion Test two borrows, two repays
}