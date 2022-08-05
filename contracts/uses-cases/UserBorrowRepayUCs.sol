// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IController.sol";
import "../interfaces/ITetuConverter.sol";
import "../openzeppelin/IERC20.sol";
import "../interfaces/IPoolAdapter.sol";
import "hardhat/console.sol";
import "../openzeppelin/SafeERC20.sol";

/// @notice This contract imitates real TetuConverter-user behavior
/// Terms:
///   UC: user
///   TC: TestConverter contract
///   PA: selected PoolAdapter
///   DM: DebtsMonitor
contract UserBorrowRepayUCs {
  using SafeERC20 for IERC20;

  IController immutable private _controller;

  uint public totalBorrowedAmount;
  uint public totalRepaidAmount;

  constructor (address controller) {
    _controller = IController(controller);
  }

  ///////////////////////////////////////////////////////
  /// Uses cases US1.1 and US1.2, see project scope
  ///////////////////////////////////////////////////////
  /// @notice See US1.1 in the project scope
  function makeBorrowUC1_1(
    address sourceAsset_,
    uint sourceAmount_,
    address targetAsset_,
    uint borrowPeriodInBlocks_,
    uint16 healthFactor2_,
    address receiver_
  ) external {
    console.log("makeBorrowUC1.1 healthFactor2_=%d sourceAmount_=%d of %s", healthFactor2_, sourceAmount_, sourceAsset_);
    // ask TC for the best conversion strategy
    (address converter, uint maxTargetAmount,) = _tc().findConversionStrategy(sourceAsset_,
      sourceAmount_,
      targetAsset_,
      healthFactor2_,
      borrowPeriodInBlocks_
    );
    require(converter != address(0), "Conversion strategy wasn't found");
    require(maxTargetAmount != 0, "maxTargetAmount is 0");

    console.log("We can borrow %d of %s using converter=%s", maxTargetAmount, targetAsset_, converter);
    console.log("makeBorrowUC1.1 balance=%d source amount=%d", IERC20(sourceAsset_).balanceOf(address(this)), sourceAmount_);

    // transfer collateral to TC
    require(IERC20(sourceAsset_).balanceOf(address(this)) >= sourceAmount_, "wrong balance st on tc");
    IERC20(sourceAsset_).safeApprove(_controller.tetuConverter(), sourceAmount_);

    console.log("approve %d for %s", sourceAmount_, _controller.tetuConverter());

    // borrow and receive borrowed-amount to receiver's balance
    _tc().convert(
      converter,
      sourceAsset_,
      sourceAmount_,
      targetAsset_,
      maxTargetAmount,
      receiver_
    );
    console.log("makeBorrowUC1.1 done");

    totalBorrowedAmount += maxTargetAmount;
  }

  /// @notice See US1.2 in the project scope
  function makeRepayUC1_2(
    address collateralAsset_,
    address borrowedAsset_,
    address receiver_
  ) external {
    console.log("makeRepayUC1.2 started");
    (uint count, address[] memory poolAdapters, uint[] memory amounts)
      = _tc().findBorrows(collateralAsset_, borrowedAsset_);
    console.log("makeRepayUC1.2 count positions=%d", count);
    for (uint i = 0; i < count; ++i) {
      // transfer borrowed amount to Pool Adapter
      IERC20(borrowedAsset_).transfer(poolAdapters[i], amounts[i]);
      console.log("makeRepayUC1.2 borrowedToken_=%s amount=%d", borrowedAsset_, amounts[i]);

      // repay borrowed amount and receive collateral to receiver's balance
      IPoolAdapter(poolAdapters[i]).repay(
        amounts[i],
        receiver_,
        true
      );

      totalRepaidAmount += amounts[i];
    }
    console.log("makeRepayUC1.2 done");
  }

  /// @notice See US1.3 in the project scope
  function makeRepayUC1_3(
    address collateralAsset_,
    address borrowedAsset_,
    address receiver_,
    uint amountToPay_
  ) external {
    console.log("makeRepayUS1.3 started");
    (uint count, address[] memory poolAdapters, uint[] memory amounts)
      = _tc().findBorrows(collateralAsset_, borrowedAsset_);
    console.log("makeRepayUS1.3 count positions=%d", count);
    for (uint i = 0; i < count; ++i) {
      uint amountToPayToPA = amountToPay_ >= amounts[i]
        ? amounts[i]
        : amountToPay_;
      bool closePosition = amountToPayToPA == amounts[i];
      console.log("makeRepayUS1.3 amount to pay=%d close position=%d", amountToPayToPA, closePosition ? 1 : 0);

      // transfer borrowed amount to Pool Adapter
      IERC20(borrowedAsset_).transfer(poolAdapters[i], amountToPayToPA);
      console.log("makeRepayUS1.3 borrowedToken_=%s amount=%d", borrowedAsset_, amountToPayToPA);

      // repay borrowed amount and receive collateral to receiver's balance
      IPoolAdapter(poolAdapters[i]).repay(
        amountToPayToPA,
        receiver_,
        closePosition
      );

      totalRepaidAmount += amountToPayToPA;
    }
    console.log("makeRepayUS1.3 done");
  }

  ///////////////////////////////////////////////////////
  ///                   View status
  ///////////////////////////////////////////////////////

  function getBorrows(
    address collateralAsset_,
    address borrowedAsset_
  ) external view returns (
    uint count,
    address[] memory poolAdapters,
    uint[] memory amounts
  ) {
    return _tc().findBorrows(collateralAsset_, borrowedAsset_);
  }

  ///////////////////////////////////////////////////////
  ///       Inline utils
  ///////////////////////////////////////////////////////
  function _tc() internal view returns (ITetuConverter) {
    return ITetuConverter(_controller.tetuConverter());
  }
}