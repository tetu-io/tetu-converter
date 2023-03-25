// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../interfaces/IConverterController.sol";
import "../interfaces/ITetuConverter.sol";
import "../openzeppelin/IERC20.sol";
import "../interfaces/IPoolAdapter.sol";
import "../openzeppelin/SafeERC20.sol";
import "../interfaces/IKeeperCallback.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/ITetuConverterCallback.sol";
import "../interfaces/IDebtMonitor.sol";
import "hardhat/console.sol";

/// @notice This contract emulates real TetuConverter-user behavior
/// Terms:
///   UC: user
///   TC: TestConverter contract
///   PA: selected PoolAdapter
///   DM: DebtsMonitor
contract Borrower is ITetuConverterCallback {
  using SafeERC20 for IERC20;

  IConverterController immutable private _controller;

  uint public totalBorrowedAmount;
  uint public totalAmountBorrowAssetRepaid;
  uint private _borrowPeriodInBlocks;

  ////////////////////////////////////////////////////////////////////
  // Last results passed to onTransferBorrowedAmount
  uint public onTransferAmountsLength;
  address[] public onTransferAmountsAssets;
  uint[] public onTransferAmountsAmounts;
  uint public onTransferBorrowedAmountLastResultAmountBorrowAssetSentToBorrower;

  uint public lastQuoteRepayResultCollateralAmount;
  uint public lastQuoteRepayGasConsumption;
  /// @notice Call quoteRepay for amountToRepay + additional amount
  uint public additionalAmountForQuoteRepay;

  uint public makeRepayCompleteAmountToRepay;
  uint public makeRepayCompletePaidAmount;

  struct RequireAmountBackParams {
    uint amount;
  }
  RequireAmountBackParams public requireAmountBackParams;

  struct MakeRepayResults {
    uint collateralAmountOut;
    uint returnedBorrowAmountOut;
    uint swappedLeftoverCollateralOut;
    uint swappedLeftoverBorrowOut;
  }
  MakeRepayResults public repayResults;

  constructor (
    address controller_,
    uint borrowPeriodInBlocks_
  ) {
    _controller = IConverterController(controller_);
    _borrowPeriodInBlocks = borrowPeriodInBlocks_;
  }

  function setAdditionalAmountForQuoteRepay(uint value) external {
    additionalAmountForQuoteRepay = value;
  }

  function setBorrowPeriodInBlocks(uint borrowPeriodInBlocks_) external {
    _borrowPeriodInBlocks = borrowPeriodInBlocks_;
  }

  ///////////////////////////////////////////////////////
  ///               Borrow
  ///////////////////////////////////////////////////////
  /// @notice Borrow MAX allowed amount
  function borrowMaxAmount(
    bytes memory entryData_,
    address sourceAsset_,
    uint sourceAmount_,
    address targetAsset_,
    address receiver_
  ) external returns (uint borrowedAmountOut, address converterOut) {
    console.log("borrowMaxAmount start gasleft", gasleft());
    console.log("borrowMaxAmount receiver_", receiver_);
    // ask TC for the best conversion strategy
    IERC20(sourceAsset_).approve(address(_tc()), sourceAmount_);
    (address converter, uint collateralAmount, uint amountToBorrow,) = _tc().findConversionStrategy(
      entryData_,
      sourceAsset_,
      sourceAmount_,
      targetAsset_,
      _borrowPeriodInBlocks
    );
    require(converter != address(0), "Conversion strategy wasn't found");
    require(amountToBorrow != 0, "maxTargetAmount is 0");

    console.log("we can borrow:", amountToBorrow, "gasleft", gasleft());
    console.log("sourceAmount_", sourceAmount_);
    console.log("balance st on tc", IERC20(sourceAsset_).balanceOf(address(this)));
    // transfer collateral to TC
    require(IERC20(sourceAsset_).balanceOf(address(this)) >= sourceAmount_,
      "borrowMaxAmount:borrower has wrong balance of collateral");

    // borrow and receive borrowed-amount to receiver's balance
    ITetuConverter tc = _tc();
    borrowedAmountOut = tc.borrow(
      converter,
      sourceAsset_,
      collateralAmount,
      targetAsset_,
      amountToBorrow,
      receiver_
    );
    console.log("borrowMaxAmount done gasleft6", gasleft());
    console.log("Borrowed amount", borrowedAmountOut, "were sent to receiver", receiver_);

    totalBorrowedAmount += amountToBorrow;
    converterOut = converter;
  }

  /// @notice Borrow exact amount
  function borrowExactAmount(
    address sourceAsset_,
    uint sourceAmount_,
    address targetAsset_,
    address receiver_,
    uint amountToBorrow_
  ) external returns (uint borrowedAmountOut, address converterOut) {
    uint gasStart = gasleft();
    console.log("borrowExactAmount start gasStart", gasStart);
    console.log("borrowExactAmount msg.sender", msg.sender);
    console.log("borrowExactAmount sourceAsset_", sourceAsset_);
    console.log("borrowExactAmount sourceAmount_", sourceAmount_);
    console.log("borrowExactAmount targetAsset_", targetAsset_);
    console.log("borrowExactAmount receiver_", receiver_);
    console.log("borrowExactAmount _borrowPeriodInBlocks", _borrowPeriodInBlocks);

    // ask TC for the best conversion strategy
    IERC20(sourceAsset_).approve(address(_tc()), sourceAmount_);
    (address converter,, uint amountToBorrow,) = _tc().findConversionStrategy(
      abi.encode(uint(0)), // ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0
      sourceAsset_,
      sourceAmount_,
      targetAsset_,
      _borrowPeriodInBlocks
    );
    require(converter != address(0), "Conversion strategy wasn't found");
    require(amountToBorrow != 0, "maxTargetAmount is 0");

    console.log("we will borrow:", amountToBorrow_);
    console.log("gasleft/used by findConversionStrategy", gasStart - gasleft());
    console.log("sourceAmount_", sourceAmount_);
    console.log("converter", converter);
    console.log("balance st on tc", IERC20(sourceAsset_).balanceOf(address(this)));
    // transfer collateral to TC
    require(IERC20(sourceAsset_).balanceOf(address(this)) >= sourceAmount_, "borrowExactAmount:wrong balance st on tc");

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
    console.log("borrowExactAmount done gasleft/used", gasStart - gasleft());

    totalBorrowedAmount += amountToBorrow_;
    converterOut = converter;
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
    IERC20(sourceAsset_).safeApprove(
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
  ) external returns (
    uint collateralAmountOut,
    uint returnedBorrowAmountOut,
    uint swappedLeftoverCollateralOut,
    uint swappedLeftoverBorrowOut
  ) {
    console.log("makeRepayComplete started gasleft", gasleft());
    // test quoteRepay prediction

    (uint amountToPay,) = _tc().getDebtAmountCurrent(address(this), collateralAsset_, borrowedAsset_);

    uint borrowBalanceBeforeRepay = IERC20(borrowedAsset_).balanceOf(address(this));
    console.log("makeRepayComplete amountToPay", amountToPay);
    console.log("makeRepayComplete borrowed asset balance before repay", borrowBalanceBeforeRepay);

    lastQuoteRepayGasConsumption = gasleft();
    lastQuoteRepayResultCollateralAmount = _tc().quoteRepay(
      address(this),
      collateralAsset_,
      borrowedAsset_,
      amountToPay + additionalAmountForQuoteRepay
    );
    lastQuoteRepayGasConsumption -= gasleft();
    console.log("makeRepayComplete.quoteRepay", lastQuoteRepayResultCollateralAmount, lastQuoteRepayGasConsumption);

    IERC20(borrowedAsset_).safeTransfer(address(_tc()), amountToPay);

    console.log("makeRepayComplete repay - start");
    (collateralAmountOut,
     returnedBorrowAmountOut,
     swappedLeftoverCollateralOut,
     swappedLeftoverBorrowOut
    ) = _tc().repay(collateralAsset_, borrowedAsset_, amountToPay, receiver_);

    uint borrowBalanceAfterRepay = IERC20(borrowedAsset_).balanceOf(address(this));
    console.log("makeRepayComplete borrowed asset balance after repay", borrowBalanceAfterRepay);

    totalAmountBorrowAssetRepaid += borrowBalanceBeforeRepay - borrowBalanceAfterRepay;
    makeRepayCompleteAmountToRepay = amountToPay;
    makeRepayCompletePaidAmount = borrowBalanceBeforeRepay - borrowBalanceAfterRepay;

    console.log("makeRepayComplete repay - finish");
    console.log("makeRepayComplete borrowed asset balance", IERC20(borrowedAsset_).balanceOf(address(this)));
    _tc().claimRewards(address(this));

    console.log("makeRepayComplete done gasleft", gasleft(), collateralAmountOut, returnedBorrowAmountOut);
    repayResults.collateralAmountOut = collateralAmountOut;
    repayResults.returnedBorrowAmountOut = returnedBorrowAmountOut;
    repayResults.swappedLeftoverBorrowOut = swappedLeftoverBorrowOut;
    repayResults.swappedLeftoverCollateralOut = swappedLeftoverCollateralOut;
  }

  /// @notice Partial repay, see US1.3 in the project scope
  function makeRepayPartial(
    address collateralAsset_,
    address borrowedAsset_,
    address receiver_,
    uint amountToPay_
  ) external returns (
    uint collateralAmountOut,
    uint returnedBorrowAmountOut,
    uint swappedLeftoverCollateralOut,
    uint swappedLeftoverBorrowOut
  ) {
    console.log("makeRepayPartial started - partial pay gasleft", gasleft());

    lastQuoteRepayGasConsumption = gasleft();
    lastQuoteRepayResultCollateralAmount = _tc().quoteRepay(
      address(this),
      collateralAsset_,
      borrowedAsset_,
      amountToPay_ + additionalAmountForQuoteRepay
    );
    lastQuoteRepayGasConsumption -= gasleft();
    console.log("makeRepayPartial.quoteRepay", lastQuoteRepayResultCollateralAmount, lastQuoteRepayGasConsumption);

    IERC20(borrowedAsset_).safeTransfer(address(_tc()), amountToPay_);
    (collateralAmountOut,
     returnedBorrowAmountOut,
     swappedLeftoverCollateralOut,
     swappedLeftoverBorrowOut
    ) = _tc().repay(collateralAsset_, borrowedAsset_, amountToPay_, receiver_);
    totalAmountBorrowAssetRepaid += amountToPay_;
    _tc().claimRewards(address(this));

    console.log("makeRepayPartial done gasleft", gasleft(), collateralAmountOut, returnedBorrowAmountOut);
    repayResults.collateralAmountOut = collateralAmountOut;
    repayResults.returnedBorrowAmountOut = returnedBorrowAmountOut;
    repayResults.swappedLeftoverCollateralOut = swappedLeftoverCollateralOut;
    repayResults.swappedLeftoverBorrowOut = swappedLeftoverBorrowOut;
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
  ) external returns (
    uint collateralAmountOut
  ) {
    console.log("makeRepayComplete_firstPositionOnly started gasleft", gasleft());

    address[] memory poolAdapters = _debtMonitor().getPositions(address(this), collateralAsset_, borrowedAsset_);
    uint lenPoolAdapters = poolAdapters.length;

    if (lenPoolAdapters != 0) {
      IPoolAdapter pa = IPoolAdapter(poolAdapters[0]);
      pa.updateStatus();
      (uint collateralAmount, uint amountToPay,,,) = pa.getStatus();
      if (amountToPay != 0) {
        console.log("makeRepayUC1.2: repay", amountToPay, collateralAmount);
        // transfer borrowed amount to Pool Adapter
        IERC20(borrowedAsset_).safeApprove(poolAdapters[0], amountToPay);

        // repay borrowed amount and receive collateral to receiver's balance
        collateralAmountOut = pa.repay(amountToPay, receiver_, true);

        totalAmountBorrowAssetRepaid += amountToPay;

        // claim rewards
        pa.claimRewards(address(this));
      }
    }
    console.log("makeRepayComplete_firstPositionOnly done gasleft", gasleft(), collateralAmountOut);
    return collateralAmountOut;
  }

  ///////////////////////////////////////////////////////
  ///                   IBorrower impl
  ///////////////////////////////////////////////////////

  /// @notice Set up behavior of requireAmountBack()
  function setUpRequireAmountBack(uint amount_) external {
    requireAmountBackParams = RequireAmountBackParams({
      amount: amount_
    });
  }

  function requirePayAmountBack(address asset_, uint amount_) external override returns (uint amountOut) {
    console.log("requirePayAmountBack.asset_", asset_);
    console.log("requirePayAmountBack.amount_", amount_);
    amountOut = requireAmountBackParams.amount == 0
      ? amount_
      : requireAmountBackParams.amount;

    uint balance = IERC20(asset_).balanceOf(address(this));
    if (amountOut > balance) {
      amountOut = balance;
    }
    IERC20(asset_).transfer(address(_tc()), amountOut);
  }

  function onTransferAmounts(address[] memory assets_, uint[] memory amounts_) external override {
    onTransferAmountsLength = assets_.length;
    onTransferAmountsAssets = assets_;
    onTransferAmountsAmounts = amounts_;
  }
  function getOnTransferAmountsResults() external view returns (address[] memory assets_, uint[] memory amounts_) {
    return (onTransferAmountsAssets, onTransferAmountsAmounts);
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
  ///                   View status
  ///////////////////////////////////////////////////////

  function getBorrows(
    address collateralAsset_,
    address borrowedAsset_
  ) external view returns (
    address[] memory poolAdapters
  ) {
    console.log("getBorrows start gasleft", gasleft());
    poolAdapters = _debtMonitor().getPositions(address(this), collateralAsset_, borrowedAsset_);
    console.log("getBorrows end gasleft", gasleft());
  }

  ///////////////////////////////////////////////////////
  ///       Inline utils
  ///////////////////////////////////////////////////////
  function _tc() internal view returns (ITetuConverter) {
    return ITetuConverter(_controller.tetuConverter());
  }
  function _debtMonitor() internal view returns (IDebtMonitor) {
    return IDebtMonitor(_controller.debtMonitor());
  }
}
