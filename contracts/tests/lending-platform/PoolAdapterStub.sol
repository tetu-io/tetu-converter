// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../../interfaces/IPoolAdapter.sol";
import "hardhat/console.sol";

/// @notice Simple implementation of pool adapter, all params are set through constructor
contract PoolAdapterStub is IPoolAdapter {

  /// @notice Allows to set getStatus result explicitly
  struct ManualStatus {
    uint collateralAmount;
    uint amountToPay;
    uint healthFactor18;
    bool opened;
    uint collateralAmountLiquidated;
    bool debtGapRequired;
  }

  address public controller;
  address private _pool;
  address private _user;
  address private _collateralAsset;
  address private _borrowAsset;
  address private _cTokenMock;
  uint private _collateralFactor;
  uint private _borrowRatePerBlock;

  uint public collateralFactorValue;
  bool private _syncedHideWarning;
  bool private _borrowHideWarning;

  address public priceOracle;
  address public originConverter;

  /// @notice Allows to set getStatus result explicitly
  ManualStatus private _manualStatus;


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
    address borrowAsset_,
    address originConverter_,
    address cTokenMock_,
    uint collateralFactor_,
    uint borrowRatePerBlock_,
    address priceOracle_
  ) external {
    console.log("PoolAdapterStub is initialized:", address(this));

    controller = controller_;
    _pool = pool_;
    _user = user_;
    _collateralAsset = collateralAsset_;
    _borrowAsset = borrowAsset_;
    _cTokenMock = cTokenMock_;
    _collateralFactor = collateralFactor_;
    _borrowRatePerBlock = borrowRatePerBlock_;
    priceOracle = priceOracle_;
    originConverter = originConverter_;
  }

  function setManualStatus(
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated,
    bool debtGapRequired
  ) external {
    _manualStatus = ManualStatus({
      collateralAmount: collateralAmount,
      amountToPay: amountToPay,
      healthFactor18: healthFactor18,
      opened: opened,
      collateralAmountLiquidated: collateralAmountLiquidated,
      debtGapRequired: debtGapRequired
    });
  }

  function updateStatus() external override {
    // nothing to do
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

  /// @notice Supply collateral to the pool and borrow {borrowedAmount_} in {borrowedToken_}
  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) override external returns (uint) {
    console.log("borrow collateral=%s receiver=%s", collateralAmount_, receiver_);
    console.log("borrow borrowAmount=%d ", borrowAmount_);
    _borrowHideWarning = true;
    return 0;
  }

  function borrowToRebalance(
    uint borrowAmount_,
    address receiver_
  ) external pure override returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {
    borrowAmount_;
    receiver_;
    return (resultHealthFactor18, borrowedAmountOut);
  }

  /// @notice Repay borrowed amount, return collateral to the user
  function repay(
    uint amountToRepay_,
    address receiver_,
    bool closePosition_
  ) override external returns (uint){
    console.log("repay receiver=%s", receiver_);
    console.log("repay amountToRepay_=%d closePosition_=%d", amountToRepay_, closePosition_ ? 1 : 0);
    _borrowHideWarning = false;
    return 0;
  }

  function getCollateralAmountToReturn(uint amountToRepay_, bool closePosition_) external pure override returns (uint) {
    amountToRepay_;
    closePosition_;
    return 0;
  }

  function repayToRebalance(
    uint amount_,
    bool isCollateral_
  ) external pure override returns (
    uint resultHealthFactor18
  ) {
    amount_;
    isCollateral_;
    return 0;
  }

  function getConfig() external view override returns (
    address origin,
    address user,
    address collateralAsset,
    address borrowAsset
  ) {
    return (originConverter, _user, _collateralAsset, _borrowAsset);
  }

  /// @notice Get current status of the borrow position
  function getStatus() external view override returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated,
    bool debtGapRequired
  ) {
    return (
      _manualStatus.collateralAmount,
      _manualStatus.amountToPay,
      _manualStatus.healthFactor18,
      _manualStatus.opened,
      _manualStatus.collateralAmountLiquidated,
      _manualStatus.debtGapRequired
    );
  }

//  /// @notice Compute current cost of the money
//  function getAPR18() external view override returns (int) {
//    return int(_borrowRatePerBlock * 15017140 * 100);
//  }

  //-----------------------------------------------------
  ///                 Rewards
  //-----------------------------------------------------
  function claimRewards(address receiver_) external pure override returns (
    address rewardToken,
    uint amount
  ) {
    receiver_;
    return (rewardToken, amount);
  }

}
