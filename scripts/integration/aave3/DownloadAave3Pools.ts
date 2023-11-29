import {writeFileSync} from "fs";
import {
  IAavePool,
  IAaveProtocolDataProvider
} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Aave3Helper} from "./Aave3Helper";
import {CommonUtils} from "../../../test/baseUT/utils/CommonUtils";

export class DownloadAave3Pools {
  /** Download detailed info for all available AAVE pools */
  static async getAave3PoolReserves(
    signer: SignerWithAddress,
    aavePool: IAavePool,
    dp: IAaveProtocolDataProvider
  ): Promise<string[]> {
    const headers = [
      "assetSymbol",
      "assetName",
      "assetAddress",
      "aTokenSymbol",
      "aTokenName",
      "aTokenAddress",

      "totalAToken",
      "totalStableDebt",
      "totalVariableDebt",

      "ltv",
      "liquidation threshold",
      "liquidation bonus",
      "decimals",
      "active",
      "frozen",
      "paused",
      "borrowable in isolation mode",
      "siloed borrowing",
      "borrowing",
      "stable borrowing",
      "reserve factor",
      "borrow cap",
      "supply cap",
      "debt ceiling",
      "liquidation protocol fee",
      "unbacked mint cap",
      "emode category",

      "liquidityIndex",
      "currentLiquidityRate",
      "variableBorrowIndex",
      "currentVariableBorrowRate",
      "currentStableBorrowRate",
      "lastUpdateTimestamp",
      "id",
      "stableDebtTokenAddress",
      "variableDebtTokenAddress",
      "interestRateStrategyAddress",
      "accruedToTreasury",
      "unbacked",
      "isolationModeTotalDebt",

      "price",

      "ct-ltv",
      "ct-liquidationThreshold",
      "ct-liquidationBonus",
      "ct-priceSource",
      "ct-label"
    ]

    const h = new Aave3Helper(signer, aavePool.address);

    const dest: string[] = [];
    dest.push(headers.join(","));

    const reserves = await aavePool.getReservesList();
    for (const reserve of reserves) {
      console.log("reserve", reserve);
      const rd = await h.getReserveInfo(signer, aavePool, dp, reserve);

      let line = [
        rd.reserveSymbol,
        rd.reserveName,
        rd.reserveAddress,
        rd.aTokenSymbol,
        rd.aTokenName,
        rd.aTokenAddress,

        // total supply of aTokens
        rd.liquidity.totalAToken,
        rd.liquidity.totalStableDebt,
        rd.liquidity.totalVariableDebt,

        // configuration
        rd.data.ltv,
        rd.data.liquidationThreshold,
        rd.data.liquidationBonus,
        rd.data.decimals,
        rd.data.active,
        rd.data.frozen,
        rd.data.paused,
        rd.data.borrowableInIsolationMode,
        rd.data.siloedBorrowing,
        rd.data.borrowing,
        rd.data.stableBorrowing,
        rd.data.reserveFactor,
        rd.data.borrowCap,
        rd.data.supplyCap,
        rd.data.debtCeiling,
        rd.data.liquidationProtocolFee,
        rd.data.unbackedMintCap,
        rd.data.emodeCategory,

        rd.data.liquidityIndex,
        rd.data.currentLiquidityRate,
        rd.data.variableBorrowIndex,
        rd.data.currentVariableBorrowRate,
        rd.data.currentStableBorrowRate,
        rd.data.lastUpdateTimestamp,
        rd.data.id,
        rd.data.stableDebtTokenAddress,
        rd.data.variableDebtTokenAddress,
        rd.data.interestRateStrategyAddress,
        rd.data.accruedToTreasury,
        rd.data.unbacked,
        rd.data.isolationModeTotalDebt,

        rd.data.price
      ];

      if (rd.category) {
        line = [...line
          , rd.category.ltv
          , rd.category.liquidationThreshold
          , rd.category.liquidationBonus
          , rd.category.priceSource
          , rd.category.label
        ];
      }

      dest.push(line.map(x => CommonUtils.toString(x)).join(","));
    }

    return dest;
  }

  /** Download detailed info for all available AAVE pools */
  static async downloadAave3PoolsToCsv(signer: SignerWithAddress, pool: string, pathOut: string) {
    // const net = await ethers.provider.getNetwork();
    // console.log(net, network.name);
    const aavePool: IAavePool = Aave3Helper.getAavePool(signer, pool);
    const dp: IAaveProtocolDataProvider = await Aave3Helper.getAaveProtocolDataProvider(signer, pool);

    const lines = await this.getAave3PoolReserves(signer, aavePool, dp);
    writeFileSync(pathOut, lines.join("\n"), 'utf8');
  }
}