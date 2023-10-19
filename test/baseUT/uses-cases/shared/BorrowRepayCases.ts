import {IPoolAdapterStatusNum} from "../../types/BorrowRepayDataTypes";
import {IERC20Metadata__factory, ITetuConverter, UserEmulator} from "../../../../typechain";
import {BigNumber, BigNumberish, BytesLike} from "ethers";
import {IConversionPlanNum} from "../../types/AppDataTypes";
import {PromiseOrValue} from "../../../../typechain/common";
import {AppConstants} from "../../types/AppConstants";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {BalanceUtils} from "../../utils/BalanceUtils";

interface IBorrowRepaySetup {
  tetuConverter: ITetuConverter;
  user: UserEmulator;
  collateralAsset: string;
  borrowAsset: string;
  collateralAssetHolder: string;
  borrowAssetHolder: string;
  userBorrowAssetBalance?: string;
  userCollateralAssetBalance?: string;
}

interface IBorrowPairParams {
  /** True - direct debt, false - reverse debt */
  directDebt: boolean;
  /** AmountIn to borrow. It's set in collateral asset for entry kinds 0 and 1 and in borrow asset for entry kind 2 */
  borrowAmountIn: string;

  exactAmountOut?: string; // 0 by default, it means that max amount should be borrowed
  entryData?: string; // 0x1 by default
  borrowAmountIsInBorrowAsset?: boolean; // false by default
}

interface IRepayPairParams {
  /** True - direct debt, false - reverse debt */
  repayDirectDebt: boolean;
  /** 100_000 = 100% */
  repayPart: number;
  /** Don't use repayPart, pay exactAmount instead */
  exactAmount?: string;
}

/**
 * Params for 1) borrow 2) repay
 * Both actions are optional
 */
interface IBorrowRepayPairParams {
  borrow?: IBorrowPairParams;
  repay?: IRepayPairParams;
}

interface IBorrowResults {
  collateralAsset: string;
  borrowAsset: string;
  converter: string;
  borrowedAmount: number;
}

interface IRepayResults {
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

interface IBorrowRepayPairResults {
  borrow: IBorrowResults[];
  repay: IRepayResults[];

  receiverCollateralAssetBalance: number;
  receiverBorrowAssetBalance: number;

  userCollateralAssetBalance: number;
  userBorrowAssetBalance: number;

  tetuConverterCollateralAssetBalance: number;
  tetuConverterBorrowAssetBalance: number;
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


export class BorrowRepayCases {
  /** Make sequence of [borrow], [repay] actions in a single block */
  static async borrowRepayPairsSingleBlock(signer: SignerWithAddress, p: IBorrowRepaySetup, pairs: IBorrowRepayPairParams[]): Promise<IBorrowRepayPairResults> {
    const collateralAsset = await IERC20Metadata__factory.connect(p.collateralAsset, signer);
    const borrowAsset = await IERC20Metadata__factory.connect(p.borrowAsset, signer);
    const decimalsCollateral = await collateralAsset.decimals();
    const decimalsBorrow = await borrowAsset.decimals();
    const receiver = ethers.Wallet.createRandom().address;

    // set up user-emulator balances
    if (p.userCollateralAssetBalance) {
      await BalanceUtils.getAmountFromHolder(p.collateralAsset, p.collateralAssetHolder, p.user.address, parseUnits(p.userCollateralAssetBalance, decimalsCollateral));
    }
    if (p.userBorrowAssetBalance) {
      await BalanceUtils.getAmountFromHolder(p.borrowAsset, p.borrowAssetHolder, p.user.address, parseUnits(p.userBorrowAssetBalance, decimalsBorrow));
    }

    // prepare sequence of borrow-repay pairs
    const actionKinds: number[] = [];
    const amountsIn: BigNumber[] = [];
    const amountsOut: BigNumber[] = [];
    const entryData: BytesLike[] = [];
    const receivers: string[] = [];

    const borrowIndices: number[] = [];
    const repayIndices: number[] = [];

    for (const pair of pairs) {
      // prepare borrow
      if (pair.borrow) {
        actionKinds.push(pair.borrow.directDebt ? AppConstants.BORROW_DIRECT_0 : AppConstants.BORROW_REVERSE_1);
        amountsIn.push(
          parseUnits(pair.borrow.borrowAmountIn, pair.borrow.directDebt ? decimalsCollateral : decimalsBorrow)
        );
        amountsOut.push(
          parseUnits(pair.borrow.exactAmountOut ?? "0", pair.borrow.directDebt ? decimalsBorrow : decimalsCollateral)
        );
        entryData.push(pair.borrow.entryData ?? "0x");
        receivers.push(receiver);
        borrowIndices.push(actionKinds.length - 1);
      }

      // prepare repay
      if (pair.repay) {
        actionKinds.push(pair.repay.repayDirectDebt ? AppConstants.REPAY_DIRECT_2 : AppConstants.REPAY_REVERSE_3);
        amountsIn.push(
          parseUnits(pair.repay.exactAmount ?? "0", pair.repay.repayDirectDebt ? decimalsBorrow : decimalsCollateral)
        );
        amountsOut.push(BigNumber.from(pair.repay.repayPart ?? 0));
        entryData.push("0x"); // not used
        receivers.push(receiver);
        repayIndices.push(actionKinds.length - 1);
      }
    }

    // make borrow/repay actions
    const ret = await p.user.callStatic.borrowRepaySequence(actionKinds, amountsIn, amountsOut, entryData, receivers);
    await p.user.borrowRepaySequence(actionKinds, amountsIn, amountsOut, entryData, receivers);

    return {
      borrow: borrowIndices.map(index => ({
        collateralAsset: ret[index].collateralAsset,
        borrowAsset: ret[index].borrowAsset,
        borrowedAmount: +formatUnits(ret[index].borrowedAmount, ret[index].borrowAsset === p.borrowAsset ? decimalsBorrow : decimalsCollateral),
        converter: ret[index].converter
      })),
      repay: repayIndices.map(index => ({
        collateralAsset: ret[index].collateralAsset,
        borrowAsset: ret[index].borrowAsset,
        borrowedAmount: +formatUnits(ret[index].borrowedAmount, ret[index].borrowAsset === p.borrowAsset ? decimalsBorrow : decimalsCollateral),
        collateralAmount: +formatUnits(ret[index].collateralAmount, ret[index].collateralAsset === p.collateralAsset ? decimalsCollateral : decimalsBorrow),
        swappedLeftoverBorrow: +formatUnits(ret[index].swappedLeftoverBorrow, ret[index].borrowAsset === p.borrowAsset ? decimalsBorrow : decimalsCollateral),
        swappedLeftoverCollateral: +formatUnits(ret[index].swappedLeftoverCollateral, ret[index].collateralAsset === p.collateralAsset ? decimalsCollateral : decimalsBorrow),
      })),
      receiverBorrowAssetBalance: +formatUnits(await borrowAsset.balanceOf(receiver), decimalsBorrow),
      receiverCollateralAssetBalance: +formatUnits(await collateralAsset.balanceOf(receiver), decimalsCollateral),
      userBorrowAssetBalance: +formatUnits(await borrowAsset.balanceOf(p.user.address), decimalsBorrow),
      userCollateralAssetBalance: +formatUnits(await collateralAsset.balanceOf(p.user.address), decimalsCollateral),
      tetuConverterBorrowAssetBalance: +formatUnits(await borrowAsset.balanceOf(p.tetuConverter.address), decimalsBorrow),
      tetuConverterCollateralAssetBalance: +formatUnits(await collateralAsset.balanceOf(p.tetuConverter.address), decimalsCollateral),
    }
  }
}