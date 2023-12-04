// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from 0x5D3473BdE2c8b408584DDb8CBBb8925F33c01fA7
interface IKeomInterestRateModel {
  function getBorrowRate(uint256 cash, uint256 borrows, uint256 reserves) external pure returns (uint256 borrowAPR);

  function getSupplyRate(uint256 cash, uint256 borrows, uint256 reserves, uint256 reserveFactorMantissa) external pure returns (uint256 supplyRate);

  function isInterestRateModel() external view returns (bool);

  function timestampsPerYear() external view returns (uint256);

  function utilizationRate(uint256 cash, uint256 borrows, uint256 reserves) external pure returns (uint256);
}

