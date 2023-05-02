// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IPoolAdapter.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../tokens/MockERC20.sol";

import "hardhat/console.sol";

contract PoolAdapterMock2 is IPoolAdapter {
  using SafeERC20 for IERC20;

  function borrow(uint collateralAmount_, uint borrowAmount_, address receiver_) external pure override returns (
    uint borrowedAmountOut
  ) {
    collateralAmount_;
    borrowAmount_;
    receiver_;
    return borrowedAmountOut;
  }

  function borrowToRebalance(uint borrowAmount_, address receiver_) external pure override returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {
    borrowAmount_;
    receiver_;
    return (resultHealthFactor18, borrowedAmountOut);
  }

  function repayToRebalance(uint amount_, bool isCollateral_) external pure override returns (
    uint resultHealthFactor18
  ) {
    amount_;
    isCollateral_;
    return resultHealthFactor18;
  }

  function getConversionKind() external pure returns (
    AppDataTypes.ConversionKind
  ) {
    return AppDataTypes.ConversionKind.UNKNOWN_0;
  }

  //-----------------------------------------------------///////////////////////////////////////////////
  // get config
  //-----------------------------------------------------///////////////////////////////////////////////
  struct RepayParams {
    address collateralAsset;
    address borrowAsset;

    uint amountToRepay;
    bool closePosition;

    uint collateralAmountSendToReceiver;
    uint borrowAmountSendToReceiver;
  }

  RepayParams internal repayParams;

  function setRepay(
    address collateralAsset,
    address borrowAsset,

    uint amountToRepay,
    bool closePosition,

    uint collateralAmountSendToReceiver,
    uint borrowAmountSendToReceiver
  ) external {
    repayParams = RepayParams({
      collateralAsset: collateralAsset,
      borrowAsset: borrowAsset,

      amountToRepay: amountToRepay,
      closePosition: closePosition,

      collateralAmountSendToReceiver: collateralAmountSendToReceiver,
      borrowAmountSendToReceiver: borrowAmountSendToReceiver
    });
  }

  function repay(uint amountToRepay_, address receiver_, bool closePosition_) external override returns (
    uint collateralAmountOut
  ) {
    console.log("PooladapterMock2.repay amountToRepay_", amountToRepay_, closePosition_);

    if (repayParams.amountToRepay == amountToRepay_ && repayParams.closePosition == closePosition_) {
      console.log("PooladapterMock2.repay.2 amountToRepay_, borrowAmountSendToReceiver", amountToRepay_, repayParams.borrowAmountSendToReceiver);
      IERC20(repayParams.borrowAsset).safeTransferFrom(msg.sender, address(this), amountToRepay_);
      console.log("PooladapterMock2.repay.2.1", IERC20(repayParams.borrowAsset).balanceOf(address(this)));
      if (repayParams.borrowAmountSendToReceiver != 0) {
        IERC20(repayParams.borrowAsset).safeTransfer(receiver_, repayParams.borrowAmountSendToReceiver);
        console.log("PooladapterMock2.repay.2.2");
      }
      console.log("PooladapterMock2.repay.2.3", repayParams.collateralAmountSendToReceiver, IERC20(repayParams.collateralAsset).balanceOf(address(this)));
      IERC20(repayParams.collateralAsset).safeTransfer(receiver_, repayParams.collateralAmountSendToReceiver);
      console.log("PooladapterMock2.repay.3");
      collateralAmountOut = repayParams.collateralAmountSendToReceiver;
    }

    console.log("PooladapterMock2.repay.4", collateralAmountOut);
    return collateralAmountOut;
  }

  //-----------------------------------------------------///////////////////////////////////////////////
  // get config
  //-----------------------------------------------------///////////////////////////////////////////////

  struct ConfigParams {
    address originConverter;
    address user;
    address collateralAsset;
    address borrowAsset;
  }

  ConfigParams internal configParams;

  function setConfig(
    address originConverter,
    address user,
    address collateralAsset,
    address borrowAsset
  ) external {
    configParams = ConfigParams({
      originConverter: originConverter,
      user: user,
      collateralAsset: collateralAsset,
      borrowAsset: borrowAsset
    });
  }

  function getConfig() external view override returns (
    address originConverter,
    address user,
    address collateralAsset,
    address borrowAsset
  ) {
    console.log("PooladapterMock2.getConfig", configParams.user);
    return (
      configParams.originConverter,
      configParams.user,
      configParams.collateralAsset,
      configParams.borrowAsset
    );
  }

  //-----------------------------------------------------///////////////////////////////////////////////
  // get status
  //-----------------------------------------------------///////////////////////////////////////////////
  struct StatusParams {
    uint collateralAmount;
    uint amountToPay;
    uint healthFactor18;
    bool opened;
    uint collateralAmountLiquidated;
    bool debtGapRequired;
  }

  StatusParams internal statusParams;

  function setStatus(
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated,
    bool debtGapRequired
  ) external {
    statusParams = StatusParams({
      collateralAmount: collateralAmount,
      amountToPay: amountToPay,
      healthFactor18: healthFactor18,
      opened: opened,
      collateralAmountLiquidated: collateralAmountLiquidated,
      debtGapRequired: debtGapRequired
    });
  }

  function getStatus() external view override returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated,
    bool debtGapRequired
  ) {
    console.log("PooladapterMock2.getStatus", statusParams.collateralAmount);
    return (
      statusParams.collateralAmount,
      statusParams.amountToPay,
      statusParams.healthFactor18,
      statusParams.opened,
      statusParams.collateralAmountLiquidated,
      statusParams.debtGapRequired
    );
  }

  StatusParams internal updateStatusParams;

  function setUpdateStatus(
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated,
    bool debtGapRequired
  ) external {
    updateStatusParams = StatusParams({
      collateralAmount: collateralAmount,
      amountToPay: amountToPay,
      healthFactor18: healthFactor18,
      opened: opened,
      collateralAmountLiquidated: collateralAmountLiquidated,
      debtGapRequired: debtGapRequired
    });
  }

  function updateStatus() external {
    // not implemented
    if (updateStatusParams.collateralAmount != 0) {
      statusParams = updateStatusParams;
    }
  }

  //-----------------------------------------------------///////////////////////////////////////////////
  // others
  //-----------------------------------------------------///////////////////////////////////////////////
  function claimRewards(address receiver_) external pure override returns (address rewardToken, uint amount) {
    receiver_;
    return (rewardToken, amount);
  }

  function getCollateralAmountToReturn(uint amountToRepay_, bool closePosition_) external pure override returns (uint) {
    amountToRepay_;
    closePosition_;
    return 0;
  }
}