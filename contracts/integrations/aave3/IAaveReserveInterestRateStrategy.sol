// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "./Aave3DataTypes.sol";

/// @notice Interface for the calculation of the interest rates
/// @dev Restored from 0xA9F3C3caE095527061e6d270DBE163693e6fda9D
interface IAaveReserveInterestRateStrategy {
  /**
   * @notice Returns the base variable borrow rate
   * @return The base variable borrow rate, expressed in ray
   **/
  function getBaseVariableBorrowRate() external view returns (uint256);

  /**
   * @notice Returns the maximum variable borrow rate
   * @return The maximum variable borrow rate, expressed in ray
   **/
  function getMaxVariableBorrowRate() external view returns (uint256);

  /**
   * @notice Calculates the interest rates depending on the reserve's state and configurations
   * @param params The parameters needed to calculate interest rates
   * @return liquidityRate The liquidity rate expressed in rays
   * @return stableBorrowRate The stable borrow rate expressed in rays
   * @return variableBorrowRate The variable borrow rate expressed in rays
   **/
  function calculateInterestRates(
    Aave3DataTypes.CalculateInterestRatesParams memory params
  )
  external
  view
  returns (
    uint256,
    uint256,
    uint256
  );
}


