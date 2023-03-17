// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IPoolAdapter.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/SafeERC20.sol";

contract PoolAdapterMock2 is IPoolAdapter {
  using SafeERC20 for IERC20;

  function updateStatus() external {
    // not implemented
  }

  function borrow(uint collateralAmount_, uint borrowAmount_, address receiver_) external override returns (
    uint borrowedAmountOut
  ) {
    collateralAmount_;
    borrowAmount_;
    receiver_;
    return borrowedAmountOut;
  }

  function borrowToRebalance(uint borrowAmount_, address receiver_) external override returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {
    borrowAmount_;
    receiver_;
    return (resultHealthFactor18, borrowedAmountOut);
  }

  function repayToRebalance(uint amount_, bool isCollateral_) external override returns (
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


  //////////////////////////////////////////////////////////////////////////////////////////////////////
  // get config
  //////////////////////////////////////////////////////////////////////////////////////////////////////
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
    if (repayParams.amountToRepay == amountToRepay_ && repayParams.closePosition == closePosition_) {
      IERC20(repayParams.borrowAsset).safeTransferFrom(msg.sender, address(this), amountToRepay_);

      IERC20(repayParams.borrowAsset).safeTransfer(receiver_, repayParams.borrowAmountSendToReceiver);
      IERC20(repayParams.collateralAsset).safeTransfer(receiver_, repayParams.collateralAmountSendToReceiver);

      collateralAmountOut = repayParams.collateralAmountSendToReceiver;
    }

    return collateralAmountOut;
  }

  //////////////////////////////////////////////////////////////////////////////////////////////////////
  // get config
  //////////////////////////////////////////////////////////////////////////////////////////////////////

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
    return (
      configParams.originConverter,
      configParams.user,
      configParams.collateralAsset,
      configParams.borrowAsset
    );
  }


  //////////////////////////////////////////////////////////////////////////////////////////////////////
  // get status
  //////////////////////////////////////////////////////////////////////////////////////////////////////
  struct StatusParams {
    uint collateralAmount;
    uint amountToPay;
    uint healthFactor18;
    bool opened;
    uint collateralAmountLiquidated;
  }
  StatusParams internal statusParams;
  function setStatus(
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated
  ) external {
    statusParams = StatusParams({
    collateralAmount: collateralAmount,
    amountToPay: amountToPay,
    healthFactor18: healthFactor18,
    opened: opened,
    collateralAmountLiquidated: collateralAmountLiquidated
    });
  }
  function getStatus() external view override returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated
  ) {
    return (
      statusParams.collateralAmount,
      statusParams.amountToPay,
      statusParams.healthFactor18,
      statusParams.opened,
      statusParams.collateralAmountLiquidated
    );
  }

  function claimRewards(address receiver_) external override returns (address rewardToken, uint amount) {
    receiver_;
    return (rewardToken, amount);
  }

  function getCollateralAmountToReturn(uint amountToRepay_, bool closePosition_) external view override returns (uint) {
    amountToRepay_;
    closePosition_;
    return 0;
  }
}