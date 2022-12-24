// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

interface IHealthKeeperCallback {
  function nextIndexToCheck0() external view returns (uint);

  function fixHealth(
    uint nextIndexToCheck0_,
    address[] calldata outPoolAdapters_,
    uint[] calldata outAmountBorrowAsset_,
    uint[] calldata outAmountCollateralAsset_
  ) external;
}
