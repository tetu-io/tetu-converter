import {writeFileSync} from "fs";
import {IAavePool, IAavePool__factory, IERC20__factory, IERC20Extended__factory} from "../../../../typechain";
import {ethers, network} from "hardhat";
import {BigNumber, Bytes} from "ethers";
import {DataTypes} from "../../../../typechain/contracts/integrations/aave/IAavePool";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

const FULL_MASK =                      "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
////////////////////////////////////////////////////////////////////////////////////////////////////////////
// aave-v3-core: ReserveConfiguration.sol
const LTV_MASK =                       "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000";
const LIQUIDATION_THRESHOLD_MASK =     "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000FFFF";
const LIQUIDATION_BONUS_MASK =         "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000FFFFFFFF";
const DECIMALS_MASK =                  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00FFFFFFFFFFFF";
const ACTIVE_MASK =                    "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFF";
const FROZEN_MASK =                    "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFDFFFFFFFFFFFFFF";
const BORROWING_MASK =                 "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFBFFFFFFFFFFFFFF";
const STABLE_BORROWING_MASK =          "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF7FFFFFFFFFFFFFF";
const PAUSED_MASK =                    "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFFF";
const BORROWABLE_IN_ISOLATION_MASK =   "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFDFFFFFFFFFFFFFFF";
const SILOED_BORROWING_MASK =          "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFBFFFFFFFFFFFFFFF";
const RESERVE_FACTOR_MASK =            "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000FFFFFFFFFFFFFFFF";
const BORROW_CAP_MASK =                "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF000000000FFFFFFFFFFFFFFFFFFFF";
const SUPPLY_CAP_MASK =                "0xFFFFFFFFFFFFFFFFFFFFFFFFFF000000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
const LIQUIDATION_PROTOCOL_FEE_MASK =  "0xFFFFFFFFFFFFFFFFFFFFFF0000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
const EMODE_CATEGORY_MASK =            "0xFFFFFFFFFFFFFFFFFFFF00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
const UNBACKED_MINT_CAP_MASK =         "0xFFFFFFFFFFF000000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
const DEBT_CEILING_MASK =              "0xF0000000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";

/// @dev For the LTV, the start bit is 0 (up to 15), hence no bitshifting is needed
const LIQUIDATION_THRESHOLD_START_BIT_POSITION = 16;
const LIQUIDATION_BONUS_START_BIT_POSITION = 32;
const RESERVE_DECIMALS_START_BIT_POSITION = 48;
const IS_ACTIVE_START_BIT_POSITION = 56;
const IS_FROZEN_START_BIT_POSITION = 57;
const BORROWING_ENABLED_START_BIT_POSITION = 58;
const STABLE_BORROWING_ENABLED_START_BIT_POSITION = 59;
const IS_PAUSED_START_BIT_POSITION = 60;
const BORROWABLE_IN_ISOLATION_START_BIT_POSITION = 61;
const SILOED_BORROWING_START_BIT_POSITION = 62;
/// @dev bit 63 reserved

const RESERVE_FACTOR_START_BIT_POSITION = 64;
const BORROW_CAP_START_BIT_POSITION = 80;
const SUPPLY_CAP_START_BIT_POSITION = 116;
const LIQUIDATION_PROTOCOL_FEE_START_BIT_POSITION = 152;
const EMODE_CATEGORY_START_BIT_POSITION = 168;
const UNBACKED_MINT_CAP_START_BIT_POSITION = 176;
const DEBT_CEILING_START_BIT_POSITION = 212;

const MAX_VALID_LTV = 65535;
const MAX_VALID_LIQUIDATION_THRESHOLD = 65535;
const MAX_VALID_LIQUIDATION_BONUS = 65535;
const MAX_VALID_DECIMALS = 255;
const MAX_VALID_RESERVE_FACTOR = 65535;
const MAX_VALID_BORROW_CAP = 68719476735;
const MAX_VALID_SUPPLY_CAP = 68719476735;
const MAX_VALID_LIQUIDATION_PROTOCOL_FEE = 65535;
const MAX_VALID_EMODE_CATEGORY = 255;
const MAX_VALID_UNBACKED_MINT_CAP = 68719476735;
const MAX_VALID_DEBT_CEILING = 1099511627775;

const DEBT_CEILING_DECIMALS = 2;
const MAX_RESERVES_COUNT = 128;
////////////////////////////////////////////////////////////////////////////////////////////////////////////

function get(configuration: BigNumber, mask: string, shift: number): BigNumber {
    const fullMask = BigNumber.from(FULL_MASK);
    return configuration.and(BigNumber.from(mask).xor(fullMask)).shr(shift);
}

function getBitValue(configuration: BigNumber, mask: string): boolean {
    const fullMask = BigNumber.from(FULL_MASK);
    return ! configuration.and(BigNumber.from(mask).xor(fullMask)).eq(0);
}

function toString(n: number | string | BigNumber | boolean | bigint | Bytes) : string {
    return typeof n === "object" && n.toString()
        ? n.toString()
        : "" + n;
}

async function getEModeCategory(aavePool: IAavePool, category: number) : Promise<string[]> {
    console.log("getEModeCategory", category);
    const data = await aavePool.getEModeCategoryData(category);

    return [
        data.ltv,
        data.liquidationThreshold,
        data.liquidationBonus,
        data.priceSource,
        data.label
    ].map(x => toString(x));
}

function memoize(fn: (category: number) => Promise<string[]>) : (category: number) => Promise<string[]> {
    const cache = new Map<number, string[]>();
    return async (category: number) => {
        let ret = cache.get(category);
        if (!ret) {
            ret = await fn(category);
            cache.set(category, ret);
        }
        return ret;
    }
}

/** Download detailed info for all available AAVE pools */
async function getAavePoolReserves(signer: SignerWithAddress, aavePool: IAavePool) : Promise<string[]> {
    const headers= [
        "name",
        "IERC20-decimals",
        "reserve",

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

    const dest: string[] = [];
    dest.push(headers.join(","));

    const reserves = await aavePool.getReservesList();
    const funcGetECategoryData = memoize(category => getEModeCategory(aavePool, category) );
    for (const reserve of reserves) {
        console.log("reserve", reserve);
        const rd: DataTypes.ReserveDataStruct = await aavePool.getReserveData(reserve);

        const data: BigNumber = BigNumber.from(rd.configuration.data);

        const name = await IERC20Extended__factory.connect(reserve, signer).name();
        const decimals = await IERC20Extended__factory.connect(reserve, signer).decimals();
        const category = get(data, EMODE_CATEGORY_MASK, EMODE_CATEGORY_START_BIT_POSITION);

        let line = [
            name,
            decimals,
            reserve,

        // configuration
            get(data, LTV_MASK, 0),
            get(data, LIQUIDATION_THRESHOLD_MASK, LIQUIDATION_THRESHOLD_START_BIT_POSITION),
            get(data, LIQUIDATION_BONUS_MASK, LIQUIDATION_BONUS_START_BIT_POSITION),
            get(data, DECIMALS_MASK, RESERVE_DECIMALS_START_BIT_POSITION),
            getBitValue(data, ACTIVE_MASK),
            getBitValue(data, FROZEN_MASK),
            getBitValue(data, PAUSED_MASK),
            getBitValue(data, BORROWABLE_IN_ISOLATION_MASK),
            getBitValue(data, SILOED_BORROWING_MASK),
            getBitValue(data, BORROWING_MASK),
            getBitValue(data, STABLE_BORROWING_MASK),
            get(data, RESERVE_FACTOR_MASK, RESERVE_FACTOR_START_BIT_POSITION),
            get(data, BORROW_CAP_MASK, BORROW_CAP_START_BIT_POSITION),
            get(data, SUPPLY_CAP_MASK, SUPPLY_CAP_START_BIT_POSITION),
            get(data, DEBT_CEILING_MASK, DEBT_CEILING_START_BIT_POSITION),
            get(data, LIQUIDATION_PROTOCOL_FEE_MASK, LIQUIDATION_PROTOCOL_FEE_START_BIT_POSITION),
            get(data, UNBACKED_MINT_CAP_MASK, UNBACKED_MINT_CAP_START_BIT_POSITION),
            category,

        // other fields
            await rd.liquidityIndex,
            await rd.currentLiquidityRate,
            await rd.variableBorrowIndex,
            await rd.currentVariableBorrowRate,
            await rd.currentStableBorrowRate,
            await rd.lastUpdateTimestamp,
            await rd.id,
            await rd.aTokenAddress,
            await rd.stableDebtTokenAddress,
            await rd.variableDebtTokenAddress,
            await rd.interestRateStrategyAddress,
            await rd.accruedToTreasury,
            await rd.unbacked,
            await rd.isolationModeTotalDebt
        ];

        if (! category.eq(0)) {
            const categoryData = await funcGetECategoryData(category.toNumber());
            if (categoryData) {
                line = [...line, ...categoryData];
            }
        }

        dest.push(line.map(x => toString(x)).join(","));
    }

    return dest;
}

/** Download detailed info for all available AAVE pools
 *
 * npx hardhat run scripts/data/lending/aave/DownloadAavePools.ts
 * */
async function main() {
    const signer = (await ethers.getSigners())[0];
    console.log("getInfoAboutFusePools");

    const net = await ethers.provider.getNetwork();
    console.log(net, network.name);

    // https://docs.aave.com/developers/deployed-contracts/v3-mainnet/polygon
    const AAVE_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";

    const aavePool: IAavePool = IAavePool__factory.connect(AAVE_POOL, signer);

    const lines = await getAavePoolReserves(signer, aavePool);
    writeFileSync('./tmp/aave_reserves.csv', lines.join("\n"), 'utf8');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });