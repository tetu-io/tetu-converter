import {writeFileSync} from "fs";
import {
    IAaveAddressesProvider, IAaveAddressesProvider__factory,
    IAavePool,
    IAavePool__factory, IAaveProtocolDataProvider, IAaveProtocolDataProvider__factory,
    IERC20__factory,
    IERC20Extended__factory
} from "../../../../typechain";
import {ethers, network} from "hardhat";
import {BigNumber, Bytes} from "ethers";
import {DataTypes} from "../../../../typechain/contracts/integrations/aave/IAavePool";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {AaveHelper, CategoryData} from "../../helpers/AaveHelper";

/** Download detailed info for all available AAVE pools */
async function getAavePoolReserves(
    signer: SignerWithAddress,
    aavePool: IAavePool,
    dp: IAaveProtocolDataProvider
) : Promise<string[]> {
    const headers= [
        "name",
        "reserve",

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
        "aTokenAddress",
        "stableDebtTokenAddress",
        "variableDebtTokenAddress",
        "interestRateStrategyAddress",
        "accruedToTreasury",
        "unbacked",
        "isolationModeTotalDebt",

        "ct-ltv",
        "ct-liquidationThreshold",
        "ct-liquidationBonus",
        "ct-priceSource",
        "ct-label"
    ]

    const h = new AaveHelper(signer);

    const dest: string[] = [];
    dest.push(headers.join(","));

    const reserves = await aavePool.getReservesList();
    for (const reserve of reserves) {
        console.log("reserve", reserve);
        const rd = await h.getReserveInfo(signer, aavePool, dp, reserve);

        let line = [
            rd.reserveName,
            rd.reserveAddress,

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
            rd.data.aTokenAddress,
            rd.data.stableDebtTokenAddress,
            rd.data.variableDebtTokenAddress,
            rd.data.interestRateStrategyAddress,
            rd.data.accruedToTreasury,
            rd.data.unbacked,
            rd.data.isolationModeTotalDebt
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

        dest.push(line.map(x => AaveHelper.toString(x)).join(","));
    }

    return dest;
}

/** Download detailed info for all available AAVE pools
 *
 * npx hardhat run scripts/integration/lending/aave/DownloadAavePools.ts
 * */
async function main() {
    const signer = (await ethers.getSigners())[0];
    console.log("getInfoAboutFusePools");

    const net = await ethers.provider.getNetwork();
    console.log(net, network.name);

    const aavePool: IAavePool = AaveHelper.getAavePool(signer);
    const dp: IAaveProtocolDataProvider = await AaveHelper.getAaveProtocolDataProvider(signer);

    const lines = await getAavePoolReserves(signer, aavePool, dp);
    writeFileSync('./tmp/aave_reserves.csv', lines.join("\n"), 'utf8');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });