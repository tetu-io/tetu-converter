// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice Utils shared by all AAVE protocols
library AaveSharedLib {
  uint constant public COUNT_SECONDS_PER_YEAR = 365 days; // 31536000;
  uint constant public RAY = 1e27;
  uint constant public HALF_RAY = 0.5e27;

  struct State {
    uint liquidityIndex;
    uint lastUpdateTimestamp;
    uint rate;
  }

  //////////////////////////////////////////////////////////////////////////
  // APR for period = result income/debt in period
  //                  without any compound
  // APR = user-balance-after - user-balance-before
  // where user-balance = scaled-user-balance * N * price
  // So,
  //      APR = (SB_1 - SB_0) * N * price
  // where N = normalized income / debt (for collateral / borrow)
  //       N = rayMul(RAY + rate * dT / Sy, LI)
  //       rayMul(x, y) => (x * y + HALF_RAY) / RAY
  // where Sy = seconds per year = 31536000
  //       dT = period in seconds
  //       LI = liquidity index
  //////////////////////////////////////////////////////////////////////////

  /// @notice Calculate APR for period {countBlocks} in the point AFTER supply/borrow operation
  ///         APR is total amount of generated income/debt for the period in the terms of amount's asset
  /// @param amount Amount of collateral or borrow
  /// @param reserveNormalized Current value of normalized income / debt
  /// @param liquidityIndex Value of liquidityIndex / variableBorrowIndex
  /// @param predictedRate Predicted value of liquidity/borrow rate
  /// @param countBlocks Duration of the period in blocks
  /// @param blocksPerDay Count blocks per day (about 40 ths)
  /// @param price18 Price of collateral/borrow asset
  ///                1 token of the amount costs {price18} base tokens
  function getAprForPeriodAfter(
    uint amount,
    uint reserveNormalized,
    uint liquidityIndex,
    uint predictedRate,
    uint countBlocks,
    uint blocksPerDay,
    uint price18
  ) internal pure returns (uint) {
    // calculate income/debt in the period of {countBlocks} since the supply/borrow operation
    uint reserveNormalizedAfterPeriod = rayMul(
      RAY + predictedRate * (
        countBlocks * COUNT_SECONDS_PER_YEAR / (blocksPerDay * 365)  // count seconds
        ) / COUNT_SECONDS_PER_YEAR,
      liquidityIndex
    );

    return reserveNormalizedAfterPeriod < reserveNormalized
      ? 0
      : amount
        * (reserveNormalizedAfterPeriod - reserveNormalized)
        * price18 / 1e18
        / reserveNormalized;
  }

  /// @notice Calculate APR for period {countBlocks} in the point before the supply/borrow operation
  ///         APR is total amount of generated income/debt for the period in the terms of amount's asset
  /// @param amount Amount of collateral or borrow
  /// @param state Current state (before the supply/borrow operation)
  /// @param predictedRate Predicted value of liquidity/borrow rate
  /// @param countBlocks Duration of the period in blocks
  /// @param blocksPerDay Count blocks per day (about 40 ths)
  /// @param price18 Price of collateral/borrow asset
  ///                1 token of the amount costs {price18} base tokens
  function getAprForPeriodBefore(
    State memory state,
    uint amount,
    uint predictedRate,
    uint countBlocks,
    uint blocksPerDay,
    uint price18,
    uint operationTimestamp
  ) internal pure returns (uint) {
    // recalculate reserveNormalized and liquidityIndex
    // after the supply/borrow operation
    uint liquidityIndexAfter = rayMul(
      RAY + (state.rate * (operationTimestamp - state.lastUpdateTimestamp) / COUNT_SECONDS_PER_YEAR),
      state.liquidityIndex
    );

    return getAprForPeriodAfter(
      amount,
      liquidityIndexAfter, // reserveNormalizedAfter is the same as liquidityIndexAfter
      liquidityIndexAfter,
      predictedRate,
      countBlocks,
      blocksPerDay,
      price18
    );
  }

  function rayMul(uint x, uint y) internal pure returns (uint) {
    return (x * y + HALF_RAY) / RAY;
  }
}