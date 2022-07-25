// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IPoolAdapter.sol";
import "hardhat/console.sol";

/// @notice Simple implementation of pool adapter, all params are set through constructor
contract PoolAdapterStab is IPoolAdapter {
  address public poolValue;
  address public userValue;
  address public collateralUnderline;
  uint public collateralFactorValue;

  /// @notice Real implementation of IPoolAdapter cannot use constructors  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  ///         because pool-adapters are created using minimanl-proxy pattern
  ///         We use constructor here for test purposes only.
  constructor (uint collateralFactor_) {
    collateralFactorValue = collateralFactor_;
  }

  function initialize(address pool_, address user_, address collateralUnderline_) external override {
    poolValue = pool_;
    userValue = user_;
    collateralUnderline = collateralUnderline_;
  }

  function collateralToken() external view override returns (address) {
    return collateralUnderline;
  }
  function collateralFactor() external view override returns (uint) {
    return collateralFactorValue;
  }
  function pool() external view override returns (address) {
    return poolValue;
  }
  function user() external view override returns (address) {
    return userValue;
  }

  /// @notice Supply collateral to the pool and borrow {borrowedAmount_} in {borrowedToken_}
  function borrow(
    uint collateralAmount_,
    address borrowedToken_,
    uint borrowedAmount_,
    address receiverBorrowedAmount_
  ) override external {
    console.log("borrow collateral=%s receiver=%s", collateralAmount_, receiverBorrowedAmount_);
    console.log("borrow token=%s amount=%d", borrowedToken_, borrowedAmount_);
  }

  /// @notice How much we should pay to close the borrow
  function getAmountToRepay(address borrowedToken_) external view override returns (uint) {
    return 0;
  }

  /// @notice Repay borrowed amount, return collateral to the user
  function repay(
    address borrowedToken_,
    uint borrowedAmount_,
    address receiverCollateralAmount_
  ) override external {
    console.log("repay receiver=%s", receiverCollateralAmount_);
    console.log("repay token=%s amount=%d", borrowedToken_, borrowedAmount_);
  }

  function getOpenedPositions() external view override returns (
    uint outCountItems,
    address[] memory outBorrowedTokens,
    uint[] memory outCollateralAmountsCT,
    uint[] memory outAmountsToPayBT
  ) {
    return (outCountItems, outBorrowedTokens, outCollateralAmountsCT, outAmountsToPayBT);
  }
}