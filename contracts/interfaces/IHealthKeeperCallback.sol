// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

interface IHealthKeeperCallback {
  function nextIndexToCheck0() external view returns (uint);

  function fixHealth(
    uint nextIndexToCheck0,
    address[] memory outPoolAdapters,
    uint[] memory outAmountBorrowAsset,
    uint[] memory outAmountCollateralAsset
  ) external;
}