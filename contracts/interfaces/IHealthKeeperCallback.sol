// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

interface IHealthKeeperCallback {
  function nextIndexToCheck0() external view returns (uint);

  function fixHealth(
    uint nextIndexToCheck0_,
    address[] memory outPoolAdapters_,
    uint[] memory outAmountBorrowAsset_,
    uint[] memory outAmountCollateralAsset_
  ) external;
}