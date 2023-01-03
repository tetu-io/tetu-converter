// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/**
 * @notice Interface for the calculation of the interest rates
   @dev Created using aave-v2-protocol, IReserveInterestRateStrategy
 */
interface IAaveTwoReserveInterestRateStrategy {
  function baseVariableBorrowRate() external view returns (uint256);
  function getMaxVariableBorrowRate() external view returns (uint256);

  /**
   * @dev Calculates the interest rates depending on the reserve's state and configurations
   * @param reserve The address of the reserve
   * @param liquidityAdded The liquidity added during the operation
   * @param liquidityTaken The liquidity taken during the operation
   * @param totalStableDebt The total borrowed from the reserve a stable rate
   * @param totalVariableDebt The total borrowed from the reserve at a variable rate
   * @param averageStableBorrowRate The weighted average of all the stable rate loans
   * @param reserveFactor The reserve portion of the interest that goes to the treasury of the market
   **/
  function calculateInterestRates(
    address reserve,
    address aToken,
    uint256 liquidityAdded,
    uint256 liquidityTaken,
    uint256 totalStableDebt,
    uint256 totalVariableDebt,
    uint256 averageStableBorrowRate,
    uint256 reserveFactor
  ) external view returns (
    uint256 liquidityRate,
    uint256 stableBorrowRate,
    uint256 variableBorrowRate
  );
}
