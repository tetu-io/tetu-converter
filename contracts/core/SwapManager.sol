// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "@tetu_io/tetu-liquidator/contracts/interfaces/ITetuLiquidator.sol";
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
  ITetuLiquidator public tetuLiquidator;

  ///////////////////////////////////////////////////////
  ///               Initialization
  ///////////////////////////////////////////////////////

  constructor (address controller_, address tetuLiquidator_) {
    require(
      controller_ != address(0) && tetuLiquidator_ != address(0),
      AppErrors.ZERO_ADDRESS
    );
    controller = IController(controller_);
    tetuLiquidator = ITetuLiquidator(tetuLiquidator_);
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
    maxTargetAmount = tetuLiquidator.getPrice(p_.sourceToken, p_.targetToken, p_.sourceAmount);
    aprForPeriod36 = 0;
  }

  ///////////////////////////////////////////////////////
  ///           ISwapConverter Implementation
  ///////////////////////////////////////////////////////

  function getConversionKind()
  override external pure returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.SWAP_1;
  }

  function swap(AppDataTypes.InputConversionParams memory p, uint priceImpactTolerance)
  override external returns (uint outputAmount) {
    uint targetTokenBalanceBefore = IERC20(p.targetToken).balanceOf(address(this));
    IERC20(p.sourceToken).transfer(address(tetuLiquidator), p.sourceAmount);

    tetuLiquidator.liquidate(p.sourceToken, p.targetToken, p.sourceAmount, priceImpactTolerance);

    outputAmount = IERC20(p.targetToken).balanceOf(address(this)) - targetTokenBalanceBefore;
    IERC20(p.targetToken).transfer(msg.sender, outputAmount);
  }


}
