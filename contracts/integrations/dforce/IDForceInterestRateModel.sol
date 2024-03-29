//SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/**
 * @notice Sources: https://github.com/dforce-network/LendingContractsV2
 */
interface IDForceInterestRateModel {
  function isInterestRateModel() external view returns (bool);

  function blocksPerYear() external view returns (uint256);

  /**
   * @dev Calculates the current borrow interest rate per block.
     * @param cash The total amount of cash the market has.
     * @param borrows The total amount of borrows the market has.
     * @param reserves The total amount of reserves the market has.
     * @return The borrow rate per block (as a percentage, and scaled by 1e18).
     */
  function getBorrowRate(
    uint256 cash,
    uint256 borrows,
    uint256 reserves
  ) external view returns (uint256);

  /**
   * @dev Calculates the current supply interest rate per block.
     * @param cash The total amount of cash the market has.
     * @param borrows The total amount of borrows the market has.
     * @param reserves The total amount of reserves the market has.
     * @param reserveRatio The current reserve factor the market has.
     * @return The supply rate per block (as a percentage, and scaled by 1e18).
     */
  function getSupplyRate(
    uint256 cash,
    uint256 borrows,
    uint256 reserves,
    uint256 reserveRatio
  ) external view returns (uint256);
}
