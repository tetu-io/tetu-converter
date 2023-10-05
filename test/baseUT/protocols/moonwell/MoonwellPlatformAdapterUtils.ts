import {IERC20Metadata__factory, IMoonwellComptroller, IMoonwellPriceOracle, IMToken, IMToken__factory, MoonwellPlatformAdapter} from "../../../../typechain";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {MoonwellHelper} from "../../../../scripts/integration/moonwell/MoonwellHelper";
import {MoonwellUtils} from "./MoonwellUtils";
import {MoonwellSetupUtils} from "./MoonwellSetupUtils";
import {IConversionPlanNum} from "../../types/AppDataTypes";
import {AppDataTypesUtils} from "../../utils/AppDataTypesUtils";

export interface IMoonwellPreparePlan {
  comptroller: IMoonwellComptroller;
  priceOracle: IMoonwellPriceOracle;
  lib: MoonwellLib;

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

  collateralAssetData: IMoonwellMarketData;
  borrowAssetData: IMoonwellMarketData;
  cTokenBorrow: IMToken;
  cTokenCollateral: IMToken;
}

export class MoonwellPlatformAdapterUtils {
  static async getPlan(p: IMoonwellPreparePlan, platformAdapter: MoonwellPlatformAdapter): Promise<IPreparePlanResults> {
    const signer = p.comptroller.signer;

    const countBlocks = p.countBlocks ?? 1;
    const healthFactor = p.healthFactor ?? "2";

    const cTokenBorrow = IMToken__factory.connect(MoonwellUtils.getCToken(p.borrowAsset), signer);
    const cTokenCollateral = IMToken__factory.connect(MoonwellUtils.getCToken(p.collateralAsset), signer);

    const borrowAssetDecimals = await (IERC20Metadata__factory.connect(p.borrowAsset, deployer)).decimals();
    const collateralAssetDecimals = await (IERC20Metadata__factory.connect(p.collateralAsset, deployer)).decimals();

    const borrowAssetData = await MoonwellHelper.getCTokenData(deployer, comptroller, cTokenBorrow);
    const collateralAssetData = await MoonwellHelper.getCTokenData(deployer, comptroller, cTokenCollateral);

    const priceBorrow = await p.priceOracle.getUnderlyingPrice(borrowCToken);
    const priceCollateral = await p.priceOracle.getUnderlyingPrice(collateralCToken);

    if (p.setMinBorrowCapacity) {
      await MoonwellSetupUtils.setBorrowCapacity(signer, borrowCToken, borrowAssetData.totalBorrows);
    }
    if (p.setCollateralMintPaused) {
      await MoonwellSetupUtils.setMintPaused(signer, collateralCToken);
    }
    if (p.setBorrowPaused) {
      await MoonwellSetupUtils.setBorrowPaused(signer, borrowCToken);
    }
    if (p.setBorrowCapacityExceeded) {
      await MoonwellSetupUtils.setBorrowCapacity(signer, borrowCToken, borrowAssetData.totalBorrows.div(2));
    }
    if (p.setMinBorrowCapacityDelta) {
      const amount = borrowAssetData.totalBorrows.add(badPathsParams?.setMinBorrowCapacityDelta);
      await MoonwellSetupUtils.setBorrowCapacity(signer, borrowCToken, amount);
    }
    if (p.frozen) {
      await platformAdapter.setFrozen(true);
    }

    const plan = await platformAdapter.getConversionPlan(
      {
        collateralAsset: p?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : p.collateralAsset,
        amountIn: p?.zeroCollateralAmount ? 0 : p.amountIn,
        borrowAsset: p?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : p.borrowAsset,
        countBlocks: p?.zeroCountBlocks ? 0 : countBlocks,
        entryData: entryData ?? "0x",
        user: Misc.ZERO_ADDRESS
      },
      parseUnits(p?.incorrectHealthFactor ?? healthFactor, 2),
      {gasLimit: GAS_LIMIT},
    );
    console.log("PLAN", plan);

    return {
      plan: AppDataTypesUtils.getConversionPlanNum(plan),
      collateralAssetData,
      borrowAssetData,
      borrowAssetDecimals,
      collateralAssetDecimals,
      cTokenBorrow,
      cTokenCollateral,
      priceBorrow: +formatUnits(priceBorrow, borrowAssetDecimals),
      priceCollateral: +formatUnits(priceCollateral, collateralAssetDecimals)
    }
  }
}