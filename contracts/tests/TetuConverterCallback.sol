// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../interfaces/ITetuConverterCallback.sol";
import "../openzeppelin/IERC20.sol";

import "hardhat/console.sol";

contract TetuConverterCallbackMock is ITetuConverterCallback {

  struct RequirePayAmountBackParams {
    address asset;
    uint amount;
    uint amountOut;
    uint amountToSend;
  }
  RequirePayAmountBackParams internal payAmountBackParams;
  function setRequirePayAmountBack(
    address asset,
    uint amount,
    uint amountOut,
    uint amountToSend
  ) external {
    payAmountBackParams = RequirePayAmountBackParams({
      asset: asset,
      amount: amount,
      amountOut: amountOut,
      amountToSend: amountToSend
    });
  }
  function requirePayAmountBack(address asset_, uint amount_) external returns (uint amountOut) {
    console.log("requirePayAmountBack", asset_, amount_);
    console.log("requirePayAmountBack.set", payAmountBackParams.asset , payAmountBackParams.amount);
    if (payAmountBackParams.asset == asset_ && payAmountBackParams.amount == amount_) {
      console.log("requirePayAmountBack.2");
      IERC20(asset_).transfer(msg.sender, payAmountBackParams.amountToSend);
      console.log("requirePayAmountBack.3");
      amountOut = payAmountBackParams.amountOut;
    }

    console.log("requirePayAmountBack.4", amountOut);
    return amountOut;
  }

  function onTransferBorrowedAmount (
    address collateralAsset_,
    address borrowAsset_,
    uint amountBorrowAssetSentToBorrower_
  ) external pure {
    collateralAsset_;
    borrowAsset_;
    amountBorrowAssetSentToBorrower_;
  }
}