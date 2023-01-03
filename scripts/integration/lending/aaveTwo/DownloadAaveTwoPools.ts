import {writeFileSync} from "fs";
import {
  IAaveTwoPool, IAaveTwoProtocolDataProvider

} from "../../../../typechain";
import {ethers, network} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {AaveTwoHelper} from "../../helpers/AaveTwoHelper";

/** Download detailed info for all available AAVE pools */
async function getAaveTwoPoolReserves(
  signer: SignerWithAddress,
  aavePool: IAaveTwoPool,
  dp: IAaveTwoProtocolDataProvider
) : Promise<string[]> {
  const headers= [
    "assetSymbol",
    "assetName",
    "assetAddress",
    "aTokenSymbol",
    "aTokenName",
    "aTokenAddress",

    "AvailableLiquidity",
    "totalStableDebt",
    "totalVariableDebt",

    "ltv",
    "liquidation threshold",
    "liquidation bonus",
    "decimals",
    "active",
    "frozen",
    "borrowing",
    "stableBorrowing",
    "reserve factor",

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

    "price"
  ]

  const dest: string[] = [];
  dest.push(headers.join(","));

  const reserves = await aavePool.getReservesList();
  for (const reserve of reserves) {
    console.log("reserve", reserve);
    const rd = await AaveTwoHelper.getReserveInfo(signer, aavePool, dp, reserve);

    const line = [
      rd.reserveSymbol,
      rd.reserveName,
      rd.reserveAddress,
      rd.aTokenSymbol,
      rd.aTokenName,
      rd.aTokenAddress,

      // total supply of aTokens
      rd.liquidity.availableLiquidity,
      rd.liquidity.totalStableDebt,
      rd.liquidity.totalVariableDebt,

      // configuration
      rd.data.ltv,
      rd.data.liquidationThreshold,
      rd.data.liquidationBonus,
      rd.data.decimals,
      rd.data.active,
      rd.data.frozen,
      rd.data.borrowing,
      rd.data.stableBorrowing,
      rd.data.reserveFactor,

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

      rd.data.price
    ];

    dest.push(line.map(x => AaveTwoHelper.toString(x)).join(","));
  }

  return dest;
}

/**
 * Download detailed info for all available AAVE pools
 *    npx hardhat run scripts/integration/lending/aaveTwo/DownloadAaveTwoPools.ts
 */
async function main() {
  const signer = (await ethers.getSigners())[0];
  console.log("Get AAVEv2 pool info");

  const net = await ethers.provider.getNetwork();
  console.log(net, network.name);

  const aavePool: IAaveTwoPool = AaveTwoHelper.getAavePool(signer);
  const dp: IAaveTwoProtocolDataProvider = await AaveTwoHelper.getAaveProtocolDataProvider(signer);

  const lines = await getAaveTwoPoolReserves(signer, aavePool, dp);
  writeFileSync('./tmp/aave2_reserves.csv', lines.join("\n"), 'utf8');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });