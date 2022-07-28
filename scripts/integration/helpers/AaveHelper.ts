import {BigNumber, BigNumberish, Bytes} from "ethers";
import {
    IAaveAddressesProvider,
    IAaveAddressesProvider__factory,
    IAavePool,
    IAavePool__factory,
    IAavePriceOracle, IAavePriceOracle__factory,
    IAaveProtocolDataProvider,
    IAaveProtocolDataProvider__factory,
    IERC20Extended__factory
} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DataTypes} from "../../../typechain/contracts/integrations/aave/IAavePool";

// https://docs.aave.com/developers/deployed-contracts/v3-mainnet/polygon
const AAVE_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";

const FULL_MASK =                      "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";

//region aave-v3-core: ReserveConfiguration.sol
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
//endregion aave-v3-core: ReserveConfiguration.sol

//region Data types
export interface ReserveLiquidity {
    totalAToken: BigNumber;
    totalStableDebt: BigNumber;
    totalVariableDebt: BigNumber;
}

export interface ReserveData {
    ltv: BigNumber;
    liquidationThreshold: BigNumber;
    liquidationBonus: BigNumber;
    decimals: number;
    active: boolean;
    frozen: boolean;
    paused: boolean;
    borrowableInIsolationMode: boolean;
    siloedBorrowing: boolean;
    borrowing: boolean;
    stableBorrowing: boolean;
    reserveFactor: BigNumber;
    borrowCap: BigNumber;
    supplyCap: BigNumber;
    debtCeiling: BigNumber;
    liquidationProtocolFee: BigNumber;
    unbackedMintCap: BigNumber;
    emodeCategory: number;

    liquidityIndex: BigNumberish;
    currentLiquidityRate: BigNumberish;
    variableBorrowIndex: BigNumberish;
    currentVariableBorrowRate: BigNumberish;
    currentStableBorrowRate: BigNumberish;
    lastUpdateTimestamp: BigNumberish;
    id: BigNumberish;
    aTokenAddress: string;
    stableDebtTokenAddress: string;
    variableDebtTokenAddress: string;
    interestRateStrategyAddress: string;
    accruedToTreasury: BigNumberish;
    unbacked: BigNumberish;
    isolationModeTotalDebt: BigNumberish;
}

export interface CategoryData {
    ltv: BigNumber | number;
    liquidationThreshold: BigNumber | number;
    liquidationBonus: BigNumber | number;
    priceSource: string;
    label: string;
}

export interface ReserveInfo {
    reserveName: string;
    reserveAddress: string;

    liquidity: ReserveLiquidity;
    data: ReserveData;
    category?: CategoryData;
}
//endregion Data types

export class AaveHelper {
//region Instance
    private funcGetECategoryData: (category: number) => Promise<CategoryData>;

    constructor(signer: SignerWithAddress) {
        this.funcGetECategoryData = AaveHelper.memoize(category => AaveHelper.getEModeCategory(
            AaveHelper.getAavePool(signer)
            , category
        ));
    }

    public async getReserveInfo(
        signer: SignerWithAddress,
        aavePool: IAavePool,
        dp: IAaveProtocolDataProvider,
        reserve: string
    ) : Promise<ReserveInfo> {
        const rd: DataTypes.ReserveDataStruct = await aavePool.getReserveData(reserve);

        const rawData: BigNumber = BigNumber.from(rd.configuration.data);

        const name = await IERC20Extended__factory.connect(reserve, signer).name();
        const decimals = await IERC20Extended__factory.connect(reserve, signer).decimals();
        const category = AaveHelper.get(rawData, EMODE_CATEGORY_MASK, EMODE_CATEGORY_START_BIT_POSITION).toNumber();

        const categoryData: CategoryData | undefined = category
            ? await this.funcGetECategoryData(category)
            : undefined;

        const reserveData = await dp.getReserveData(reserve);

        const liquidityData: ReserveLiquidity = {
            totalAToken: reserveData.totalAToken,
            totalStableDebt: reserveData.totalStableDebt,
            totalVariableDebt: reserveData.totalVariableDebt
        }

        const data: ReserveData = {
            ltv: AaveHelper.get(rawData, LTV_MASK, 0),
            liquidationThreshold: AaveHelper.get(rawData, LIQUIDATION_THRESHOLD_MASK, LIQUIDATION_THRESHOLD_START_BIT_POSITION),
            liquidationBonus: AaveHelper.get(rawData, LIQUIDATION_BONUS_MASK, LIQUIDATION_BONUS_START_BIT_POSITION),
            decimals: AaveHelper.get(rawData, DECIMALS_MASK, RESERVE_DECIMALS_START_BIT_POSITION).toNumber(),
            active: AaveHelper.getBitValue(rawData, ACTIVE_MASK),
            frozen: AaveHelper.getBitValue(rawData, FROZEN_MASK),
            paused: AaveHelper.getBitValue(rawData, PAUSED_MASK),
            borrowableInIsolationMode: AaveHelper.getBitValue(rawData, BORROWABLE_IN_ISOLATION_MASK),
            siloedBorrowing: AaveHelper.getBitValue(rawData, SILOED_BORROWING_MASK),
            borrowing: AaveHelper.getBitValue(rawData, BORROWING_MASK),
            stableBorrowing: AaveHelper.getBitValue(rawData, STABLE_BORROWING_MASK),
            reserveFactor: AaveHelper.get(rawData, RESERVE_FACTOR_MASK, RESERVE_FACTOR_START_BIT_POSITION),
            borrowCap: AaveHelper.get(rawData, BORROW_CAP_MASK, BORROW_CAP_START_BIT_POSITION),
            supplyCap: AaveHelper.get(rawData, SUPPLY_CAP_MASK, SUPPLY_CAP_START_BIT_POSITION),
            debtCeiling: AaveHelper.get(rawData, DEBT_CEILING_MASK, DEBT_CEILING_START_BIT_POSITION),
            liquidationProtocolFee: AaveHelper.get(rawData, LIQUIDATION_PROTOCOL_FEE_MASK, LIQUIDATION_PROTOCOL_FEE_START_BIT_POSITION),
            unbackedMintCap: AaveHelper.get(rawData, UNBACKED_MINT_CAP_MASK, UNBACKED_MINT_CAP_START_BIT_POSITION),
            emodeCategory: category,

            // other fields
            liquidityIndex: await rd.liquidityIndex,
            currentLiquidityRate: await rd.currentLiquidityRate,
            variableBorrowIndex: await rd.variableBorrowIndex,
            currentVariableBorrowRate: await rd.currentVariableBorrowRate,
            currentStableBorrowRate: await rd.currentStableBorrowRate,
            lastUpdateTimestamp: await rd.lastUpdateTimestamp,
            id: await rd.id,
            aTokenAddress: await rd.aTokenAddress,
            stableDebtTokenAddress: await rd.stableDebtTokenAddress,
            variableDebtTokenAddress: await rd.variableDebtTokenAddress,
            interestRateStrategyAddress: await rd.interestRateStrategyAddress,
            accruedToTreasury: await rd.accruedToTreasury,
            unbacked: await rd.unbacked,
            isolationModeTotalDebt: await rd.isolationModeTotalDebt
        }

        return {
            reserveName: name,
            category: categoryData,
            reserveAddress: reserve,
            liquidity: liquidityData,
            data: data
        }
    }
//endregion Instance

//region Access
    public static getAavePool(signer: SignerWithAddress): IAavePool {
        return IAavePool__factory.connect(AAVE_POOL, signer);
    }
    public static async getAaveAddressesProvider(signer: SignerWithAddress): Promise<IAaveAddressesProvider> {
        return IAaveAddressesProvider__factory.connect(
            await AaveHelper.getAavePool(signer).ADDRESSES_PROVIDER()
            , signer
        );
    }
    public static async getAaveProtocolDataProvider(signer: SignerWithAddress): Promise<IAaveProtocolDataProvider> {
        return IAaveProtocolDataProvider__factory.connect(
            await(await AaveHelper.getAaveAddressesProvider(signer)).getPoolDataProvider(), signer);
    }
    public static async getAavePriceOracle(signer: SignerWithAddress): Promise<IAavePriceOracle> {
        return IAavePriceOracle__factory.connect(
            await(await AaveHelper.getAaveAddressesProvider(signer)).getPriceOracle(), signer);
    }
//endregion Access

//region Read data
    public static async getEModeCategory(aavePool: IAavePool, category: number) : Promise<CategoryData> {
        console.log("getEModeCategory", category);
        const data = await aavePool.getEModeCategoryData(category);

        return {
            ltv: data.ltv,
            liquidationThreshold: data.liquidationThreshold,
            liquidationBonus: data.liquidationBonus,
            priceSource: data.priceSource,
            label: data.label
        };
    }
//endregion Read data

//region Utils
    public static get(configuration: BigNumber, mask: string, shift: number): BigNumber {
        const fullMask = BigNumber.from(FULL_MASK);
        return configuration.and(BigNumber.from(mask).xor(fullMask)).shr(shift);
    }

    public static getBitValue(configuration: BigNumber, mask: string): boolean {
        const fullMask = BigNumber.from(FULL_MASK);
        return ! configuration.and(BigNumber.from(mask).xor(fullMask)).eq(0);
    }

    public static toString(n: BigNumberish | boolean) : string {
        return typeof n === "object" && n.toString()
            ? n.toString()
            : "" + n;
    }

    public static memoize<T>(fn: (category: number) => Promise<T>) : (category: number) => Promise<T> {
        const cache = new Map<number, T>();
        return async (category: number) => {
            let ret = cache.get(category);
            if (!ret) {
                ret = await fn(category);
                cache.set(category, ret);
            }
            return ret;
        }
    }
//endregion Utils
}