import {BigNumber, BigNumberish, Bytes} from "ethers";
import {
  IAaveTwoLendingPoolAddressesProvider,
  IAaveTwoLendingPoolAddressesProvider__factory,
  IAaveTwoPool,
  IAaveTwoPool__factory, IAaveTwoPriceOracle, IAaveTwoPriceOracle__factory,
  IAaveTwoProtocolDataProvider,
  IAaveTwoProtocolDataProvider__factory,
  IERC20Extended__factory
} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MaticAddresses} from "../../addresses/MaticAddresses";
import {DataTypes} from "../../../typechain/contracts/integrations/aaveTwo/IAaveTwoPool";
import {ReserveLtvConfig} from "./Aave3Helper";

const AAVE_POOL = MaticAddresses.AAVE_TWO_POOL;

const FULL_MASK =                      "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";

//region aave-v2-core: ReserveConfiguration.sol
const LTV_MASK =                       "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000";
const LIQUIDATION_THRESHOLD_MASK =     "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000FFFF";
const LIQUIDATION_BONUS_MASK =         "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000FFFFFFFF";
const DECIMALS_MASK =                  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00FFFFFFFFFFFF";
const ACTIVE_MASK =                    "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFF";
const FROZEN_MASK =                    "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFDFFFFFFFFFFFFFF";
const BORROWING_MASK =                 "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFBFFFFFFFFFFFFFF";
const STABLE_BORROWING_MASK =          "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF7FFFFFFFFFFFFFF";
const RESERVE_FACTOR_MASK =            "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000FFFFFFFFFFFFFFFF";


/// @dev For the LTV, the start bit is 0 (up to 15), hence no bitshifting is needed
const LIQUIDATION_THRESHOLD_START_BIT_POSITION = 16;
const LIQUIDATION_BONUS_START_BIT_POSITION = 32;
const RESERVE_DECIMALS_START_BIT_POSITION = 48;
const IS_ACTIVE_START_BIT_POSITION = 56;
const IS_FROZEN_START_BIT_POSITION = 57;
const BORROWING_ENABLED_START_BIT_POSITION = 58;
const STABLE_BORROWING_ENABLED_START_BIT_POSITION = 59;
const RESERVE_FACTOR_START_BIT_POSITION = 64;

const MAX_VALID_LTV = 65535;
const MAX_VALID_LIQUIDATION_THRESHOLD = 65535;
const MAX_VALID_LIQUIDATION_BONUS = 65535;
const MAX_VALID_DECIMALS = 255;
const MAX_VALID_RESERVE_FACTOR = 65535;
//endregion aave-v3-core: ReserveConfiguration.sol

//region Data types
export interface ReserveLiquidity {
  availableLiquidity: BigNumber;
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
  borrowing: boolean;
  stableBorrowing: boolean;
  reserveFactor: BigNumber;

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

  price: BigNumber;
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
  reserveSymbol: string;
  reserveAddress: string;
  aTokenName: string;
  aTokenAddress: string;
  aTokenSymbol: string;

  liquidity: ReserveLiquidity;
  data: ReserveData;
}
//endregion Data types

export class AaveTwoHelper {
//region Read reserve info
  public static async getReserveInfo(
    signer: SignerWithAddress,
    aavePool: IAaveTwoPool,
    dp: IAaveTwoProtocolDataProvider,
    reserve: string
  ) : Promise<ReserveInfo> {
    const rd: DataTypes.ReserveDataStruct = await aavePool.getReserveData(reserve);
    const priceOracle = await AaveTwoHelper.getAavePriceOracle(signer);

    const rawData: BigNumber = BigNumber.from(rd.configuration.data);

    const reserveName = await IERC20Extended__factory.connect(reserve, signer).name();
    const reserveSymbol = await IERC20Extended__factory.connect(reserve, signer).name();
    const aTokenName = await IERC20Extended__factory.connect(await rd.aTokenAddress, signer).name();
    const aTokenSymbol = await IERC20Extended__factory.connect(await rd.aTokenAddress, signer).name();
    const decimals = await IERC20Extended__factory.connect(reserve, signer).decimals();

    const reserveData = await dp.getReserveData(reserve);

    const liquidityData: ReserveLiquidity = {
      availableLiquidity: reserveData.availableLiquidity,
      totalStableDebt: reserveData.totalStableDebt,
      totalVariableDebt: reserveData.totalVariableDebt
    }

    const data: ReserveData = {
      ltv: AaveTwoHelper.get(rawData, LTV_MASK, 0),
      liquidationThreshold: AaveTwoHelper.get(rawData, LIQUIDATION_THRESHOLD_MASK, LIQUIDATION_THRESHOLD_START_BIT_POSITION),
      liquidationBonus: AaveTwoHelper.get(rawData, LIQUIDATION_BONUS_MASK, LIQUIDATION_BONUS_START_BIT_POSITION),
      decimals: AaveTwoHelper.get(rawData, DECIMALS_MASK, RESERVE_DECIMALS_START_BIT_POSITION).toNumber(),
      active: AaveTwoHelper.getBitValue(rawData, ACTIVE_MASK),
      frozen: AaveTwoHelper.getBitValue(rawData, FROZEN_MASK),
      borrowing: AaveTwoHelper.getBitValue(rawData, BORROWING_MASK),
      stableBorrowing: AaveTwoHelper.getBitValue(rawData, STABLE_BORROWING_MASK),
      reserveFactor: AaveTwoHelper.get(rawData, RESERVE_FACTOR_MASK, RESERVE_FACTOR_START_BIT_POSITION),

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

      price: await priceOracle.getAssetPrice(reserve)
    }

    return {
      reserveName: reserveName,
      reserveSymbol: reserveSymbol,
      reserveAddress: reserve,
      aTokenSymbol: aTokenSymbol,
      aTokenAddress: await rd.aTokenAddress,
      aTokenName: aTokenName,
      liquidity: liquidityData,
      data: data
    }
  }

  public static async getReserveLtvConfig(aavePool: IAaveTwoPool, reserve: string): Promise<ReserveLtvConfig> {
    const rd: DataTypes.ReserveDataStruct = await aavePool.getReserveData(reserve);
    const rawData: BigNumber = BigNumber.from(rd.configuration.data);

    return {
      ltv: AaveTwoHelper.get(rawData, LTV_MASK, 0),
      liquidationThreshold: AaveTwoHelper.get(rawData, LIQUIDATION_THRESHOLD_MASK, LIQUIDATION_THRESHOLD_START_BIT_POSITION),
      liquidationBonus: AaveTwoHelper.get(rawData, LIQUIDATION_BONUS_MASK, LIQUIDATION_BONUS_START_BIT_POSITION),
    }
  }
//endregion Read reserve info

//region Access
  public static getAavePool(signer: SignerWithAddress): IAaveTwoPool {
    return IAaveTwoPool__factory.connect(AAVE_POOL, signer);
  }
  public static async getAaveAddressesProvider(signer: SignerWithAddress): Promise<IAaveTwoLendingPoolAddressesProvider> {
    return IAaveTwoLendingPoolAddressesProvider__factory.connect(
      await AaveTwoHelper.getAavePool(signer).getAddressesProvider()
      , signer
    );
  }
  public static async getPriceOracle(signer: SignerWithAddress): Promise<IAaveTwoPriceOracle> {
    const ap = await AaveTwoHelper.getAaveAddressesProvider(signer);
    return IAaveTwoPriceOracle__factory.connect(await ap.getPriceOracle(), signer);
  }
  public static async getAaveProtocolDataProvider(signer: SignerWithAddress): Promise<IAaveTwoProtocolDataProvider> {
    const ap = await AaveTwoHelper.getAaveAddressesProvider(signer);
    const dp = await(ap).getAddress(
      [0x1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
    );
    console.log(dp);
    return IAaveTwoProtocolDataProvider__factory.connect(dp, signer);
  }
  public static async getAavePriceOracle(signer: SignerWithAddress): Promise<IAaveTwoPriceOracle> {
    return IAaveTwoPriceOracle__factory.connect(
      await(await AaveTwoHelper.getAaveAddressesProvider(signer)).getPriceOracle(), signer);
  }
//endregion Access

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
//endregion Utils
}