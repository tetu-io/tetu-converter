// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IHealthKeeperCallback.sol";
import "hardhat/console.sol";
import "../../integrations/gelato/IResolver.sol";

/// @notice Allow to control calls of fixHealth
contract KeeperMock is IHealthKeeperCallback, IResolver {
  struct LastFixHealthParams {
    uint countCalls;
    uint nextIndexToCheck0;
    address[] poolAdapters;
    uint[] amountBorrowAsset;
    uint[] amountCollateralAsset;
  }
  LastFixHealthParams public lastFixHealthParams;

  uint256 public override nextIndexToCheck0;
  address private _checker;

  constructor(uint nextIndexToCheck0_) {
    nextIndexToCheck0 = nextIndexToCheck0_;
  }
  function init(address checker_) external {
    _checker = checker_;
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
    console.log("KeeperMock.fixHealth");
    nextIndexToCheck0 = nextIndexToCheck0_;

    lastFixHealthParams = LastFixHealthParams({
      countCalls: lastFixHealthParams.countCalls + 1,
      nextIndexToCheck0: nextIndexToCheck0_,
      poolAdapters: poolAdapters_,
      amountBorrowAsset: amountBorrowAsset_,
      amountCollateralAsset: amountCollateralAsset_
    });
  }

  function checker() external view override returns (bool canExec, bytes memory execPayload) {
    return IResolver(_checker).checker();
  }
}
