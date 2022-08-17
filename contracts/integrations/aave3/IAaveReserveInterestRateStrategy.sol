// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice Restored from 0xA9F3C3caE095527061e6d270DBE163693e6fda9D
interface IAaveReserveInterestRateStrategy {
  function ADDRESSES_PROVIDER() external view returns (address);

  /**
   * @dev This constant represents the excess stable debt ratio above the optimal. It's always equal to
   * 1-optimal stable to total debt ratio. Added as a constant here for gas optimizations.
   * Expressed in ray
   **/
  function MAX_EXCESS_STABLE_TO_TOTAL_DEBT_RATIO()
  external
  view
  returns (uint256);

  /**
   * @dev This constant represents the excess usage ratio above the optimal. It's always equal to
   * 1-optimal usage ratio. Added as a constant here for gas optimizations.
   * Expressed in ray
   **/
  function MAX_EXCESS_USAGE_RATIO() external view returns (uint256);

  /**
   * @dev This constant represents the optimal stable debt to total debt ratio of the reserve.
   * Expressed in ray
   */
  function OPTIMAL_STABLE_TO_TOTAL_DEBT_RATIO()
  external
  view
  returns (uint256);

  /**
   * @dev This constant represents the usage ratio at which the pool aims to obtain most competitive borrow rates.
   * Expressed in ray
   **/
  function OPTIMAL_USAGE_RATIO() external view returns (uint256);


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
    DataTypes.CalculateInterestRatesParams memory params
  )
  external
  view
  returns (
    uint256,
    uint256,
    uint256
  );

  /**
 * @notice Returns the base stable borrow rate
   * @return The base stable borrow rate
   **/
  function getBaseStableBorrowRate() external view returns (uint256);


  /**
 * @notice Returns the stable rate excess offset
   * @dev An additional premium applied to the stable when stable debt > OPTIMAL_STABLE_TO_TOTAL_DEBT_RATIO
   * @return The stable rate excess offset
   */
  function getStableRateExcessOffset() external view returns (uint256);

  /**
   * @notice Returns the stable rate slope below optimal usage ratio
   * @dev Its the stable rate when usage ratio > 0 and <= OPTIMAL_USAGE_RATIO
   * @return The stable rate slope
   **/
  function getStableRateSlope1() external view returns (uint256);

  /**
   * @notice Returns the stable rate slope above optimal usage ratio
   * @dev Its the variable rate when usage ratio > OPTIMAL_USAGE_RATIO
   * @return The stable rate slope
   **/
  function getStableRateSlope2() external view returns (uint256);

  /**
   * @notice Returns the variable rate slope below optimal usage ratio
   * @dev Its the variable rate when usage ratio > 0 and <= OPTIMAL_USAGE_RATIO
   * @return The variable rate slope
   **/
  function getVariableRateSlope1() external view returns (uint256);

  /**
   * @notice Returns the variable rate slope above optimal usage ratio
   * @dev Its the variable rate when usage ratio > OPTIMAL_USAGE_RATIO
   * @return The variable rate slope
   **/
  function getVariableRateSlope2() external view returns (uint256);
}

interface DataTypes {
  struct CalculateInterestRatesParams {
    uint256 unbacked;
    uint256 liquidityAdded;
    uint256 liquidityTaken;
    uint256 totalStableDebt;
    uint256 totalVariableDebt;
    uint256 averageStableBorrowRate;
    uint256 reserveFactor;
    address reserve;
    address aToken;
  }
}