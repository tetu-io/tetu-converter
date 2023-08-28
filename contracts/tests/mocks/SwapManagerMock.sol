// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../interfaces/ISwapManager.sol";
import "../interfaces/ISwapConverter.sol";
import "hardhat/console.sol";

contract SwapManagerMock is ISwapManager, ISwapConverter {

  struct SwapInputParams {
    address sourceToken;
    address targetToken;
    address receiver;
    uint sourceAmount;
  }
  SwapInputParams public lastSwapInputParams;

  /// @dev Values that getConverter returns
  address public converter;
  uint public maxTargetAmount;
  int public apr18;

  /// @dev swap() returns following value
  uint public targetAmountAfterSwap;

  uint public lastSwapResultTargetAmount;

  //-----------------------------------------------------///////////
  // Setup the mock
  //-----------------------------------------------------///////////
  function setupGetConverter(
    address converter_,
    uint maxTargetAmount_,
    int apr18_
  ) external {
    converter = converter_;
    maxTargetAmount = maxTargetAmount_;
    apr18 = apr18_;
  }

  function setupSwap(uint targetAmountAfterSwap_) external {
    targetAmountAfterSwap = targetAmountAfterSwap_;
  }

  //-----------------------------------------------------///////////
  // ISwapManager, ISwapConverter
  //-----------------------------------------------------///////////

  function getConverter(
    address sourceAmountApprover_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external view override returns (
    address converter_,
    uint maxTargetAmount_
  ) {
    sourceAmountApprover_;
    sourceToken_;
    sourceAmount_;
    targetToken_;

    console.log("SwapManagerMock.getConverter", converter, maxTargetAmount);
    return (converter, maxTargetAmount);
  }

  function getConversionKind()
  override external pure returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.SWAP_1;
  }

  function swap(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    address receiver_
  ) override external returns (uint borrowedAmountOut) {
    lastSwapInputParams = SwapInputParams({
      sourceToken: sourceToken_,
      sourceAmount: sourceAmount_,
      targetToken: targetToken_,
      receiver: receiver_
    });
    console.log("SwapManagerMock.swap", targetAmountAfterSwap);
    lastSwapResultTargetAmount = targetAmountAfterSwap;
    return targetAmountAfterSwap;
  }

  function getApr18(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_
  ) external view override returns (int) {
    sourceToken_;
    sourceAmount_;
    targetToken_;
    targetAmount_;

    console.log("apr18");
    console.logInt(apr18);

    return apr18;
  }

  function getPriceImpactTolerance(address asset_) external pure override returns (uint priceImpactTolerance) {
    asset_;
    return priceImpactTolerance;
  }
}
