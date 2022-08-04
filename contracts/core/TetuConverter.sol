// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/ITetuConverter.sol";
import "../integrations/market/ICErc20.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IBorrowManager.sol";
import "hardhat/console.sol";
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
    uint interest
  ) {
    AppDataTypes.InputConversionParams memory params = AppDataTypes.InputConversionParams({
      healthFactor2: healthFactor2_,
      sourceToken: sourceToken_,
      targetToken: targetToken_,
      sourceAmount: sourceAmount_,
      periodInBlocks: periodInBlocks_
    });

    // find best DEX platform

    // find best lending platform
    //TODO: Calculate APY = (1 + r / n)^n - 1, where r - period rate, n = number of compounding periods
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
      IERC20(sourceToken_).transferFrom(msg.sender, poolAdapter, sourceAmount_);

      // borrow target-amount and transfer borrowed amount to the receiver
      IPoolAdapter(poolAdapter).borrow(sourceAmount_, targetAmount_, receiver_);
    } else {
      // make swap
      //TODO
      console.log("SWAP!");
    }
  }

  ///////////////////////////////////////////////////////
  ///       Find opened borrow-positions
  ///////////////////////////////////////////////////////

  function findBorrows (
    address collateralToken_,
    address borrowedToken_
  ) external view override returns (
    uint countItems,
    address[] memory poolAdapters,
    uint[] memory amountsToPay
  ) {
    console.log("findBorrows user=%s collateral=%s borrow=%s", msg.sender, collateralToken_, borrowedToken_);
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

