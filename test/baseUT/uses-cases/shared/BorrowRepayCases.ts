import {IPoolAdapterStatusNum} from "../../types/BorrowRepayDataTypes";
import {
  Bookkeeper, Bookkeeper__factory,
  BorrowManager__factory,
  ConverterController__factory,
  IERC20__factory,
  IERC20Metadata__factory,
  IPoolAdapter__factory,
  ITetuConverter,
  UserEmulator
} from "../../../../typechain";
import {BigNumber, BytesLike} from "ethers";
import {IConversionPlanNum} from "../../types/AppDataTypes";
import {AppConstants} from "../../types/AppConstants";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BalanceUtils} from "../../utils/BalanceUtils";
import {BorrowRepayDataTypeUtils} from "../../utils/BorrowRepayDataTypeUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";

export interface IBorrowRepaySetup {
  tetuConverter: ITetuConverter;
  user: UserEmulator;
  collateralAsset: string;
  borrowAsset: string;
  collateralAssetHolder: string;
  borrowAssetHolder: string;
  userBorrowAssetBalance?: string;
  userCollateralAssetBalance?: string;
  /** Receive all borrowed and repay amounts. User by default */
  receiver?: string;

  additionalCollateralAssetHolders?: string[];
}

export interface IBorrowPairParams {
  /** AmountIn to borrow. It's set in collateral asset for entry kinds 0 and 1 and in borrow asset for entry kind 2 */
  amountIn: string;

  /** False - direct debt, true - reverse debt */
  reverseDebt?: boolean; // false by default
  exactAmountOut?: string; // 0 by default, it means that max amount should be borrowed
  entryData?: string; // 0x1 by default
  isAmountInBorrowAsset?: boolean; // false by default
}

export interface IRepayPairParams {
  /** False - direct debt, true - reverse debt */
  repayReverseDebt?: boolean;
  /** 100_000 = 100% */
  repayPart: number;
  /** Don't use repayPart, pay exactAmount instead */
  exactAmount?: string;
}

/**
 * Params for 1) borrow 2) repay
 * Both actions are optional
 */
export interface IBorrowRepayPairParams {
  borrow?: IBorrowPairParams;
  repay?: IRepayPairParams;
}

export interface IBorrowResults {
  collateralAsset: string;
  borrowAsset: string;
  converter: string;
  borrowedAmount: number;
}

export interface IRepayResults {
  collateralAsset: string;
  borrowAsset: string;
  /* amount of borrowed asset received back */
  borrowedAmount: number;
  /* amount of collateral asset received back */
  collateralAmount: number;
  /* A part of collateral received through the swapping */
  swappedLeftoverCollateral: number;
  /* A part of repaid amount that was swapped */
  swappedLeftoverBorrow: number;
}

export interface IBorrowRepayPairResults {
  borrow: IBorrowResults[];
  repay: IRepayResults[];

  receiverCollateralAssetBalance: number;
  receiverBorrowAssetBalance: number;

  userCollateralAssetBalance: number;
  userBorrowAssetBalance: number;

  tetuConverterCollateralAssetBalance: number;
  tetuConverterBorrowAssetBalance: number;

  status: IPoolAdapterStatusNum;
}

export interface IAction {
  suppliedAmount: number;
  borrowedAmount: number;
  actionKind: number;
  repayInfo: {
    gain: number;
    loss: number;
    prices: number[];
  }
}

export interface ICheckpoint {
  suppliedAmount: number;
  borrowedAmount: number;
  totalCollateral: number;
  totalDebt: number;
  countActions: number;
}

export interface IBookkeeperStatus {
  actions: IAction[];
  poolAdaptersForUser: string[];
  checkpoint: ICheckpoint;
}

export interface IBookkeeperStatusWithResults extends IBookkeeperStatus{
  results: IBorrowRepayPairResults;
}


interface IBorrowCommandResults {
  /** Status of the first (single available) pool adapter after borrow */
  statusAfterBorrow: IPoolAdapterStatusNum;
  gasUsedByBorrow: BigNumber;
  plan: IConversionPlanNum;
}

interface IRepayCommandResults {
  /** Status of the first (single available) pool adapter after repay */
  statusAfterRepay: IPoolAdapterStatusNum;
  gasUsedByRepay: BigNumber;
}

/**
 * Params for 1) borrow 2) repay
 * and for additional commands before/after the actions
 * (change health factor, move time and so on)
 */
interface IBorrowRepayCommandParams extends IBorrowRepayPairParams {
  /** set up min health factor to the given value before the borrow */
  healthFactorMin?: string;
  /** set up target health factor to the given value before the borrow */
  healthFactorTarget?: string;
  /** Count blocks between borrow and repay, 0 by default */
  countBlocksAfterBorrow?: number;
  /** Count blocks after repay, 0 by default */
  countBlocksAfterRepay?: number;
}

interface IBorrowRepayCommandResults {
  borrowResults?: IBorrowCommandResults;
  repayResults?: IRepayCommandResults;

  /** User balance of the collateral asset after repay */
  userCollateralAssetBalance: string;
  /** User balance of the borrow asset after repay */
  userBorrowAssetBalance: string;
}

export interface IHealthFactorsPair {
  minValue: string;
  targetValue: string;

  /** It's enough to run the test with given params on single (first available) asset paris only */
  singleAssetPairOnly?: boolean;

  /** Target health factor is too small (platform adapter doesn't allow to make borrow with such health factor) */
  tooSmallTargetHealthFactorCase?: boolean;
}

/** Params for tests "Borrow/repay single action per block" */
export interface IBorrowRepaySingleActionParams {
  userBorrowAssetBalance: string;
  userCollateralAssetBalance: string;
  collateralAmount: string;
  collateralAmountSecond: string;

  userBorrowAssetBalanceTinyAmount: string;
  userCollateralAssetBalanceTinyAmount: string;
  collateralAmountTiny: string;

  userBorrowAssetBalanceHugeAmount: string;
}

/** Params for tests "Borrow/repay multiple actions per block" */
export interface IBorrowRepayMultipleActionParams {
  userBorrowAssetBalance: string;
  userCollateralAssetBalance: string;
  userCollateralAssetBalanceSecond: string;
  collateralAmount1: string;
  collateralAmount2: string;
  collateralAmountSecond: string;
}

export interface IAssetsPairConfig {
  collateralAsset: string;
  borrowAsset: string;
  collateralAssetName: string;
  borrowAssetName: string;

  /**
   * By default, a borrow is made with required target health factor.
   * In the case of very low target health factor (i.e. 1.03) it can be less than min allowed health factor
   * (i.e. on aave2: liquidationThreshold18/LTV = 1.0625)
   * So, in the tests that check result health factor we should use following value if it specified.
   *
   * "0" - disable tooSmallTargetHealthFactorCase
   */
  minTargetHealthFactor?: string;

  singleParams?: IBorrowRepaySingleActionParams;
  multipleParams?: IBorrowRepayMultipleActionParams;

  skipCheckingNotZeroGains?: boolean; // false by default
}

interface IRepayToRebalanceParams {
  amount: string;
  isCollateral: boolean;
  userBorrowAssetBalance?: string;
  userCollateralAssetBalance?: string;
  targetHealthFactor: string;
}


export class BorrowRepayCases {
  /** Make sequence of [borrow], [repay] actions in a single block */
  static async borrowRepayPairsSingleBlock(signer: SignerWithAddress, p: IBorrowRepaySetup, pairs: IBorrowRepayPairParams[]): Promise<IBorrowRepayPairResults> {
    const collateralAsset = await IERC20Metadata__factory.connect(p.collateralAsset, signer);
    const borrowAsset = await IERC20Metadata__factory.connect(p.borrowAsset, signer);
    const decimalsCollateral = await collateralAsset.decimals();
    const decimalsBorrow = await borrowAsset.decimals();

    // set up user-emulator balances
    if (p.userCollateralAssetBalance) {
      if (Number(p.userCollateralAssetBalance) === Number.MAX_SAFE_INTEGER) {
        // todo await TokenUtils.getToken(p.collateralAsset, p.user.address, requiredAmount)
        await BalanceUtils.getRequiredAmountFromHolders(
          undefined,
          await IERC20Metadata__factory.connect(p.collateralAsset, signer),
          p.additionalCollateralAssetHolders
            ? [p.collateralAssetHolder, ...p.additionalCollateralAssetHolders]
            : [p.collateralAssetHolder],
          p.user.address
        );
      } else {
        // await TokenUtils.getToken(p.collateralAsset, p.user.address, parseUnits(p.userCollateralAssetBalance, decimalsCollateral));
        await BalanceUtils.getAmountFromHolder(p.collateralAsset, p.collateralAssetHolder, p.user.address, parseUnits(p.userCollateralAssetBalance, decimalsCollateral));
      }
    }
    if (p.userBorrowAssetBalance) {
      // await TokenUtils.getToken(p.borrowAsset, p.user.address, parseUnits(p.userBorrowAssetBalance, decimalsBorrow));
      await BalanceUtils.getAmountFromHolder(p.borrowAsset, p.borrowAssetHolder, p.user.address, parseUnits(p.userBorrowAssetBalance, decimalsBorrow));
    }

    // prepare sequence of borrow-repay pairs
    const actionKinds: number[] = [];
    const amountsIn: BigNumber[] = [];
    const amountsOut: BigNumber[] = [];
    const entryData: BytesLike[] = [];
    const receivers: string[] = [];

    const borrowIndices: number[] = [];
    const borrowDirect: boolean[] = [];
    const repayIndices: number[] = [];
    const repayDirect: boolean[] = [];

    for (const pair of pairs) {
      // prepare borrow
      if (pair.borrow) {
        actionKinds.push(pair.borrow.reverseDebt ? AppConstants.BORROW_REVERSE_1 : AppConstants.BORROW_DIRECT_0);
        amountsIn.push(
          pair.borrow.amountIn === "0" || pair.borrow.amountIn === Number.MAX_SAFE_INTEGER.toString() // max available amount
            ? await IERC20__factory.connect(p.collateralAsset, signer).balanceOf(p.user.address)
            : parseUnits(pair.borrow.amountIn, pair.borrow.reverseDebt ? decimalsBorrow : decimalsCollateral)
        );
        amountsOut.push(
          parseUnits(pair.borrow.exactAmountOut ?? "0", pair.borrow.reverseDebt ? decimalsCollateral : decimalsBorrow)
        );
        entryData.push(pair.borrow.entryData ?? "0x");
        receivers.push(p.receiver ?? p.user.address);
        borrowIndices.push(actionKinds.length - 1);
        borrowDirect.push(!pair.borrow.reverseDebt);
      }

      // prepare repay
      if (pair.repay) {
        actionKinds.push(pair.repay.repayReverseDebt ? AppConstants.REPAY_REVERSE_3 : AppConstants.REPAY_DIRECT_2);
        amountsIn.push(
          parseUnits(pair.repay.exactAmount ?? "0", pair.repay.repayReverseDebt ? decimalsCollateral : decimalsBorrow)
        );
        amountsOut.push(BigNumber.from(pair.repay.repayPart ?? 0));
        entryData.push("0x"); // not used
        receivers.push(p.receiver ?? p.user.address);
        repayIndices.push(actionKinds.length - 1);
        repayDirect.push(!pair.repay.repayReverseDebt);
      }

    }

    // make borrow/repay actions
    const ret = await p.user.callStatic.borrowRepaySequence(actionKinds, amountsIn, amountsOut, entryData, receivers);
    await p.user.borrowRepaySequence(actionKinds, amountsIn, amountsOut, entryData, receivers);

    // let's get status of the single available pool adapter
    const converterController = ConverterController__factory.connect(await p.tetuConverter.controller(), signer);
    const borrowManager = BorrowManager__factory.connect(await converterController.borrowManager(), signer);
    const poolAdapter = IPoolAdapter__factory.connect(await borrowManager.listPoolAdapters(0), signer);
    const status = await poolAdapter.getStatus();

    return {
      borrow: borrowIndices.map((retIndex, itemIndex) => ({
        collateralAsset: ret[retIndex].collateralAsset,
        borrowAsset: ret[retIndex].borrowAsset,
        borrowedAmount: +formatUnits(ret[retIndex].borrowedAmount, borrowDirect[itemIndex] ? decimalsBorrow : decimalsCollateral),
        converter: ret[retIndex].converter
      })),
      repay: repayIndices.map((retIndex, itemIndex) => ({
        collateralAsset: ret[retIndex].collateralAsset,
        borrowAsset: ret[retIndex].borrowAsset,
        borrowedAmount: +formatUnits(ret[retIndex].borrowedAmount, repayDirect[itemIndex] ? decimalsBorrow : decimalsCollateral),
        collateralAmount: +formatUnits(ret[retIndex].collateralAmount, repayDirect[itemIndex] ? decimalsCollateral : decimalsBorrow),
        swappedLeftoverBorrow: +formatUnits(ret[retIndex].swappedLeftoverBorrow, repayDirect[itemIndex] ? decimalsBorrow : decimalsCollateral),
        swappedLeftoverCollateral: +formatUnits(ret[retIndex].swappedLeftoverCollateral, repayDirect[itemIndex] ? decimalsCollateral : decimalsBorrow),
      })),
      receiverBorrowAssetBalance: +formatUnits(await borrowAsset.balanceOf(p.receiver ?? p.user.address), decimalsBorrow),
      receiverCollateralAssetBalance: +formatUnits(await collateralAsset.balanceOf(p.receiver ?? p.user.address), decimalsCollateral),
      userBorrowAssetBalance: +formatUnits(await borrowAsset.balanceOf(p.user.address), decimalsBorrow),
      userCollateralAssetBalance: +formatUnits(await collateralAsset.balanceOf(p.user.address), decimalsCollateral),
      tetuConverterBorrowAssetBalance: +formatUnits(await borrowAsset.balanceOf(p.tetuConverter.address), decimalsBorrow),
      tetuConverterCollateralAssetBalance: +formatUnits(await collateralAsset.balanceOf(p.tetuConverter.address), decimalsCollateral),
      status: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(status, decimalsCollateral, decimalsBorrow)
    }
  }

  /**
   * By default, a borrow is made with required target health factor.
   * In the case of very low target health factor (i.e. 1.03) it can be less than min allowed health factor
   * (i.e. on aave2: liquidationThreshold18/LTV = 1.0625)
   *
   * This function detects what value of health factor should be expected in the test
   */
  static getTargetHealthFactor(assetPair: IAssetsPairConfig, healthFactorsPair: IHealthFactorsPair): number {
    if (assetPair.minTargetHealthFactor === undefined) {
      return Number(healthFactorsPair.targetValue);
    }
    const minAllowed = Number(assetPair.minTargetHealthFactor);
    const valueInTest = Number(healthFactorsPair.targetValue);
    return minAllowed < valueInTest
      ? valueInTest
      // healthFactor = liquidationThreshold18 / ltv18 - is min allowed health factor on AAVE
      // but real health factor should be higher - we need some reserve
      // so, we add such reserve - see implementation of AAVE platform adapters
      : minAllowed * Number(healthFactorsPair.targetValue) / Number(healthFactorsPair.minValue);
  }

  static async getBookkeeperStatus(signer: SignerWithAddress, p: IBorrowRepaySetup,): Promise<IBookkeeperStatus> {
    const converterController = ConverterController__factory.connect(await p.tetuConverter.controller(), signer);
    const bookkeeper = Bookkeeper__factory.connect(await converterController.bookkeeper(), signer);
    const borrowManager = BorrowManager__factory.connect(await converterController.borrowManager(), signer);
    const poolAdapter = IPoolAdapter__factory.connect(await borrowManager.listPoolAdapters(0), signer);

    const collateralAsset = await IERC20Metadata__factory.connect(p.collateralAsset, signer);
    const borrowAsset = await IERC20Metadata__factory.connect(p.borrowAsset, signer);
    const decimalsCollateral = await collateralAsset.decimals();
    const decimalsBorrow = await borrowAsset.decimals();

    const actions: IAction[] = [];
    const countActions = (await bookkeeper.actionsLength(poolAdapter.address)).toNumber();
    for (let i = 0; i < countActions; ++i) {
      const a = await bookkeeper.actionsAt(poolAdapter.address, i);
      const ri = await bookkeeper.repayInfoAt(poolAdapter.address, i);
      actions.push({
        actionKind: a.actionKind.toNumber(),
        suppliedAmount: +formatUnits(a.suppliedAmount, decimalsCollateral),
        borrowedAmount: +formatUnits(a.borrowedAmount, decimalsBorrow),
        repayInfo: {
          gain: +formatUnits(ri.gain, decimalsCollateral),
          loss: +formatUnits(ri.loss, decimalsBorrow),
          prices: ri.prices.map(x => +formatUnits(x, 18))
        }
      });
    }

    const config = await poolAdapter.getConfig();

    const poolAdaptersForUser: string[] = [];
    const countPoolAdapters = (await bookkeeper.poolAdaptersPerUserLength(config.user)).toNumber();
    for (let i = 0; i < countPoolAdapters; ++i) {
      poolAdaptersForUser.push(await bookkeeper.poolAdaptersPerUserAt(config.user, i));
    }

    const checkpoint = await bookkeeper.getLastCheckpoint(poolAdapter.address);
    return {
      actions,
      poolAdaptersForUser,
      checkpoint: {
        suppliedAmount: +formatUnits(checkpoint.suppliedAmount, decimalsCollateral),
        borrowedAmount: +formatUnits(checkpoint.borrowedAmount, decimalsBorrow),
        totalCollateral: +formatUnits(checkpoint.totalCollateral, decimalsCollateral),
        totalDebt: +formatUnits(checkpoint.totalDebt, decimalsBorrow),
        countActions: checkpoint.countActions.toNumber()
      }
    }
  }

  /** Make sequence of [borrow], [repay] actions in a single block, return detailed status of Bookkeeper */
  static async borrowRepayPairsSingleBlockBookkeeper(
    signer: SignerWithAddress,
    p: IBorrowRepaySetup,
    pairs: IBorrowRepayPairParams[],
  ): Promise<IBookkeeperStatusWithResults> {
    const ret = await this.borrowRepayPairsSingleBlock(signer, p, pairs);
    const bs = await this.getBookkeeperStatus(signer, p);

    return {results: ret, ... bs}
  }

  /** Make sequence of [borrow], [repay] actions in a single block, return detailed status of Bookkeeper */
  static async borrowRepayToRebalanceBookkeeper(
    signer: SignerWithAddress,
    p: IBorrowRepaySetup,
    rrp: IRepayToRebalanceParams,
    pairs: IBorrowRepayPairParams[],
  ): Promise<IBookkeeperStatusWithResults> {
    const ret = await this.borrowRepayPairsSingleBlock(signer, p, pairs);
    console.log("ret", ret);
    console.log("rrp", rrp);

    const collateralAsset = await IERC20Metadata__factory.connect(p.collateralAsset, signer);
    const decimalsCollateral = await collateralAsset.decimals();
    const borrowAsset = await IERC20Metadata__factory.connect(p.borrowAsset, signer);
    const decimalsBorrow = await borrowAsset.decimals();

    const converterController = ConverterController__factory.connect(await p.tetuConverter.controller(), signer);
    const borrowManager = BorrowManager__factory.connect(await converterController.borrowManager(), signer);
    const poolAdapter = IPoolAdapter__factory.connect(await borrowManager.listPoolAdapters(0), signer);

    await converterController.setTargetHealthFactor2(parseUnits(rrp.targetHealthFactor, 2));

    const tetuConverterUser = await Misc.impersonate(p.tetuConverter.address);
    if (rrp.userCollateralAssetBalance) {
      await TokenUtils.getToken(p.collateralAsset, tetuConverterUser.address, parseUnits(rrp.userCollateralAssetBalance, decimalsCollateral));
    }
    if (rrp.userBorrowAssetBalance) {
      await TokenUtils.getToken(p.borrowAsset, tetuConverterUser.address, parseUnits(rrp.userBorrowAssetBalance, decimalsBorrow));
    }

    if (rrp.isCollateral) {
      const amountIn = parseUnits(rrp.amount, decimalsCollateral);
      await collateralAsset.connect(tetuConverterUser).approve(poolAdapter.address, amountIn);
      await poolAdapter.connect(tetuConverterUser).repayToRebalance(amountIn, true);
    } else {
      const amountIn = parseUnits(rrp.amount, decimalsBorrow);
      await borrowAsset.connect(tetuConverterUser).approve(poolAdapter.address, amountIn);
      await poolAdapter.connect(tetuConverterUser).repayToRebalance(amountIn, false);
    }

    const bs = await this.getBookkeeperStatus(signer, p);
    return {results: ret, ... bs}
  }
}

