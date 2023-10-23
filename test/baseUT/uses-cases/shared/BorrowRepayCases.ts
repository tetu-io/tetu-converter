import {IPoolAdapterStatusNum} from "../../types/BorrowRepayDataTypes";
import {
  BorrowManager__factory, ConverterController,
  ConverterController__factory,
  IERC20Metadata__factory, IMoonwellComptroller, IPoolAdapter__factory,
  ITetuConverter, ITetuConverter__factory, MoonwellPlatformAdapter,
  UserEmulator
} from "../../../../typechain";
import {BigNumber, BytesLike} from "ethers";
import {IConversionPlanNum} from "../../types/AppDataTypes";
import {AppConstants} from "../../types/AppConstants";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {BalanceUtils} from "../../utils/BalanceUtils";
import {BorrowRepayDataTypeUtils} from "../../utils/BorrowRepayDataTypeUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {IPlatformUtilsProvider} from "../../types/IPlatformUtilsProvider";

export interface IBorrowRepaySetup {
  tetuConverter: ITetuConverter;
  user: UserEmulator;
  collateralAsset: string;
  borrowAsset: string;
  collateralAssetHolder: string;
  borrowAssetHolder: string;
  userBorrowAssetBalance?: string;
  userCollateralAssetBalance?: string;
  /** Receive all borrowed and repay amounts */
  receiver: string;
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

export interface IFunctionalTestConfig {
  signer: SignerWithAddress;

  converterController: ConverterController;
  converterGovernance: SignerWithAddress;
  comptroller: IMoonwellComptroller;
  poolAdapterTemplate: string;
  platformAdapter: MoonwellPlatformAdapter;
  chainUtilsProvider: IPlatformUtilsProvider;
  assetPairs: IAssetsPair[];
  periodInBlocks: number;
  receiver: string;
}

export interface IHealthFactorsPair {
  minValue: string;
  targetValue: string;
}

export interface IAssetsPair {
  collateralAsset: string;
  borrowAsset: string;
  collateralAssetName: string;
  borrowAssetName: string;
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
    const borrowDirect: boolean[] = [];
    const repayIndices: number[] = [];
    const repayDirect: boolean[] = [];

    for (const pair of pairs) {
      // prepare borrow
      if (pair.borrow) {
        actionKinds.push(pair.borrow.reverseDebt ? AppConstants.BORROW_REVERSE_1 : AppConstants.BORROW_DIRECT_0);
        amountsIn.push(
          parseUnits(pair.borrow.amountIn, pair.borrow.reverseDebt ? decimalsBorrow : decimalsCollateral)
        );
        amountsOut.push(
          parseUnits(pair.borrow.exactAmountOut ?? "0", pair.borrow.reverseDebt ? decimalsCollateral : decimalsBorrow)
        );
        entryData.push(pair.borrow.entryData ?? "0x");
        receivers.push(p.receiver);
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
        receivers.push(p.receiver);
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
      receiverBorrowAssetBalance: +formatUnits(await borrowAsset.balanceOf(p.receiver), decimalsBorrow),
      receiverCollateralAssetBalance: +formatUnits(await collateralAsset.balanceOf(p.receiver), decimalsCollateral),
      userBorrowAssetBalance: +formatUnits(await borrowAsset.balanceOf(p.user.address), decimalsBorrow),
      userCollateralAssetBalance: +formatUnits(await collateralAsset.balanceOf(p.user.address), decimalsCollateral),
      tetuConverterBorrowAssetBalance: +formatUnits(await borrowAsset.balanceOf(p.tetuConverter.address), decimalsBorrow),
      tetuConverterCollateralAssetBalance: +formatUnits(await collateralAsset.balanceOf(p.tetuConverter.address), decimalsCollateral),
      status: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(status, decimalsCollateral, decimalsBorrow)
    }
  }
}
