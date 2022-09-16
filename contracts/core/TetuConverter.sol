// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/ITetuConverter.sol";
import "../integrations/market/ICErc20.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IBorrowManager.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/IERC20.sol";
import "../interfaces/IPlatformAdapter.sol";
import "./AppDataTypes.sol";
import "./AppErrors.sol";
import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IController.sol";
import "../interfaces/IDebtsMonitor.sol";
import "../interfaces/IConverter.sol";

/// @notice Main application contract
contract TetuConverter is ITetuConverter {
  using SafeERC20 for IERC20;

  ///////////////////////////////////////////////////////
  ///                Members
  ///////////////////////////////////////////////////////

  IController public immutable controller;

  ///////////////////////////////////////////////////////
  ///                Initialization
  ///////////////////////////////////////////////////////

  constructor(address controller_) {
    require(controller_ != address(0), AppErrors.ZERO_ADDRESS);

    controller = IController(controller_);
  }

  ///////////////////////////////////////////////////////
  ///       Find best strategy for conversion
  ///////////////////////////////////////////////////////

  function findConversionStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint16 healthFactor2_,
    uint periodInBlocks_
  ) external view override returns (
    address converter,
    uint maxTargetAmount,
    int aprForPeriod36
  ) {
    return _findConversionStrategy(sourceToken_, sourceAmount_, targetToken_, healthFactor2_, periodInBlocks_);
  }

  function _findConversionStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint16 healthFactor2_,
    uint periodInBlocks_
  ) internal view returns (
    address converter,
    uint maxTargetAmount,
    int aprForPeriod36
  ) {
    AppDataTypes.InputConversionParams memory params = AppDataTypes.InputConversionParams({
      healthFactor2: healthFactor2_,
      sourceToken: sourceToken_,
      targetToken: targetToken_,
      sourceAmount: sourceAmount_,
      periodInBlocks: periodInBlocks_
    });

    // find best DEX platform
    // TODO: if periodInBlocks_ === max then swap

    // find best lending platform
    return _bm().findConverter(params);
  }

  ///////////////////////////////////////////////////////
  ///       Make conversion
  ///////////////////////////////////////////////////////

  function convert(
    address converter_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_
  ) external override {
    _convert(converter_, sourceToken_, sourceAmount_, targetToken_, targetAmount_, receiver_, msg.sender);
  }

  function _convert(
    address converter_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_,
    address collateralProvider_
  ) internal {
    if (IConverter(converter_).getConversionKind() == AppDataTypes.ConversionKind.BORROW_2) {
      // make borrow

      // get exist or register new pool adapter
      address poolAdapter = _bm().getPoolAdapter(converter_, msg.sender, sourceToken_, targetToken_);
      if (poolAdapter == address(0)) {
        poolAdapter = _bm().registerPoolAdapter(
          converter_,
          msg.sender,
          sourceToken_,
          targetToken_
        );
      }
      require(poolAdapter != address(0), AppErrors.POOL_ADAPTER_NOT_FOUND);

      // transfer the collateral from the user directly to the pool adapter; assume, that the transfer is approved
      IPoolAdapter(poolAdapter).syncBalance(true);
      if (collateralProvider_ == address(this)) {
        IERC20(sourceToken_).transfer(poolAdapter, sourceAmount_);
      } else {
        IERC20(sourceToken_).transferFrom(collateralProvider_, poolAdapter, sourceAmount_);
      }
      // borrow target-amount and transfer borrowed amount to the receiver
      IPoolAdapter(poolAdapter).borrow(sourceAmount_, targetAmount_, receiver_);
    } else {
      // make swap
      //TODO
    }
  }

  function reconvert(
    address poolAdapter_,
    uint16 healthFactor2_,
    uint periodInBlocks_,
    address receiver_
  ) external override {
    // we assume, that the caller has already transferred borrowed amount back to the pool adapter

    // prepare to repay
    IPoolAdapter pa = IPoolAdapter(poolAdapter_);
    (address originConverter, address user, address collateralAsset, address borrowAsset) = pa.getConfig();
    require(user == msg.sender, AppErrors.USER_ONLY);

    (, uint amountToPay,,) = pa.getStatus();

    // temporary store current balance of the collateral - we need to know balance delta after and before repay
    uint deltaCollateral = IERC20(collateralAsset).balanceOf(address(this));

    // repay
    pa.repay(amountToPay, address(this), true);
    deltaCollateral = IERC20(collateralAsset).balanceOf(address(this)) - deltaCollateral;

    // find new plan
    (address converter, uint maxTargetAmount,) = _findConversionStrategy(
        collateralAsset,
        deltaCollateral,
        borrowAsset,
        healthFactor2_,
        periodInBlocks_
    );
    require(converter != originConverter, AppErrors.RECONVERSION_WITH_SAME_CONVERTER_FORBIDDEN);

    // make conversion using new pool adapter, transfer borrowed amount {receiver_}
    _convert(
      converter,
      collateralAsset,
      deltaCollateral,
      borrowAsset,
      maxTargetAmount,
      receiver_,
      address(this)
    );
  }

  ///////////////////////////////////////////////////////
  ///       Find opened borrow-positions
  ///////////////////////////////////////////////////////

  function findBorrows (
    address collateralToken_,
    address borrowedToken_
  ) external view override returns (
    address[] memory poolAdapters
  ) {
    return _dm().getPositions(msg.sender, collateralToken_, borrowedToken_);
  }

  ///////////////////////////////////////////////////////
  ///       Inline functions
  ///////////////////////////////////////////////////////
  function _bm() internal view returns (IBorrowManager) {
    return IBorrowManager(controller.borrowManager());
  }

  function _dm() internal view returns (IDebtMonitor) {
    return IDebtMonitor(controller.debtMonitor());
  }
}

