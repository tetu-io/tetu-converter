// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

///@notice Restored from 0xbc93DdFAE192926BE036c6A6Dd544a0e250Ab97D
interface IMoonwellInterestRateModel {
  event NewInterestParams(
    uint256 baseRatePerTimestamp,
    uint256 multiplierPerTimestamp,
    uint256 jumpMultiplierPerTimestamp,
    uint256 kink
  );

  function baseRatePerTimestamp() external view returns (uint256);

  function getBorrowRate(uint256 cash, uint256 borrows, uint256 reserves) external view returns (uint256);

  function getSupplyRate(uint256 cash, uint256 borrows, uint256 reserves, uint256 reserveFactorMantissa) external view returns (uint256);

  function isInterestRateModel() external view returns (bool);

  function jumpMultiplierPerTimestamp() external view returns (uint256);

  function kink() external view returns (uint256);

  function multiplierPerTimestamp() external view returns (uint256);

  function timestampsPerYear() external view returns (uint256);

  function utilizationRate(uint256 cash, uint256 borrows, uint256 reserves) external pure returns (uint256);
}
