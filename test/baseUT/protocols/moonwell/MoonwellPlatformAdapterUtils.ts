import {IERC20Metadata__factory, IMoonwellComptroller, IMoonwellPriceOracle, IMToken, IMToken__factory, MoonwellPlatformAdapter} from "../../../../typechain";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {IWellMarketData, MoonwellHelper} from "../../../../scripts/integration/moonwell/MoonwellHelper";
import {MoonwellUtils} from "./MoonwellUtils";
import {MoonwellSetupUtils} from "./MoonwellSetupUtils";
import {IConversionPlanNum} from "../../types/AppDataTypes";
import {AppDataTypesUtils} from "../../utils/AppDataTypesUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Misc} from "../../../../scripts/utils/Misc";
import {GAS_LIMIT} from "../../types/GasLimit";
import {AprUtils} from "../../utils/aprUtils";
import {convertUnits} from "../shared/aprUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {AprHundredFinance} from "../hundred-finance/aprHundredFinance";

export interface IMoonwellPreparePlan {
  comptroller: IMoonwellComptroller;
  priceOracle: IMoonwellPriceOracle;

  collateralAsset: string;
  borrowAsset: string;

  amountIn: string,
  isAmountInBorrowAsset?: number; // false by default (set it true if entryKind = 2)
  entryData?: string; // 0x by default

  countBlocks?: number; // default 1
  healthFactor?: string; // default "2"

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
}

interface IPreparePlanResults {
  plan: IConversionPlanNum;

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
}

export class MoonwellPlatformAdapterUtils {
  static async getConversionPlan(
    signer: SignerWithAddress,
    p: IMoonwellPreparePlan,
    platformAdapter: MoonwellPlatformAdapter
  ): Promise<IPreparePlanResults> {
    const countBlocks = p.countBlocks ?? 1;
    const healthFactor2 = parseUnits(p?.incorrectHealthFactor ?? (p.healthFactor ?? "2"), 2);

    const cTokenBorrow = IMToken__factory.connect(MoonwellUtils.getCToken(p.borrowAsset), signer);
    const cTokenCollateral = IMToken__factory.connect(MoonwellUtils.getCToken(p.collateralAsset), signer);

    const decimalsBorrowAsset = await (IERC20Metadata__factory.connect(p.borrowAsset, signer)).decimals();
    const decimalsCollateralAsset = await (IERC20Metadata__factory.connect(p.collateralAsset, signer)).decimals();

    const borrowAssetData = await MoonwellHelper.getCTokenData(signer, p.comptroller, cTokenBorrow);
    const collateralAssetData = await MoonwellHelper.getCTokenData(signer, p.comptroller, cTokenCollateral);

    const priceBorrow = await p.priceOracle.getUnderlyingPrice(cTokenBorrow.address);
    const priceCollateral = await p.priceOracle.getUnderlyingPrice(cTokenCollateral.address);

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
      const amount = borrowAssetData.totalBorrows.add(p?.setMinBorrowCapacityDelta);
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
            p.isAmountInBorrowAsset ? decimalsBorrowAsset : decimalsCollateralAsset
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
      collateralAssetData,
      borrowAssetData,
      borrowAssetDecimals: decimalsBorrowAsset,
      collateralAssetDecimals: decimalsCollateralAsset,
      cTokenBorrow,
      cTokenCollateral,
      priceBorrow: +formatUnits(priceBorrow, decimalsBorrowAsset),
      priceCollateral: +formatUnits(priceCollateral, decimalsCollateralAsset),
      healthFactor: +formatUnits(healthFactor2, 2),
      countBlocks
    }
  }

  static async getExpectedPlan(
    signer: SignerWithAddress,
    p: IMoonwellPreparePlan,
    d: IPreparePlanResults,
    facade: CompoundAprLibFacade
  ): Promise<IPreparePlanResults> {
    const amountIn = parseUnits(
    p?.zeroCollateralAmount ? "0" : p.amountIn,
    p.isAmountInBorrowAsset ? d.borrowAssetDecimals : d.collateralAssetDecimals
    );
    let amountToBorrow = AprUtils.getBorrowAmount(
      amountIn,
      parseUnits(d.healthFactor.toString(), 2).toNumber(),
      parseUnits(d.plan.liquidationThreshold.toString(), 18),
      parseUnits(d.priceCollateral.toString(), 36),
      parseUnits(d.priceBorrow.toString(), 36),
      d.collateralAssetDecimals,
      d.borrowAssetDecimals
    );
    if (amountToBorrow.gt(d.plan.maxAmountToBorrow)) {
      amountToBorrow = parseUnits(d.plan.maxAmountToBorrow.toString(), d.borrowAssetDecimals)
    }
    console.log("amountToBorrow", amountToBorrow);

    const amountCollateralInBorrowAsset36 =  convertUnits(
      amountIn,
      parseUnits(d.priceCollateral.toString(), 36),
      d.collateralAssetDecimals,
      parseUnits(d.priceBorrow.toString(), 36),
      36
    );

    // predict APR
    const borrowRatePredicted = await facade.getEstimatedBorrowRate(d.cTokenBorrow, amountToBorrow);
    console.log("borrowRatePredicted", borrowRatePredicted);
    const supplyRatePredicted = await facade.getEstimatedSupplyRate(d.cTokenCollateral, amountIn);
    console.log("supplyRatePredicted", supplyRatePredicted);

    console.log("libFacade.getSupplyIncomeInBorrowAsset36");
    const supplyIncomeInBorrowAsset36 = await libFacade.getSupplyIncomeInBorrowAsset36(
      supplyRatePredicted,
      d.countBlocks,
      parseUnits("1", d.collateralAssetDecimals),
      parseUnits(d.priceCollateral.toString(), 36),
      parseUnits(d.priceBorrow.toString(), 36),
      amountIn
    );

    const borrowCost36 = await libFacade.getBorrowCost36(
      borrowRatePredicted,
      amountToBorrow,
      d.countBlocks,
      parseUnits("1", d.borrowAssetDecimals),
    );
  }
}