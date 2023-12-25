import {
  CompoundAprLibFacade, CompoundPlatformAdapterLibFacade,
  IERC20Metadata__factory,
  IZerovixComptroller,
  IZerovixPriceOracle,
  ZerovixPlatformAdapter, IZerovixToken__factory, IZerovixToken
} from "../../../../typechain";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {ZerovixUtilsZkevm} from "./ZerovixUtilsZkevm";
import {ZerovixSetupUtils} from "./ZerovixSetupUtils";
import {IConversionPlan, IConversionPlanNum} from "../../types/AppDataTypes";
import {AppDataTypesUtils} from "../../utils/AppDataTypesUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Misc} from "../../../../scripts/utils/Misc";
import {GAS_LIMIT} from "../../types/GasLimit";
import {AprUtils} from "../../utils/aprUtils";
import {convertUnits} from "../shared/aprUtils";
import {BigNumber} from "ethers";
import {ethers} from "hardhat";
import {AppConstants} from "../../types/AppConstants";
import {NumberUtils} from "../../utils/NumberUtils";
import {IZerovixMarketData, ZerovixHelper} from "../../../../scripts/integration/zerovix/ZerovixHelper";
import {ZkevmAddresses} from "../../../../scripts/addresses/ZkevmAddresses";

export interface IZerovixPreparePlanBadPaths {
  zeroCollateralAsset?: boolean;
  zeroBorrowAsset?: boolean;
  zeroCountBlocks?: boolean;
  zeroCollateralAmount?: boolean;
  incorrectHealthFactor?: string;
  setMinBorrowCapacity?: boolean;
  setCollateralMintPaused?: boolean;
  setBorrowPaused?: boolean;
  setBorrowCapacityExceeded?: boolean;
  setMinBorrowCapacityDelta?: string;
  frozen?: boolean;
  cTokenCollateral?: string;
  cTokenBorrow?: string;
  platformAdapter?: string;
}

export interface IZerovixPreparePlan extends IZerovixPreparePlanBadPaths {
  collateralAsset: string;
  borrowAsset: string;

  amountIn: string,
  entryKind?: number; // 0 by default
  entryData?: string; // 0x by default

  countBlocks?: number; // default 1
  healthFactor?: string; // default "2"
}

export interface IPlanSourceInfo {
  priceCollateral: number;
  priceBorrow: number;
  borrowAssetDecimals: number;
  collateralAssetDecimals: number;

  collateralAssetData: IZerovixMarketData;
  borrowAssetData: IZerovixMarketData;
  cTokenBorrow: IZerovixToken;
  cTokenCollateral: IZerovixToken;

  healthFactor: number;
  countBlocks: number;

  converter: string;
}

export interface IPreparePlanResults {
  plan: IConversionPlanNum;
  sourceInfo: IPlanSourceInfo;
  gasUsed: BigNumber;
}

export class ZerovixPlatformAdapterUtils {
  static async getConversionPlan(
    signer: SignerWithAddress,
    comptroller: IZerovixComptroller,
    priceOracle: IZerovixPriceOracle,
    p: IZerovixPreparePlan,
    platformAdapter: ZerovixPlatformAdapter,
    poolAdapterTemplate: string
  ): Promise<IPreparePlanResults> {
    const entryKind = p.entryKind ?? AppConstants.ENTRY_KIND_0;

    const countBlocks = p.countBlocks ?? 1;
    const healthFactor2 = parseUnits(p?.incorrectHealthFactor ?? (p.healthFactor ?? "2"), 2);

    const cTokenBorrow = IZerovixToken__factory.connect(p?.cTokenBorrow ?? ZerovixUtilsZkevm.getCToken(p.borrowAsset), signer);
    const cTokenCollateral = IZerovixToken__factory.connect(p?.cTokenCollateral ?? ZerovixUtilsZkevm.getCToken(p.collateralAsset), signer);

    const borrowAsset = p?.cTokenBorrow
      ? await cTokenBorrow.underlying()
      : p.borrowAsset;
    const collateralAsset = p?.cTokenCollateral
      ? await cTokenCollateral.underlying()
      : p.collateralAsset;

    const decimalsBorrowAsset = await (IERC20Metadata__factory.connect(borrowAsset, signer)).decimals();
    const decimalsCollateralAsset = await (IERC20Metadata__factory.connect(collateralAsset, signer)).decimals();

    const borrowAssetData = await ZerovixHelper.getOTokenData(signer, comptroller, cTokenBorrow, ZkevmAddresses.oWETH);
    const collateralAssetData = await ZerovixHelper.getOTokenData(signer, comptroller, cTokenCollateral, ZkevmAddresses.oWETH);

    const priceBorrow = await priceOracle.getUnderlyingPrice(cTokenBorrow.address);
    const priceCollateral = await priceOracle.getUnderlyingPrice(cTokenCollateral.address);

    if (p.setMinBorrowCapacity) {
      await ZerovixSetupUtils.setBorrowCapacity(signer, cTokenBorrow.address, borrowAssetData.totalBorrows);
    }
    if (p.setCollateralMintPaused) {
      await ZerovixSetupUtils.setMintPaused(signer, cTokenCollateral.address);
    }
    if (p.setBorrowPaused) {
      await ZerovixSetupUtils.setBorrowPaused(signer, cTokenBorrow.address);
    }
    if (p.setBorrowCapacityExceeded) {
      await ZerovixSetupUtils.setBorrowCapacity(signer, cTokenBorrow.address, borrowAssetData.totalBorrows.div(2));
    }
    if (p.setMinBorrowCapacityDelta) {
      const amount = borrowAssetData.totalBorrows.add(parseUnits(p?.setMinBorrowCapacityDelta, decimalsBorrowAsset));
      await ZerovixSetupUtils.setBorrowCapacity(signer, cTokenBorrow.address, amount);
    }
    if (p.frozen) {
      await platformAdapter.setFrozen(true);
    }

    const gasUsed = await platformAdapter.estimateGas.getConversionPlan(
      {
        collateralAsset: p?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
        amountIn: parseUnits(
          p?.zeroCollateralAmount ? "0" : p.amountIn,
          entryKind === AppConstants.ENTRY_KIND_2 ? decimalsBorrowAsset : decimalsCollateralAsset
        ),
        borrowAsset: p?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
        countBlocks: p?.zeroCountBlocks ? 0 : countBlocks,
        entryData: p.entryData ?? "0x",
      },
      healthFactor2,
      {gasLimit: GAS_LIMIT},
    );

    const plan = await platformAdapter.getConversionPlan(
      {
        collateralAsset: p?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
        amountIn: parseUnits(
          p?.zeroCollateralAmount ? "0" : p.amountIn,
          entryKind === AppConstants.ENTRY_KIND_2 ? decimalsBorrowAsset : decimalsCollateralAsset
        ),
        borrowAsset: p?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
        countBlocks: p?.zeroCountBlocks ? 0 : countBlocks,
        entryData: p.entryData ?? "0x",
      },
      healthFactor2,
      {gasLimit: GAS_LIMIT},
    );
    console.log("PLAN", plan);

    return {
      plan: AppDataTypesUtils.getConversionPlanNum(plan, decimalsCollateralAsset, decimalsBorrowAsset),
      sourceInfo: {
        collateralAssetData,
        borrowAssetData,
        borrowAssetDecimals: decimalsBorrowAsset,
        collateralAssetDecimals: decimalsCollateralAsset,
        cTokenBorrow,
        cTokenCollateral,
        priceBorrow: +formatUnits(priceBorrow, 36 - decimalsBorrowAsset),
        priceCollateral: +formatUnits(priceCollateral, 36 - decimalsCollateralAsset),
        healthFactor: +formatUnits(healthFactor2, 2),
        countBlocks,
        converter: poolAdapterTemplate
      },
      gasUsed
    }
  }

  static async getExpectedPlan(
    p: IZerovixPreparePlan,
    plan: IConversionPlanNum,
    planInfo: IPlanSourceInfo,
    facadeAprLib: CompoundAprLibFacade,
    facadePlatformLib: CompoundPlatformAdapterLibFacade,
  ): Promise<IConversionPlanNum> {
    const entryKind = p.entryKind ?? AppConstants.ENTRY_KIND_0;
    const amountIn = parseUnits(
      p?.zeroCollateralAmount ? "0" : p.amountIn,
      entryKind === AppConstants.ENTRY_KIND_2 ? planInfo.borrowAssetDecimals : planInfo.collateralAssetDecimals
    );
    const maxAmountToBorrow = await facadePlatformLib.getMaxAmountToBorrow({
      cTokenCollateral: planInfo.cTokenCollateral.address,
      cTokenBorrow: planInfo.cTokenBorrow.address,
      comptroller: ZkevmAddresses.ZEROVIX_COMPTROLLER
    });
    const maxAmountToSupply = Misc.MAX_UINT;

    const {collateralAmount, amountToBorrow} = this.getCollateralAndBorrowAmounts(
      amountIn,
      entryKind,
      plan,
      planInfo,
      maxAmountToBorrow,
      maxAmountToSupply
    )

    console.log("amountToBorrow", amountToBorrow);

    const amountCollateralInBorrowAsset36 = convertUnits(
      collateralAmount,
      parseUnits(planInfo.priceCollateral.toString(), 36),
      planInfo.collateralAssetDecimals,
      parseUnits(planInfo.priceBorrow.toString(), 36),
      36
    );

    // predict APR
    const borrowRatePredicted = await facadeAprLib.getEstimatedBorrowRate(
      planInfo.borrowAssetData.interestRateModel,
      planInfo.cTokenBorrow.address,
      amountToBorrow
    );
    console.log("borrowRatePredicted", borrowRatePredicted);
    const supplyRatePredicted = await facadeAprLib.getEstimatedSupplyRate(
      planInfo.collateralAssetData.interestRateModel,
      planInfo.cTokenCollateral.address,
      collateralAmount
    );
    console.log("supplyRatePredicted", supplyRatePredicted);

    console.log("libFacade.getSupplyIncomeInBorrowAsset36");
    const supplyIncomeInBorrowAsset36 = await facadeAprLib.getSupplyIncomeInBorrowAsset36(
      supplyRatePredicted,
      planInfo.countBlocks,
      parseUnits("1", planInfo.collateralAssetDecimals),
      parseUnits(planInfo.priceCollateral.toString(), 36),
      parseUnits(planInfo.priceBorrow.toString(), 36),
      collateralAmount
    );

    const borrowCost36 = await facadeAprLib.getBorrowCost36(
      borrowRatePredicted,
      amountToBorrow,
      planInfo.countBlocks,
      parseUnits("1", planInfo.borrowAssetDecimals),
    );

    const liquidationThreshold18 = planInfo.collateralAssetData.collateralFactorMantissa;
    const ltv18 = planInfo.borrowAssetData.collateralFactorMantissa;

    const rewardsAmountInBorrowAsset36 = BigNumber.from(0); // todo

    const expectedPlan: IConversionPlan = {
      converter: planInfo.converter,
      amountToBorrow,
      collateralAmount,
      amountCollateralInBorrowAsset36,
      borrowCost36,
      supplyIncomeInBorrowAsset36,
      maxAmountToBorrow,
      maxAmountToSupply,
      liquidationThreshold18,
      ltv18,
      rewardsAmountInBorrowAsset36
    }

    return AppDataTypesUtils.getConversionPlanNum(expectedPlan, planInfo.collateralAssetDecimals, planInfo.borrowAssetDecimals);
  }

  private static getCollateralAndBorrowAmounts(
    amountIn: BigNumber,
    entryKind: number,
    plan: IConversionPlanNum,
    planInfo: IPlanSourceInfo,
    maxAmountToBorrow: BigNumber,
    maxAmmountToSupply: BigNumber
  ) : {collateralAmount: BigNumber, amountToBorrow: BigNumber} {
    let collateralAmount: BigNumber;
    let amountToBorrow: BigNumber;
    if (entryKind === AppConstants.ENTRY_KIND_0) {
      collateralAmount = amountIn;
      if (collateralAmount.gt(maxAmmountToSupply)) {
        collateralAmount = maxAmmountToSupply;
      }
      amountToBorrow = AprUtils.getBorrowAmount(
        collateralAmount,
        parseUnits(planInfo.healthFactor.toString(), 2).toNumber(),
        parseUnits(plan.liquidationThreshold.toString(), 18),
        parseUnits(planInfo.priceCollateral.toString(), 36),
        parseUnits(planInfo.priceBorrow.toString(), 36),
        planInfo.collateralAssetDecimals,
        planInfo.borrowAssetDecimals
      );
      if (amountToBorrow.gt(maxAmountToBorrow)) {
        amountToBorrow = maxAmountToBorrow;
      }
    } else if (entryKind === AppConstants.ENTRY_KIND_2) {
      amountToBorrow = amountIn;
      if (amountToBorrow.gt(maxAmountToBorrow)) {
        amountToBorrow = maxAmountToBorrow;
      }
      collateralAmount = AprUtils.getCollateralAmount(
        amountToBorrow,
        parseUnits(planInfo.healthFactor.toString(), 2).toNumber(),
        parseUnits(plan.liquidationThreshold.toString(), 18),
        parseUnits(planInfo.priceCollateral.toString(), 36),
        parseUnits(planInfo.priceBorrow.toString(), 36),
        planInfo.collateralAssetDecimals,
        planInfo.borrowAssetDecimals
      );
      if (collateralAmount.gt(maxAmmountToSupply)) {
        collateralAmount = maxAmmountToSupply;
      }
    } else {
      // assume proportions 1 : 1
      const x = 1;
      const y = 1;

      const a = plan.liquidationThreshold * x / (planInfo.healthFactor * y);
      const collateralAmount0 = +formatUnits(amountIn, planInfo.collateralAssetDecimals) / (1 + a);
      collateralAmount = parseUnits(
        NumberUtils.trimDecimals(collateralAmount0.toString(), planInfo.collateralAssetDecimals),
        planInfo.collateralAssetDecimals
      );
      if (collateralAmount.gt(maxAmmountToSupply)) {
        collateralAmount = maxAmmountToSupply;
      }
      amountToBorrow = AprUtils.getBorrowAmount(
        collateralAmount,
        parseUnits(planInfo.healthFactor.toString(), 2).toNumber(),
        parseUnits(plan.liquidationThreshold.toString(), 18),
        parseUnits(planInfo.priceCollateral.toString(), 36),
        parseUnits(planInfo.priceBorrow.toString(), 36),
        planInfo.collateralAssetDecimals,
        planInfo.borrowAssetDecimals
      );
      if (amountToBorrow.gt(maxAmountToBorrow)) {
        amountToBorrow = maxAmountToBorrow;
      }
    }
    return {collateralAmount, amountToBorrow};
  }
}