// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../interfaces/ITetuConverterCallback.sol";
import "../openzeppelin/IERC20.sol";

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
    if (payAmountBackParams.asset == asset_ && payAmountBackParams.amount == amount_) {
      IERC20(asset_).transfer(msg.sender, payAmountBackParams.amountToSend);
      amountOut = payAmountBackParams.amountOut;
    }

    return amountOut;
  }

  function onTransferBorrowedAmount (
    address collateralAsset_,
    address borrowAsset_,
    uint amountBorrowAssetSentToBorrower_
  ) external {
    collateralAsset_;
    borrowAsset_;
    amountBorrowAssetSentToBorrower_;
  }
}