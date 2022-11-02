// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../interfaces/IHealthKeeperCallback.sol";

/// @notice Allow to control calls of fixHealth
contract KeeperMock is IHealthKeeperCallback {
  struct LastFixHealthParams {
    uint countCalls;
    uint nextIndexToCheck0;
    address[] poolAdapters;
    uint[] amountBorrowAsset;
    uint[] amountCollateralAsset;
  }
  LastFixHealthParams public lastFixHealthParams;

  uint256 public override nextIndexToCheck0;

  constructor(uint nextIndexToCheck0_) {
    nextIndexToCheck0 = nextIndexToCheck0_;
  }

  function setNextIndexToCheck0(uint nextIndexToCheck0_) external {
    nextIndexToCheck0 = nextIndexToCheck0_;
  }

  function fixHealth(
    uint nextIndexToCheck0_,
    address[] memory poolAdapters_,
    uint[] memory amountBorrowAsset_,
    uint[] memory amountCollateralAsset_
  ) external override {
    nextIndexToCheck0 = nextIndexToCheck0_;

    lastFixHealthParams = LastFixHealthParams({
      countCalls: lastFixHealthParams.countCalls + 1,
      nextIndexToCheck0: nextIndexToCheck0_,
      poolAdapters: poolAdapters_,
      amountBorrowAsset: amountBorrowAsset_,
      amountCollateralAsset: amountCollateralAsset_
    });
  }
}