// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IController.sol";
import "../interfaces/ITetuConverter.sol";
import "../openzeppelin/IERC20.sol";
import "../interfaces/IPoolAdapter.sol";
import "../openzeppelin/SafeERC20.sol";
import "../interfaces/IKeeperCallback.sol";
import "../interfaces/IBorrowManager.sol";
import "hardhat/console.sol";
import "../interfaces/ITetuConverterCallback.sol";

/// @notice This contract emulates real TetuConverter-user behavior
/// Terms:
///   UC: user
///   TC: TestConverter contract
///   PA: selected PoolAdapter
///   DM: DebtsMonitor
contract Borrower is ITetuConverterCallback {
  using SafeERC20 for IERC20;

  IController immutable private _controller;

  uint public totalBorrowedAmount;
  uint public totalAmountBorrowAssetRepaid;
  uint private _borrowPeriodInBlocks;

  ////////////////////////////////////////////////////////////////////
  // Last results passed to onTransferBorrowedAmount
  address public onTransferBorrowedAmountLastResultCollateralAsset;
  address public onTransferBorrowedAmountLastResultBorrowAsset;
  uint public onTransferBorrowedAmountLastResultAmountBorrowAssetSentToBorrower;

  struct RequireAmountBackParams {
    uint amount;
    // we need TWO different variables here to be able to test bad-paths
    bool isCollateral;
    bool sendCollateral;
  }
  RequireAmountBackParams public requireAmountBackParams;

  constructor (
    address controller_,
    uint borrowPeriodInBlocks_
  ) {
    _controller = IController(controller_);
    _borrowPeriodInBlocks = borrowPeriodInBlocks_;
  }

  ///////////////////////////////////////////////////////
  ///               Borrow
  ///////////////////////////////////////////////////////
  /// @notice Borrow MAX allowed amount
  function borrowMaxAmount(
    address sourceAsset_,
    uint sourceAmount_,
    address targetAsset_,
    address receiver_
  ) external returns (uint borrowedAmountOut) {
    console.log("borrowMaxAmount start gasleft", gasleft());
    console.log("borrowMaxAmount receiver_", receiver_);
    // ask TC for the best conversion strategy
    (address converter, uint maxTargetAmount,) = _tc().findConversionStrategy(sourceAsset_,
      sourceAmount_,
      targetAsset_,
      _borrowPeriodInBlocks,
      ITetuConverter.ConversionMode.AUTO_0
    );
    require(converter != address(0), "Conversion strategy wasn't found");
    require(maxTargetAmount != 0, "maxTargetAmount is 0");

    console.log("we can borrow:", maxTargetAmount, "gasleft", gasleft());
    console.log("sourceAmount_", sourceAmount_);
    console.log("balance st on tc", IERC20(sourceAsset_).balanceOf(address(this)));
    // transfer collateral to TC
    require(IERC20(sourceAsset_).balanceOf(address(this)) >= sourceAmount_
      , "wrong balance st on tc");
    IERC20(sourceAsset_).safeTransfer(_controller.tetuConverter(), sourceAmount_);

    // borrow and receive borrowed-amount to receiver's balance
    ITetuConverter tc = _tc();
    borrowedAmountOut = tc.borrow(
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
  function borrowExactAmount(
    address sourceAsset_,
    uint sourceAmount_,
    address targetAsset_,
    address receiver_,
    uint amountToBorrow_
  ) external returns (uint borrowedAmountOut) {
    console.log("borrowExactAmount start gasleft", gasleft());
    console.log("borrowExactAmount msg.sender", msg.sender);
    console.log("borrowExactAmount sourceAsset_", sourceAsset_);
    console.log("borrowExactAmount sourceAmount_", sourceAmount_);
    console.log("borrowExactAmount targetAsset_", targetAsset_);
    console.log("borrowExactAmount receiver_", receiver_);
    console.log("borrowExactAmount _borrowPeriodInBlocks", _borrowPeriodInBlocks);
    // ask TC for the best conversion strategy
    (address converter, uint maxTargetAmount,) = _tc().findConversionStrategy(sourceAsset_,
      sourceAmount_,
      targetAsset_,
      _borrowPeriodInBlocks,
      ITetuConverter.ConversionMode.AUTO_0
    );
    require(converter != address(0), "Conversion strategy wasn't found");
    require(maxTargetAmount != 0, "maxTargetAmount is 0");

    console.log("we will borrow:", amountToBorrow_, "gasleft", gasleft());
    console.log("sourceAmount_", sourceAmount_);
    console.log("converter", converter);
    console.log("balance st on tc", IERC20(sourceAsset_).balanceOf(address(this)));
    // transfer collateral to TC
    require(IERC20(sourceAsset_).balanceOf(address(this)) >= sourceAmount_, "wrong balance st on tc");
    IERC20(sourceAsset_).safeTransfer(_controller.tetuConverter(), sourceAmount_);
    console.log("Collateral amount was passed to tetu converter");

    // borrow and receive borrowed-amount to receiver's balance
    ITetuConverter tc = _tc();
    borrowedAmountOut = tc.borrow(
      converter,
      sourceAsset_,
      sourceAmount_,
      targetAsset_,
      amountToBorrow_,
      receiver_
    );
    console.log("borrowExactAmount done gasleft6", gasleft());

    totalBorrowedAmount += amountToBorrow_;
  }

  /// @notice Borrow exact amount using giving converter
  /// @dev To check bad paths: 1) unregistered converter is used 2) wrong amount is transferred to TetuConverter
  function borrowExactAmountBadPaths(
    address sourceAsset_,
    uint sourceAmount_,
    address targetAsset_,
    address receiver_,
    uint amountToBorrow_,
    address converter_,
    uint transferMultiplier18_
  ) external returns (uint borrowedAmountOut) {
    console.log("borrowExactAmountWithManualConverter start gasleft", gasleft());

    // transfer collateral to TetuConverter
    require(IERC20(sourceAsset_).balanceOf(address(this)) >= sourceAmount_, "wrong collateral asset balance");
    IERC20(sourceAsset_).safeTransfer(
      _controller.tetuConverter(),
      sourceAmount_ * transferMultiplier18_ / 1e18
    );

    // borrow and receive borrowed-amount to receiver's balance
    ITetuConverter tc = _tc();
    borrowedAmountOut = tc.borrow(
      converter_,
      sourceAsset_,
      sourceAmount_,
      targetAsset_,
      amountToBorrow_,
      receiver_
    );
    console.log("borrowExactAmountWithManualConverter done gasleft6", gasleft());

    totalBorrowedAmount += amountToBorrow_;
  }

  ///////////////////////////////////////////////////////
  ///               Repay
  ///////////////////////////////////////////////////////
  /// @notice Complete repay, see US1.2 in the project scope
  function makeRepayComplete(
    address collateralAsset_,
    address borrowedAsset_,
    address receiver_
  ) external {
    console.log("makeRepayComplete started gasleft", gasleft());

    (uint amountToPay,) = _tc().getDebtAmountCurrent(collateralAsset_, borrowedAsset_);
    console.log("makeRepayComplete amountToPay", amountToPay);
    console.log("makeRepayComplete borrowed asset balance", IERC20(borrowedAsset_).balanceOf(address(this)));

    IERC20(borrowedAsset_).safeTransfer(address(_tc()), amountToPay);

    console.log("makeRepayComplete repay - start");
    _tc().repay(collateralAsset_, borrowedAsset_, amountToPay, receiver_);
    totalAmountBorrowAssetRepaid += amountToPay;

    console.log("makeRepayComplete repay - finish");
    _tc().claimRewards(address(this));

    console.log("makeRepayComplete done gasleft", gasleft());
  }

  /// @notice Partial repay, see US1.3 in the project scope
  function makeRepayPartial(
    address collateralAsset_,
    address borrowedAsset_,
    address receiver_,
    uint amountToPay_
  ) external {
    console.log("makeRepayPartial started - partial pay gasleft", gasleft());

    IERC20(borrowedAsset_).safeTransfer(address(_tc()), amountToPay_);
    _tc().repay(collateralAsset_, borrowedAsset_, amountToPay_, receiver_);
    totalAmountBorrowAssetRepaid += amountToPay_;
    _tc().claimRewards(address(this));

    console.log("makeRepayPartial done gasleft", gasleft());
  }

  ///////////////////////////////////////////////////////
  ///  Direct repay for unit tests only
  ///  The contract uses interface IPoolAdapter directly,
  ///  real strategy never does it
  ///////////////////////////////////////////////////////

  function makeRepayComplete_firstPositionOnly(
    address collateralAsset_,
    address borrowedAsset_,
    address receiver_
  ) external {
    console.log("makeRepayComplete_firstPositionOnly started gasleft", gasleft());

    address[] memory poolAdapters = _tc().findBorrows(collateralAsset_, borrowedAsset_);
    uint lenPoolAdapters = poolAdapters.length;

    if (lenPoolAdapters > 0) {
      IPoolAdapter pa = IPoolAdapter(poolAdapters[0]);
      pa.updateStatus();
      (uint collateralAmount, uint amountToPay,,,) = pa.getStatus();
      if (amountToPay > 0) {
        console.log("makeRepayUC1.2: repay", amountToPay, collateralAmount);
        // transfer borrowed amount to Pool Adapter
        IERC20(borrowedAsset_).safeApprove(poolAdapters[0], amountToPay);

        // repay borrowed amount and receive collateral to receiver's balance
        pa.repay(amountToPay, receiver_, true);

        totalAmountBorrowAssetRepaid += amountToPay;

        // claim rewards
        pa.claimRewards(address(this));
      }
    }
    console.log("makeRepayComplete_firstPositionOnly done gasleft", gasleft());
  }

  ///////////////////////////////////////////////////////
  ///                   IBorrower impl
  ///////////////////////////////////////////////////////

  /// @notice Set up behavior of requireAmountBack()
  function setUpRequireAmountBack(
    uint amount_,
    bool isCollateral_,
    bool sendCollateral_
  ) external {
    requireAmountBackParams = RequireAmountBackParams({
      amount: amount_,
      isCollateral: isCollateral_,
      sendCollateral: sendCollateral_
    });
  }

  function requireAmountBack (
    address collateralAsset_,
    uint requiredAmountCollateralAsset_,
    address borrowAsset_,
    uint requiredAmountBorrowAsset_
  ) external override returns (
    uint amountOut,
    bool isCollateralOut
  ) {
    // TODO: implement path to use requiredAmountCollateralAsset_
    uint amountToSend = requireAmountBackParams.amount == 0
      ? requiredAmountBorrowAsset_
      : requireAmountBackParams.amount;
    // we use two different variables here to be able to implement bad-path
    // (user sends one asset but returns a value of isCollateralOut for the different asset)
    bool isCollateral = requireAmountBackParams.amount != 0 && requireAmountBackParams.isCollateral;
    bool sendCollateral = requireAmountBackParams.amount != 0 && requireAmountBackParams.sendCollateral;

    if (sendCollateral) {
      require(IERC20(collateralAsset_).balanceOf(address(this)) >= amountToSend, "Not enough collateral asset on balance");
      IERC20(collateralAsset_).transfer(address(_tc()), amountToSend);
    } else {
      require(IERC20(borrowAsset_).balanceOf(address(this)) >= amountToSend, "Not enough borrow asset on balance");
      IERC20(borrowAsset_).transfer(address(_tc()), amountToSend);
    }

    return (amountToSend, isCollateral);
  }

  function onTransferBorrowedAmount (
    address collateralAsset_,
    address borrowAsset_,
    uint amountBorrowAssetSentToBorrower_
  ) external override {
    onTransferBorrowedAmountLastResultCollateralAsset = collateralAsset_;
    onTransferBorrowedAmountLastResultBorrowAsset = borrowAsset_;
    onTransferBorrowedAmountLastResultAmountBorrowAssetSentToBorrower = amountBorrowAssetSentToBorrower_;
  }

//  function requireRepay(
//    address collateralAsset_,
//    address borrowAsset_,
//    uint amountToRepay_,
//    address converter_
//  ) external override returns (Status) {
////    console.log("requireRepay start poolAdapter, gasleft", poolAdapter, gasleft());
//
//    collateralAsset_;
//    borrowAsset_;
//    amountToRepay_;
//    converter_;
//
//    ITetuConverter tc = _tc();
//
//    // TODO refactoring
////    IPoolAdapter pa = IPoolAdapter(poolAdapter);
////
////    // get amount to pay
////    (,uint amountToPay,,) = pa.getStatus();
////    (,,, address borrowAsset) = pa.getConfig();
////    console.log("requireRepay amountToPay=", amountToPay);
////    console.log("requireRepay borrowAsset=", borrowAsset);
////
////    // transfer borrowed amount directly to the Pool Adapter
////    pa.syncBalance(false);
////    require(IERC20(borrowAsset).balanceOf(address(this)) >= amountToPay, "not enough balance of borrow asset");
////    IERC20(borrowAsset).safeTransfer(poolAdapter, amountToPay);
////
////    console.log("requireRepay end gasleft", gasleft());
//    return Status.DONE_1;
//  }
//
//  function recommendBorrow(
//    address collateralAsset_,
//    address borrowAsset_,
//    uint amountToBorrow_,
//    address converter_
//  ) external override returns (Status) {
//    //TODO refactoring
//    collateralAsset_;
//    borrowAsset_;
//    amountToBorrow_;
//    converter_;
//
//    ITetuConverter tc = _tc();
//
//    return Status.IGNORED_2;
//  }
//
//  function requireReconversion(
//    address poolAdapter
//  ) external override returns (Status) {
//    console.log("requireReconversion start poolAdapter, gasleft", poolAdapter, gasleft());
//    IPoolAdapter pa = IPoolAdapter(poolAdapter);
//
//    // get amount to pay
//    (,uint amountToPay,,) = pa.getStatus();
//    (,,, address borrowAsset) = pa.getConfig();
//    console.log("requireReconversion amountToPay=", amountToPay);
//    console.log("requireReconversion borrowAsset=", borrowAsset);
//
//    // In reality: make some actions and return required amount back to our balance
//    // we need to receive borrow amount back to the receiver
//    address receiver = address(this);
//
//    // transfer borrowed amount directly to the Pool Adapter
//    pa.syncBalance(false);
//    require(IERC20(borrowAsset).balanceOf(address(this)) >= amountToPay, "not enough balance of borrow asset");
//    IERC20(borrowAsset).safeTransfer(poolAdapter, amountToPay);
//
//    //reconvert
//    console.log("reconvert poolAdapter, period", poolAdapter, _borrowPeriodInBlocks);
//    _tc().reconvert(poolAdapter, _borrowPeriodInBlocks, receiver);
//    console.log("requireReconversion end gasleft", gasleft());
//
//    return Status.DONE_1;
//  }



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
      ITetuConverter.ConversionMode.AUTO_0
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