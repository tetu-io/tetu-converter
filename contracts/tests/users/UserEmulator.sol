// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../interfaces/IConverterController.sol";
import "../../interfaces/ITetuConverter.sol";
import "../../interfaces/IPoolAdapter.sol";
import "../../interfaces/IKeeperCallback.sol";
import "../../interfaces/IBorrowManager.sol";
import "../../interfaces/ITetuConverterCallback.sol";
import "../../interfaces/IDebtMonitor.sol";
import "../lending-platform/PoolAdapterMock.sol";

import "hardhat/console.sol";

/// @notice Emulator of any user actions
contract UserEmulator { // todo is ITetuConverterCallback {
  using SafeERC20 for IERC20;
  IConverterController private _controller;
  ITetuConverter private _tc;
  address public collateralAsset;
  address public borrowAsset;
  uint private _periodInBlocks;

  //region--------------------------------------------- Data types
  enum ActionKind {
    BORROW_DIRECT_0,
    BORROW_REVERSE_1,
    REPAY_DIRECT_2,
    REPAY_REVERSE_3
  }
  struct BorrowRepaySequenceResults {
    address collateralAsset;
    address borrowAsset;
    /// @notice For borrow only: converter used for borrowing
    address converter;
    /// @notice For borrow: borrowed amount; For repay: amount of borrowed asset received back
    uint borrowedAmount;
    /// @notice For repay only: amount of collateral asset received back
    uint collateralAmount;
    /// @notice For repay only: A part of collateral received through the swapping
    uint swappedLeftoverCollateral;
    /// @notice For repay only: A part of repaid amount that was swapped
    uint swappedLeftoverBorrow;
  }
  //endregion--------------------------------------------- Data types


  //region--------------------------------------------- Initialization and setup
  constructor (address controller_, address collateralAsset_, address borrowAsset_, uint periodInBlocks) {
    _controller = IConverterController(controller_);
    collateralAsset = collateralAsset_;
    borrowAsset = borrowAsset_;
    _periodInBlocks = periodInBlocks;
    _tc = ITetuConverter(_controller.tetuConverter());
  }
  //endregion--------------------------------------------- Initialization and setup

  //region--------------------------------------------- Borrow and repay

  /// @notice Make sequence of borrow/repay commands
  /// @param amountsIn For repay: pass 0 to repay the debts completely
  /// @param amountsOut For borrow: pass 0 to borrow max amount OR pass exact amount to be borrowed
  ///                   For repay: 0 if amountIn contains absolute value
  ///                              1 if amountIt contains repayPart (0...100_000] (for partial repay only)
  function borrowRepaySequence(
    uint[] memory actionKinds,
    uint[] memory amountsIn,
    uint[] memory amountsOut,
    bytes[] memory entryData,
    address[] memory receivers
  ) external returns (BorrowRepaySequenceResults[] memory r) {
    console.log("borrowRepaySequence");
    uint len = actionKinds.length;
    r = new BorrowRepaySequenceResults[](len);

    for (uint i; i < len; ++i) {
      console.log("borrowRepaySequence.i", i);
      if (actionKinds[i] == uint(ActionKind.BORROW_DIRECT_0)) {
        console.log("borrowRepaySequence.1.amountsOut[i]", amountsOut[i]);
        r[i].collateralAsset = collateralAsset;
        r[i].borrowAsset = borrowAsset;

        if (amountsOut[i] == 0) {
          console.log("borrowRepaySequence.2");
          (r[i].converter, r[i].borrowedAmount) = _borrowByPlan(entryData[i], amountsIn[i], collateralAsset, borrowAsset, receivers[i]);
        } else {
          console.log("borrowRepaySequence.3");
          (r[i].converter, r[i].borrowedAmount) = _borrowExact(entryData[i], amountsIn[i], amountsOut[i], collateralAsset, borrowAsset, receivers[i]);
        }
      } else if (actionKinds[i] == uint(ActionKind.BORROW_REVERSE_1)) {
        console.log("borrowRepaySequence.4.amountsOut[i]", amountsOut[i]);
        r[i].collateralAsset = borrowAsset;
        r[i].borrowAsset = collateralAsset;

        if (amountsOut[i] == 0) {
          console.log("borrowRepaySequence.5");
          (r[i].converter, r[i].borrowedAmount) = _borrowByPlan(entryData[i], amountsIn[i], borrowAsset, collateralAsset, receivers[i]);
        } else {
          console.log("borrowRepaySequence.6");
          (r[i].converter, r[i].borrowedAmount) = _borrowExact(entryData[i], amountsIn[i], amountsOut[i], borrowAsset, collateralAsset, receivers[i]);
        }
      } else if (actionKinds[i] == uint(ActionKind.REPAY_DIRECT_2)) {
        console.log("borrowRepaySequence.7");
        r[i].collateralAsset = collateralAsset;
        r[i].borrowAsset = borrowAsset;

        if (amountsIn[i] == 0 && amountsOut[i] == 100_000) { // full repay
          console.log("borrowRepaySequence.8");
          (
            r[i].collateralAmount, r[i].borrowedAmount, r[i].swappedLeftoverCollateral, r[i].swappedLeftoverBorrow
          ) = _repayFull(collateralAsset, borrowAsset, receivers[i]);
        } else { // partial repay
          console.log("borrowRepaySequence.9");
          (
            r[i].collateralAmount, r[i].borrowedAmount, r[i].swappedLeftoverCollateral, r[i].swappedLeftoverBorrow
          ) = _repayExact(collateralAsset, borrowAsset, amountsIn[i], receivers[i], amountsOut[i]);
        }
      } else if (actionKinds[i] == uint(ActionKind.REPAY_REVERSE_3)) {
        r[i].collateralAsset = borrowAsset;
        r[i].borrowAsset = collateralAsset;

        if (amountsIn[i] == 0 && amountsOut[i] == 100_000) { // full repay
          (
            r[i].collateralAmount, r[i].borrowedAmount, r[i].swappedLeftoverCollateral, r[i].swappedLeftoverBorrow
          ) = _repayFull(borrowAsset, collateralAsset, receivers[i]);
        } else { // partial repay
          (
            r[i].collateralAmount, r[i].borrowedAmount, r[i].swappedLeftoverCollateral, r[i].swappedLeftoverBorrow
          ) = _repayExact(borrowAsset, collateralAsset, amountsIn[i], receivers[i], amountsOut[i]);
        }
      }
    }
    console.log("borrowRepaySequence.20");
  }

  //endregion--------------------------------------------- Borrow and repay

  //region--------------------------------------------- Borrow utils

  /// @notice Get conversion plan and borrow amount by the plan
  function _borrowByPlan(
    bytes memory entryData,
    uint amountIn,
    address collateralAsset_,
    address borrowAsset_,
    address receiver
  ) internal returns (
    address converter,
    uint borrowedAmount
  ) {
    console.log("_borrowByPlan.amountIn", amountIn);
    IERC20(collateralAsset_).approve(address(_tc), amountIn);
    (
      address[] memory converters,
      uint[] memory collateralAmountsOut,
      uint[] memory amountToBorrowsOut,
    ) = _tc.findBorrowStrategies(entryData, collateralAsset_, amountIn, borrowAsset_, _periodInBlocks);
    require(converters.length > 0, AppErrors.POOL_ADAPTER_NOT_FOUND);

    require(IERC20(collateralAsset_).balanceOf(address(this)) >= amountIn, "UserEmulator has insufficient balance of collateral");

    console.log("_borrowByPlan.converter", converters[0]);
    console.log("_borrowByPlan.collateralAmountsOut", collateralAmountsOut[0]);
    console.log("_borrowByPlan.amountToBorrowsOut", amountToBorrowsOut[0]);
    // borrow and receive borrowed-amount to receiver's balance
    borrowedAmount = _tc.borrow(converters[0], collateralAsset_, collateralAmountsOut[0], borrowAsset_, amountToBorrowsOut[0], receiver);
    return (converters[0], borrowedAmount);
  }

  /// @notice Get conversion plan and borrow amount by the plan
  function _borrowExact(
    bytes memory entryData,
    uint amountIn,
    uint amountOut,
    address collateralAsset_,
    address borrowAsset_,
    address receiver
  ) internal returns (
    address converter,
    uint borrowedAmount
  ) {
    IERC20(collateralAsset_).approve(address(_tc), amountIn);
    (address[] memory converters,,,) = _tc.findBorrowStrategies(entryData, collateralAsset_, amountIn, borrowAsset_, _periodInBlocks);
    require(converters.length > 0, AppErrors.POOL_ADAPTER_NOT_FOUND);

    require(IERC20(collateralAsset_).balanceOf(address(this)) >= amountIn, "UserEmulator has insufficient balance of collateral");

    // borrow and receive borrowed-amount to receiver's balance
    borrowedAmount = _tc.borrow(converters[0], collateralAsset_, amountIn, borrowAsset_, amountOut, receiver);
    return (converters[0], borrowedAmount);
  }
  //endregion--------------------------------------------- Borrow utils

  //region--------------------------------------------- Repay utils
  function _repayFull(address collateralAsset_, address borrowedAsset_, address receiver_) internal returns (
    uint collateralAmountOut,
    uint returnedBorrowAmountOut,
    uint swappedLeftoverCollateralOut,
    uint swappedLeftoverBorrowOut
  ) {
    (uint amountToPay,) = _tc.getDebtAmountCurrent(address(this), collateralAsset_, borrowedAsset_, true);
    IERC20(borrowedAsset_).safeTransfer(address(_tc), amountToPay);
    (collateralAmountOut,
      returnedBorrowAmountOut,
      swappedLeftoverCollateralOut,
      swappedLeftoverBorrowOut
    ) = _tc.repay(collateralAsset_, borrowedAsset_, amountToPay, receiver_);
  }

  /// @param amountToPay_ Amount to repay. It is not used if repayPart > 0
  /// @param repayPart Relative part of the debt that should be paid, in the range [1..100_000]
  ///                  It can be more than 100_000, i.e. 100_123.
  ///                  In this case, [total-debt-abount] * repayPart / 100_000 will be paid
  function _repayExact(address collateralAsset_, address borrowedAsset_, uint amountToPay_, address receiver_, uint repayPart) internal returns (
    uint collateralAmountOut,
    uint returnedBorrowAmountOut,
    uint swappedLeftoverCollateralOut,
    uint swappedLeftoverBorrowOut
  ) {
    uint amountIn;
    if (repayPart == 0) {
      amountIn = amountToPay_;
    } else {
      (amountIn,) = _tc.getDebtAmountCurrent(address(this), collateralAsset_, borrowedAsset_, true);
      amountIn = amountIn * repayPart / 100_000;
    }

    IERC20(borrowedAsset_).safeTransfer(address(_tc), amountIn);
    (collateralAmountOut,
      returnedBorrowAmountOut,
      swappedLeftoverCollateralOut,
      swappedLeftoverBorrowOut
    ) = _tc.repay(collateralAsset_, borrowedAsset_, amountIn, receiver_);
  }
  //endregion--------------------------------------------- Repay utils
}
