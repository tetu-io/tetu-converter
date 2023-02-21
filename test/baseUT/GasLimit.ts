/**
 * Approx up-limits by gas for various operations under test
 */
export const GAS_LIMIT_BM_FIND_POOL_1 = 100_000;
export const GAS_LIMIT_BM_FIND_POOL_5 = 320_000;
export const GAS_LIMIT_BM_FIND_POOL_10 = 383_000;
export const GAS_LIMIT_BM_FIND_POOL_100 = 3_710_000;

export const GAS_LIMIT_CONTROLLER_INITIALIZE = 253_000;

export const GAS_LIMIT_INIT_BORROW_AAVE3 = 1_675_056;
export const GAS_LIMIT_REPAY_AAVE3 = 988_205;
export const GAS_LIMIT_INIT_BORROW_AAVE_TWO = 1_752_378;
export const GAS_LIMIT_REPAY_AAVE_TWO = 1_115_137;
export const GAS_LIMIT_INIT_BORROW_HUNDRED_FINANCE =  1_751_664; // 1_031_596;
export const GAS_LIMIT_REPAY_HUNDRED_FINANCE =  999_337;
export const GAS_LIMIT_INIT_BORROW_DFORCE = 1_850_000;
export const GAS_LIMIT_REPAY_DFORCE = 841_876;

export const GAS_FIND_CONVERSION_STRATEGY_ONLY_BORROW_AVAILABLE = 255_000;
export const GAS_TC_BORROW = 1_060_000;
export const GAS_TC_REPAY = 304_000;
export const GAS_TC_QUOTE_REPAY = 33_000;
export const GAS_TC_SAFE_LIQUIDATE = 174_000;

export const GAS_FIND_SWAP_STRATEGY = 240_000;
export const GAS_SWAP_SIMULATE = 212_000;
export const GAS_SWAP = 211_000;
export const GAS_SWAP_APR18 = 43_400;

export const GAS_SWAP_LIB_CONVERT_USING_PRICE_ORACLE = 43_000;
export const GAS_SWAP_LIB_IS_CONVERSION_VALID = 44_000;

export const GAS_LIMIT_SWAP_MANAGER_GET_CONVERTER = 420_000;

export const GAS_LIMIT_AAVE_TWO_GET_CONVERSION_PLAN = 291_000;
export const GAS_LIMIT_AAVE_3_GET_CONVERSION_PLAN = 315_100;
export const GAS_LIMIT_DFORCE_GET_CONVERSION_PLAN = 365_300;
export const GAS_LIMIT_HUNDRED_FINANCE_GET_CONVERSION_PLAN = 254_000;

export const GAS_LIMIT_DM_ON_OPEN_POSITION = 286_000;
export const GAS_LIMIT_DM_ON_CLOSE_POSITION = 140_000;

export const GAS_LIMIT_QUOTE_REPAY_AAVE3 = 152_000;
export const GAS_LIMIT_QUOTE_REPAY_AAVE_TWO = 162_000;
export const GAS_LIMIT_QUOTE_REPAY_DFORCE = 112_000;
export const GAS_LIMIT_QUOTE_REPAY_HUNDRED_FINANCE = 147_000;

export const GAS_LIMIT_QUOTE_REPAY_AAVE3_WITH_SWAP = 201_000;
export const GAS_LIMIT_QUOTE_REPAY_AAVE_TWO_WITH_SWAP = 230_000;
export const GAS_LIMIT_QUOTE_REPAY_DFORCE_WITH_SWAP = 160_000;
export const GAS_LIMIT_QUOTE_REPAY_HUNDRED_FINANCE_WITH_SWAP = 192_000;

export const GAS_LIMIT_ENTRY_KINDS_GET_ENTRY_KIND = 23_000;
export const GAS_LIMIT_ENTRY_KINDS_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT = 25_000;
export const GAS_LIMIT_ENTRY_KINDS_EXACT_PROPORTIONS = 27_000;
export const GAS_LIMIT_ENTRY_KINDS_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN = 24_000;

export const GAS_APP_UTILS_SHRINK_AND_ORDER = 43_000;
