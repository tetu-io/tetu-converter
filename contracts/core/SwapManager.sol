// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../interfaces/ITetuLiquidator.sol";
import "../integrations/IERC20Extended.sol"; // TODO move to interfaces?
import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";
import "../interfaces/ISwapManager.sol";
import "../interfaces/IController.sol";
import "../interfaces/ISwapConverter.sol";
import "./AppErrors.sol";
import "./AppDataTypes.sol";

import "hardhat/console.sol"; // TODO remove

/// @title Contract to find the best swap and make the swap
/// @notice Combines Manager and Converter
/// @author bogdoslav
contract SwapManager is ISwapManager, ISwapConverter {
  using SafeERC20 for IERC20;

  IController public immutable controller;

  ///////////////////////////////////////////////////////
  ///               Constants
  ///////////////////////////////////////////////////////

  uint public constant SLIPPAGE_NUMERATOR = 100_000;
  uint public constant SLIPPAGE_TOLERANCE = SLIPPAGE_NUMERATOR * 1 / 100; // 1 %

  uint public constant PRICE_IMPACT_NUMERATOR = 100_000;
  uint public constant PRICE_IMPACT_TOLERANCE = PRICE_IMPACT_NUMERATOR * 2 / 100; // 5%

  int public constant APR_NUMERATOR = 10**18;

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
    int apr18
  ) {
    console.log("getConverter.1, amount=", p_.sourceAmount);
    ITetuLiquidator liquidator = ITetuLiquidator(controller.tetuLiquidator());
    console.log("getConverter.2", address(liquidator));
    maxTargetAmount = liquidator.getPrice(p_.sourceToken, p_.targetToken, p_.sourceAmount);
    console.log("getConverter.3", maxTargetAmount);

//    uint minAmountIn = p_.sourceAmount / 1_000_000;
//    uint priceMinAmountIn = liquidator.getPrice(p_.sourceToken, p_.targetToken, minAmountIn);
//    uint amountOutMax = priceMinAmountIn * p_.sourceAmount / minAmountIn;
//    uint priceImpact = amountOutMax == 0 || maxTargetAmount >= amountOutMax
//      ? 0
//      : (amountOutMax - maxTargetAmount) * PRICE_IMPACT_NUMERATOR / amountOutMax;
//    console.log("p_.sourceAmount", p_.sourceAmount);
//    console.log("maxTargetAmount", maxTargetAmount);
//    console.log("minAmountIn", minAmountIn);
//    console.log("priceMinAmountIn", priceMinAmountIn);
//    console.log("amountOutMax", amountOutMax);
//    console.log("Predicted price impact", priceImpact);
//    console.log("PRICE_IMPACT_TOLERANCE", PRICE_IMPACT_TOLERANCE);
//    console.log("Price impact passed:", priceImpact < PRICE_IMPACT_TOLERANCE);

    // how much we will get when sell target token back
    uint returnAmount = liquidator.getPrice(p_.targetToken, p_.sourceToken, maxTargetAmount);

    // getPrice returns 0 if conversion way is not found
    // in this case, we should return converter = 0 in same way as ITetuConverter does
    converter = (maxTargetAmount == 0 || returnAmount == 0)
      ? address(0)
      : address(this);

    console.log('p_.sourceAmount', p_.sourceAmount);
    int loss = int(p_.sourceAmount) - int(returnAmount);
    console.log('loss'); // TODO remove
    console.logInt(loss);
    apr18 = loss * APR_NUMERATOR / int(p_.sourceAmount);
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
    address receiver_
  ) override external returns (uint outputAmount) {
    console.log("swap.1 sourceAmount_=", sourceAmount_);
    uint targetTokenBalanceBefore = IERC20(targetToken_).balanceOf(address(this));

    console.log("swap.2 targetAmount_=", targetAmount_);
    ITetuLiquidator tetuLiquidator = ITetuLiquidator(controller.tetuLiquidator());
    IERC20(sourceToken_).safeApprove(address(tetuLiquidator), sourceAmount_);

    console.log("swap.3");
    tetuLiquidator.liquidate(sourceToken_, targetToken_, sourceAmount_, PRICE_IMPACT_TOLERANCE);
    outputAmount = IERC20(targetToken_).balanceOf(address(this)) - targetTokenBalanceBefore;

    console.log("swap.4");
    uint slippage = targetAmount_ == 0 || outputAmount >= targetAmount_
      ? 0
      : (targetAmount_ - outputAmount) * SLIPPAGE_NUMERATOR / targetAmount_;
    require(slippage <= SLIPPAGE_TOLERANCE, AppErrors.SLIPPAGE_TOO_BIG);

    console.log("swap.5", outputAmount);
    IERC20(targetToken_).safeTransfer(receiver_, outputAmount);
  }

}
