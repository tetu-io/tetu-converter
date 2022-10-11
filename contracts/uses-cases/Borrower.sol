// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IController.sol";
import "../interfaces/ITetuConverter.sol";
import "../openzeppelin/IERC20.sol";
import "../interfaces/IPoolAdapter.sol";
import "../openzeppelin/SafeERC20.sol";
import "../interfaces/IBorrower.sol";
import "../interfaces/IBorrowManager.sol";
import "hardhat/console.sol";

/// @notice This contract imitates real TetuConverter-user behavior
/// Terms:
///   UC: user
///   TC: TestConverter contract
///   PA: selected PoolAdapter
///   DM: DebtsMonitor
contract Borrower is IBorrower {
  using SafeERC20 for IERC20;

  IController immutable private _controller;

  uint public totalBorrowedAmount;
  uint public totalRepaidAmount;
  uint private _borrowPeriodInBlocks;

  constructor (
    address controller_,
    uint borrowPeriodInBlocks_
  ) {
    _controller = IController(controller_);
    _borrowPeriodInBlocks = borrowPeriodInBlocks_;
  }

  ///////////////////////////////////////////////////////
  /// Uses cases UC1.1, UC1.2, UC1.3 see project scope
  ///////////////////////////////////////////////////////
  /// @notice See US1.1 in the project scope. Borrow MAX allowed amount
  function makeBorrowUC1_1(
    address sourceAsset_,
    uint sourceAmount_,
    address targetAsset_,
    address receiver_
  ) external {
    console.log("makeBorrowUC1.1 start gasleft", gasleft());
    // ask TC for the best conversion strategy
    (address converter, uint maxTargetAmount,) = _tc().findConversionStrategy(sourceAsset_,
      sourceAmount_,
      targetAsset_,
      _borrowPeriodInBlocks,
      uint8(AppDataTypes.ConversionKind.UNKNOWN_0)
    );
    require(converter != address(0), "Conversion strategy wasn't found");
    require(maxTargetAmount != 0, "maxTargetAmount is 0");

    console.log("we can borrow:", maxTargetAmount, "gasleft", gasleft());
    console.log("sourceAmount_", sourceAmount_);
    console.log("balance st on tc", IERC20(sourceAsset_).balanceOf(address(this)));
    // transfer collateral to TC
    require(IERC20(sourceAsset_).balanceOf(address(this)) >= sourceAmount_
      , "wrong balance st on tc");
    IERC20(sourceAsset_).safeApprove(_controller.tetuConverter(), sourceAmount_);

    // borrow and receive borrowed-amount to receiver's balance
    ITetuConverter tc = _tc();
    tc.borrow(
      converter,
      sourceAsset_,
      sourceAmount_,
      targetAsset_,
      maxTargetAmount,
      receiver_
    );
    console.log("makeBorrowUC1.1 done gasleft6", gasleft());

    totalBorrowedAmount += maxTargetAmount;
  }

  /// @notice Borrow exact amount
  /// @param exact_ Meaning of the value_: exact or relative
  ///     true  - value contains exact amount to borrow
  ///     false - value contains RATIO, amount to borrow will be calculated as
  ///             amount to borrow = max allowed amount * RATIO
  ///             The ratio has decimals 18
  function makeBorrowExactAmount(
    address sourceAsset_,
    uint sourceAmount_,
    address targetAsset_,
    address receiver_,
    bool exact_,
    uint value_
  ) external {
    console.log("makeBorrowExactAmount start gasleft", gasleft());
    console.log("makeBorrowExactAmount sourceAsset_", sourceAsset_);
    console.log("makeBorrowExactAmount sourceAmount_", sourceAmount_);
    console.log("makeBorrowExactAmount targetAsset_", targetAsset_);
    console.log("makeBorrowExactAmount _borrowPeriodInBlocks", _borrowPeriodInBlocks);
    // ask TC for the best conversion strategy
    (address converter, uint maxTargetAmount,) = _tc().findConversionStrategy(sourceAsset_,
      sourceAmount_,
      targetAsset_,
      _borrowPeriodInBlocks,
      uint8(AppDataTypes.ConversionKind.UNKNOWN_0)
    );
    require(converter != address(0), "Conversion strategy wasn't found");
    require(maxTargetAmount != 0, "maxTargetAmount is 0");

    uint amountToBorrow = exact_
      ? value_
      : value_ * maxTargetAmount / 10**18; // value_contains RATIO with decimals 18

    console.log("we will borrow:", amountToBorrow, "gasleft", gasleft());
    console.log("sourceAmount_", sourceAmount_);
    console.log("balance st on tc", IERC20(sourceAsset_).balanceOf(address(this)));
    // transfer collateral to TC
    require(IERC20(sourceAsset_).balanceOf(address(this)) >= sourceAmount_
    , "wrong balance st on tc");
    IERC20(sourceAsset_).safeApprove(_controller.tetuConverter(), sourceAmount_);

    // borrow and receive borrowed-amount to receiver's balance
    ITetuConverter tc = _tc();
    tc.borrow(
      converter,
      sourceAsset_,
      sourceAmount_,
      targetAsset_,
      amountToBorrow,
      receiver_
    );
    console.log("makeBorrowExactAmount done gasleft6", gasleft());

    totalBorrowedAmount += amountToBorrow;
  }

  /// @notice See US1.2 in the project scope
  function makeRepayUC1_2(
    address collateralAsset_,
    address borrowedAsset_,
    address receiver_
  ) external {
    console.log("makeRepayUC1.2 started gasleft", gasleft());

    address[] memory poolAdapters = _tc().findBorrows(collateralAsset_, borrowedAsset_);
    uint lenPoolAdapters = poolAdapters.length;

    for (uint i = 0; i < lenPoolAdapters; ++i) {
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      pa.syncBalance(false);
      (uint collateralAmount, uint amountToPay,,) = pa.getStatus();
      if (amountToPay > 0) {
        console.log("makeRepayUC1.2: repay", amountToPay, collateralAmount);
        // transfer borrowed amount to Pool Adapter
        IERC20(borrowedAsset_).safeTransfer(poolAdapters[i], amountToPay);

        // repay borrowed amount and receive collateral to receiver's balance
        pa.repay(amountToPay, receiver_, true);

        totalRepaidAmount += amountToPay;

        // claim rewards
        pa.claimRewards(address(this));
      }
    }
    console.log("makeRepayUC1.2 done gasleft", gasleft());
  }

  function makeRepayUC1_2_firstPositionOnly(
    address collateralAsset_,
    address borrowedAsset_,
    address receiver_
  ) external {
    console.log("makeRepayUC1.2 started gasleft", gasleft());

    address[] memory poolAdapters = _tc().findBorrows(collateralAsset_, borrowedAsset_);
    uint lenPoolAdapters = poolAdapters.length;

    if (lenPoolAdapters > 0) {
      IPoolAdapter pa = IPoolAdapter(poolAdapters[0]);
      pa.syncBalance(false);
      (uint collateralAmount, uint amountToPay,,) = pa.getStatus();
      if (amountToPay > 0) {
        console.log("makeRepayUC1.2: repay", amountToPay, collateralAmount);
        // transfer borrowed amount to Pool Adapter
        IERC20(borrowedAsset_).safeTransfer(poolAdapters[0], amountToPay);

        // repay borrowed amount and receive collateral to receiver's balance
        pa.repay(amountToPay, receiver_, true);

        totalRepaidAmount += amountToPay;

        // claim rewards
        pa.claimRewards(address(this));
      }
    }
    console.log("makeRepayUC1.2 done gasleft", gasleft());
  }

  /// @notice See US1.3 in the project scope
  function makeRepayUC1_3(
    address collateralAsset_,
    address borrowedAsset_,
    address receiver_,
    uint amountToPay_
  ) external {
    console.log("makeRepayUS1.3 started - partial pay gasleft", gasleft());
    address[] memory poolAdapters = _tc().findBorrows(collateralAsset_, borrowedAsset_);
    uint lenPoolAdapters = poolAdapters.length;
    for (uint i = 0; i < lenPoolAdapters; ++i) {
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      pa.syncBalance(false);
      (, uint amountToPay,,) = pa.getStatus();

      uint amountToPayToPA = amountToPay_ >= amountToPay ? amountToPay : amountToPay_;
      bool closePosition = amountToPayToPA == amountToPay;

      // transfer borrowed amount to Pool Adapter
      IERC20(borrowedAsset_).safeTransfer(poolAdapters[i], amountToPayToPA);

      // repay borrowed amount and receive collateral to receiver's balance
      pa.repay(amountToPayToPA, receiver_, closePosition);

      // claim rewards
      pa.claimRewards(address(this));

      totalRepaidAmount += amountToPayToPA;
    }
    console.log("makeRepayUS1.3 done gasleft", gasleft());
  }

  ///////////////////////////////////////////////////////
  ///                   IBorrower impl
  ///////////////////////////////////////////////////////
  function requireReconversion(address poolAdapter) external override {
    console.log("requireReconversion start poolAdapter, gasleft", poolAdapter, gasleft());
    IPoolAdapter pa = IPoolAdapter(poolAdapter);

    // get amount to pay
    (,uint amountToPay,,) = pa.getStatus();
    (,,, address borrowAsset) = pa.getConfig();
    console.log("requireReconversion amountToPay=", amountToPay);
    console.log("requireReconversion borrowAsset=", borrowAsset);

    // In reality: make some actions and return required amount back to our balance
    // we need to receive borrow amount back to the receiver
    address receiver = address(this);

    // transfer borrowed amount directly to the Pool Adapter
    pa.syncBalance(false);
    require(IERC20(borrowAsset).balanceOf(address(this)) >= amountToPay, "not enough balance of borrow asset");
    IERC20(borrowAsset).safeTransfer(poolAdapter, amountToPay);

    //reconvert
    console.log("reconvert poolAdapter, period", poolAdapter, _borrowPeriodInBlocks);
    _tc().reconvert(poolAdapter, _borrowPeriodInBlocks, receiver);
    console.log("requireReconversion end gasleft", gasleft());
  }

  function requireRepay(address poolAdapter) external override {
    console.log("requireRepay start poolAdapter, gasleft", poolAdapter, gasleft());
    IPoolAdapter pa = IPoolAdapter(poolAdapter);

    // get amount to pay
    (,uint amountToPay,,) = pa.getStatus();
    (,,, address borrowAsset) = pa.getConfig();
    console.log("requireRepay amountToPay=", amountToPay);
    console.log("requireRepay borrowAsset=", borrowAsset);

    // transfer borrowed amount directly to the Pool Adapter
    pa.syncBalance(false);
    require(IERC20(borrowAsset).balanceOf(address(this)) >= amountToPay, "not enough balance of borrow asset");
    IERC20(borrowAsset).safeTransfer(poolAdapter, amountToPay);

    console.log("requireRepay end gasleft", gasleft());
  }

  ///////////////////////////////////////////////////////
  ///        Pre-initialize pool adapter
  ///////////////////////////////////////////////////////

  function preInitializePoolAdapter(
    address sourceAsset_,
    uint sourceAmount_,
    address targetAsset_
  ) external {
    console.log("preInitializePoolAdapter start gasleft", gasleft());

    (address converter,,) = _tc().findConversionStrategy(sourceAsset_,
      sourceAmount_,
      targetAsset_,
      _borrowPeriodInBlocks,
      uint8(AppDataTypes.ConversionKind.UNKNOWN_0)
    );

    console.log("preInitializePoolAdapter findConversionStrategy.completed gasleft", gasleft());

    IBorrowManager(_controller.borrowManager()).registerPoolAdapter(
      converter,
      address(this),
      sourceAsset_,
      targetAsset_
    );

    console.log("preInitializePoolAdapter registerPoolAdapter.completed gasleft", gasleft());
  }

  ///////////////////////////////////////////////////////
  ///                   View status
  ///////////////////////////////////////////////////////

  function getBorrows(
    address collateralAsset_,
    address borrowedAsset_
  ) external view returns (
    address[] memory poolAdapters
  ) {
    console.log("getBorrows start gasleft", gasleft());
    poolAdapters = _tc().findBorrows(collateralAsset_, borrowedAsset_);
    console.log("getBorrows end gasleft", gasleft());
  }

  ///////////////////////////////////////////////////////
  ///       Inline utils
  ///////////////////////////////////////////////////////
  function _tc() internal view returns (ITetuConverter) {
    return ITetuConverter(_controller.tetuConverter());
  }
}