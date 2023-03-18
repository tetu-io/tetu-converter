// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IKeeperCallback.sol";
import "hardhat/console.sol";

/// @notice Register all calls of requireRepay
contract KeeperCallbackMock is IKeeperCallback {
  struct RequireRepayInputParams {
    uint countCalls;
    uint requiredAmountBorrowAsset;
    uint requiredAmountCollateralAsset;
    address lendingPoolAdapter;
  }

  /// @notice lendingPoolAdapter => RequireRepayInputParams
  mapping (address => RequireRepayInputParams) public requireRepayCalls;

  function requireRepay(
    uint requiredAmountBorrowAsset_,
    uint requiredAmountCollateralAsset_,
    address lendingPoolAdapter_
  ) external override {
    console.log("KeeperCallbackMock.requireRepay");
    requireRepayCalls[lendingPoolAdapter_] = RequireRepayInputParams({
      countCalls: requireRepayCalls[lendingPoolAdapter_].countCalls + 1,
      requiredAmountBorrowAsset: requiredAmountBorrowAsset_,
      requiredAmountCollateralAsset: requiredAmountCollateralAsset_,
      lendingPoolAdapter: lendingPoolAdapter_
    });
  }
}
