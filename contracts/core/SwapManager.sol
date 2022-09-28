// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../interfaces/ITetuLiquidator.sol";
import "../openzeppelin/IERC20.sol";
import "../interfaces/ISwapManager.sol";
import "../interfaces/IController.sol";
import "../interfaces/ISwapConverter.sol";
import "./AppErrors.sol";
import "./AppDataTypes.sol";

/// @title Contract to find the best swap and make the swap
/// @notice Combines Manager and Converter
/// @author bogdoslav
contract SwapManager is ISwapManager, ISwapConverter {
  IController public immutable controller;

  ///////////////////////////////////////////////////////
  ///               Constants
  ///////////////////////////////////////////////////////

  uint public constant SLIPPAGE_DENOMINATOR = 100_000;

  ///////////////////////////////////////////////////////
  ///               Initialization
  ///////////////////////////////////////////////////////

  constructor (address controller_) {
    require(
      controller_ != address(0),
      AppErrors.ZERO_ADDRESS
    );
    controller = IController(controller_);
  }


  ///////////////////////////////////////////////////////
  ///           Return best amount for swap
  ///////////////////////////////////////////////////////

  function getConverter(AppDataTypes.InputConversionParams memory p_)
  external view override returns (
    address converter,
    uint maxTargetAmount,
    int aprForPeriod36
  ) {
    converter = address(this);
    maxTargetAmount = ITetuLiquidator(controller.tetuLiquidator())
      .getPrice(p_.sourceToken, p_.targetToken, p_.sourceAmount);
    aprForPeriod36 = 0;
  }

  ///////////////////////////////////////////////////////
  ///           ISwapConverter Implementation
  ///////////////////////////////////////////////////////

  function getConversionKind()
  override external pure returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.SWAP_1;
  }

  function swap(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_,
    uint priceImpactTolerance_,
    uint slippageTolerance_
  ) override external returns (uint outputAmount) {
    uint targetTokenBalanceBefore = IERC20(targetToken_).balanceOf(address(this));

    ITetuLiquidator tetuLiquidator = ITetuLiquidator(controller.tetuLiquidator());
    IERC20(sourceToken_).transfer(address(tetuLiquidator), sourceAmount_);

    tetuLiquidator.liquidate(sourceToken_, targetToken_, sourceAmount_, priceImpactTolerance_);
    outputAmount = IERC20(targetToken_).balanceOf(address(this)) - targetTokenBalanceBefore;

    uint slippage = (outputAmount >= targetAmount_)
      ? 0
      : (targetAmount_ - outputAmount) * SLIPPAGE_DENOMINATOR / targetAmount_;
    require(slippage <= slippageTolerance_, AppErrors.SLIPPAGE_TOO_BIG);

    IERC20(targetToken_).transfer(receiver_, outputAmount);
  }


}
