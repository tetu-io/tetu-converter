// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from zkevm.0x965EBb30f4FCC682f1C3Ef0C5c3a6F5aEbeA4eD6, events were removed
interface IZerovixInterestRateModel {
  function getBorrowRate(uint256 cash, uint256 borrows, uint256 reserves) external pure returns (uint256 borrowAPR);

  function getSupplyRate(uint256 cash, uint256 borrows, uint256 reserves, uint256 reserveFactorMantissa ) external pure returns (uint256 supplyRate);

  function isInterestRateModel() external view returns (bool);

  function timestampsPerYear() external view returns (uint256);

  function utilizationRate(uint256 cash, uint256 borrows, uint256 reserves) external pure returns (uint256);
}