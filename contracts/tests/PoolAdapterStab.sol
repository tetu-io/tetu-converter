// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IPoolAdapter.sol";
import "hardhat/console.sol";

/// @notice Simple implementation of pool adapter, all params are set through constructor
contract PoolAdapterStab is IPoolAdapter {
  address public controller;
  address private _pool;
  address private _user;
  address private _collateralAsset;
  address private _borrowAsset;

  uint public collateralFactorValue;

  /// @notice Real implementation of IPoolAdapter cannot use constructors  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  ///         because pool-adapters are created using minimanl-proxy pattern
  ///         We use constructor here for test purposes only.
  constructor (uint collateralFactor_) {
    collateralFactorValue = collateralFactor_;
  }

  function initialize(
    address controller_,
    address pool_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external {
    controller = controller_;
    _pool = pool_;
    _user = user_;
    _collateralAsset = collateralAsset_;
    _borrowAsset = borrowAsset_;
  }

  function syncBalance(bool beforeBorrow) external override {
    console.log("syncBalance beforeBorrow=%d", beforeBorrow ? 1 : 0);
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

  /// @notice Supply collateral to the pool and borrow {borrowedAmount_} in {borrowedToken_}
  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) override external {
    console.log("borrow collateral=%s receiver=%s", collateralAmount_, borrowAmount_);
    console.log("borrow borrowAmount=%d", borrowAmount_);
  }

  /// @notice Repay borrowed amount, return collateral to the user
  function repay(
    uint amountToRepay_,
    address receiver_,
    bool closePosition_
  ) override external {
    console.log("repay receiver=%s", receiver_);
    console.log("repay amountToRepay_=%d closePosition_=%d", amountToRepay_, closePosition_ ? 1 : 0);
  }

  function getConfig() external view override returns (
    address pool,
    address user,
    address collateralAsset,
    address borrowAsset
  ) {
    return (_pool, _user, _collateralAsset, _borrowAsset);
  }

  /// @notice Get current status of the borrow position
  /// @return collateralAmount Total amount of provided collateral in [collateral asset]
  /// @return amountToPay Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
  /// @return healthFactorWAD Current health factor, decimals 18
  function getStatus() external view override returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactorWAD
  ) {
    return (collateralAmount, amountToPay, healthFactorWAD);
  }
}