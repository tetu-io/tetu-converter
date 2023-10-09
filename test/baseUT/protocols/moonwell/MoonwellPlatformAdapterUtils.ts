import {
  CompoundAprLibFacade, CompoundPlatformAdapterLibFacade,
  IERC20Metadata__factory,
  IMoonwellComptroller,
  IMoonwellPriceOracle,
  IMToken,
  IMToken__factory,
  MoonwellPlatformAdapter
} from "../../../../typechain";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {IWellMarketData, MoonwellHelper} from "../../../../scripts/integration/moonwell/MoonwellHelper";
import {MoonwellUtils} from "./MoonwellUtils";
import {MoonwellSetupUtils} from "./MoonwellSetupUtils";
import {IConversionPlan, IConversionPlanNum} from "../../types/AppDataTypes";
import {AppDataTypesUtils} from "../../utils/AppDataTypesUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Misc} from "../../../../scripts/utils/Misc";
import {GAS_LIMIT} from "../../types/GasLimit";
import {AprUtils} from "../../utils/aprUtils";
import {convertUnits} from "../shared/aprUtils";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {BigNumber} from "ethers";
import {ethers} from "hardhat";
import {AppConstants} from "../../types/AppConstants";
import {NumberUtils} from "../../utils/NumberUtils";

export interface IMoonwellPreparePlanBadPaths {
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
}

export interface IMoonwellPreparePlan extends IMoonwellPreparePlanBadPaths {
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

  collateralAssetData: IWellMarketData;
  borrowAssetData: IWellMarketData;
  cTokenBorrow: IMToken;
  cTokenCollateral: IMToken;

  healthFactor: number;
  countBlocks: number;

  converter: string;
}

export interface IPreparePlanResults {
  plan: IConversionPlanNum;
  sourceInfo: IPlanSourceInfo;
}

export class MoonwellPlatformAdapterUtils {
  static async getConversionPlan(
    signer: SignerWithAddress,
    comptroller: IMoonwellComptroller,
    priceOracle: IMoonwellPriceOracle,
    p: IMoonwellPreparePlan,
    platformAdapter: MoonwellPlatformAdapter,
    poolAdapterTemplate: string
  ): Promise<IPreparePlanResults> {
    const entryKind = p.entryKind ?? AppConstants.ENTRY_KIND_0;

    const countBlocks = p.countBlocks ?? 1;
    const healthFactor2 = parseUnits(p?.incorrectHealthFactor ?? (p.healthFactor ?? "2"), 2);

    const cTokenBorrow = IMToken__factory.connect(p?.cTokenBorrow ?? MoonwellUtils.getCToken(p.borrowAsset), signer);
    const cTokenCollateral = IMToken__factory.connect(p?.cTokenCollateral ?? MoonwellUtils.getCToken(p.collateralAsset), signer);

    const decimalsBorrowAsset = await (IERC20Metadata__factory.connect(p.borrowAsset, signer)).decimals();
    const decimalsCollateralAsset = await (IERC20Metadata__factory.connect(p.collateralAsset, signer)).decimals();

    const borrowAssetData = await MoonwellHelper.getCTokenData(signer, comptroller, cTokenBorrow);
    const collateralAssetData = await MoonwellHelper.getCTokenData(signer, comptroller, cTokenCollateral);

    const priceBorrow = await priceOracle.getUnderlyingPrice(cTokenBorrow.address);
    const priceCollateral = await priceOracle.getUnderlyingPrice(cTokenCollateral.address);

    if (p.setMinBorrowCapacity) {
      await MoonwellSetupUtils.setBorrowCapacity(signer, cTokenBorrow.address, borrowAssetData.totalBorrows);
    }
    if (p.setCollateralMintPaused) {
      await MoonwellSetupUtils.setMintPaused(signer, cTokenCollateral.address);
    }
    if (p.setBorrowPaused) {
      await MoonwellSetupUtils.setBorrowPaused(signer, cTokenBorrow.address);
    }
    if (p.setBorrowCapacityExceeded) {
      await MoonwellSetupUtils.setBorrowCapacity(signer, cTokenBorrow.address, borrowAssetData.totalBorrows.div(2));
    }
    if (p.setMinBorrowCapacityDelta) {
      const amount = borrowAssetData.totalBorrows.add(parseUnits(p?.setMinBorrowCapacityDelta, decimalsBorrowAsset));
      await MoonwellSetupUtils.setBorrowCapacity(signer, cTokenBorrow.address, amount);
    }
    if (p.frozen) {
      await platformAdapter.setFrozen(true);
    }

    const plan = await platformAdapter.getConversionPlan(
      {
        collateralAsset: p?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : p.collateralAsset,
        amountIn: parseUnits(
          p?.zeroCollateralAmount ? "0" : p.amountIn,
          entryKind === AppConstants.ENTRY_KIND_2 ? decimalsBorrowAsset : decimalsCollateralAsset
        ),
        borrowAsset: p?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : p.borrowAsset,
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
      }
    }
  }

  static async getExpectedPlan(
    p: IMoonwellPreparePlan,
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
      comptroller: BaseAddresses.MOONWELL_COMPTROLLER
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
      collateralAmount: collateralAmount,
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