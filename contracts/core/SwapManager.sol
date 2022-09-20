// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../interfaces/ISwapManager.sol";
import "./AppErrors.sol";
import "../interfaces/IController.sol";
import "./AppDataTypes.sol";

/// @notice Contains list of lending pools. Allow to select most efficient pool for the given collateral/borrow pair
contract SwapManager is ISwapManager {
  IController public immutable controller;

  ///////////////////////////////////////////////////////
  ///               Initialization
  ///////////////////////////////////////////////////////

  constructor (address controller_) {
    require(controller_ != address(0), AppErrors.ZERO_ADDRESS);
    controller = IController(controller_);
  }


  ///////////////////////////////////////////////////////
  ///           Return best pool for swap
  ///////////////////////////////////////////////////////

  function getConverter(AppDataTypes.InputConversionParams memory /*p_*/) external view override returns (
    address converter,
    uint maxTargetAmount,
    int aprForPeriod36
  ) {
    converter = address(this);
    maxTargetAmount = 0; // TODO call tetuLiquidator
    aprForPeriod36 = 0;
  }

}
