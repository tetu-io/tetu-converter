// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IController.sol";
import "../interfaces/ITetuConverter.sol";
import "../openzeppelin/IERC20.sol";
import "../interfaces/IPoolAdapter.sol";
import "hardhat/console.sol";

/// @notice This contract imitates real TetuConverter-user behavior
/// Terms:
///   UC: user
///   TC: TestConverter contract
///   PA: selected PoolAdapter
///   DM: DebtsMonitor
contract UserBorrowRepayUCs {

  IController immutable private _controller;

  constructor (address controller) {
    _controller = IController(controller);
  }

  ///////////////////////////////////////////////////////
  /// Uses cases US1.1 and US1.2, see project scope
  ///////////////////////////////////////////////////////
  /// @notice See US1.1 in the project scope
  function makeBorrowUS11(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint borrowPeriodInBlocks_,
    uint16 healthFactor2_,
    address receiver_
  ) external {
    console.log("makeBorrowUS11.1 %d", healthFactor2_);
    // ask TC for the best conversion strategy
    (address converter, uint maxTargetAmount,) = _tc().findConversionStrategy(sourceToken_,
      sourceAmount_,
      targetToken_,
      healthFactor2_,
      borrowPeriodInBlocks_
    );

    console.log("makeBorrowUS11.2 balance=%d source amount=%d", IERC20(sourceToken_).balanceOf(address(this)), sourceAmount_);
    // transfer collateral to TC
    require(IERC20(sourceToken_).balanceOf(address(this)) >= sourceAmount_
      , "wrong balance st on tc");
    IERC20(sourceToken_).transfer(_controller.tetuConverter(), sourceAmount_);

    console.log("makeBorrowUS11.3");
    // borrow and receive borrowed-amount to receiver's balance
    _tc().convert(
      converter,
      sourceToken_,
      sourceAmount_,
      targetToken_,
      maxTargetAmount,
      receiver_
    );
  }

  function makeRepayUS12(
    address collateralToken_,
    address borrowedToken_,
    address receiver_,
    bool closePosition_
  ) external {
    console.log("makeRepayUS12.1");
    (uint count, address[] memory poolAdapters, uint[] memory amounts)
      = _tc().findBorrows(collateralToken_, borrowedToken_);
    console.log("makeRepayUS12.2 count=%d", count);
    for (uint i = 0; i < count; ++i) {
      // transfer borrowed amount to Pool Adapter
      IERC20(borrowedToken_).transfer(poolAdapters[i], amounts[i]);
      console.log("makeRepayUS12.3 borrowedToken_=%s amount=%d", borrowedToken_, amounts[i]);

      // repay borrowed amount and receive collateral to receiver's balance
      IPoolAdapter(poolAdapters[i]).repay(
        amounts[i],
        receiver_,
        closePosition_
      );
    }
  }

  ///////////////////////////////////////////////////////
  ///       Inline utils
  ///////////////////////////////////////////////////////
  function _tc() internal view returns (ITetuConverter) {
    return ITetuConverter(_controller.tetuConverter());
  }
}