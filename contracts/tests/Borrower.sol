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
import "./lending-platform/PoolAdapterMock.sol";

/// @notice This contract emulates real TetuConverter-user behavior
/// Terms:
///   UC: user
///   TC: TestConverter contract
///   PA: selected PoolAdapter
///   DM: DebtsMonitor
contract Borrower is ITetuConverterCallback {
  using SafeERC20 for IERC20;

  //region--------------------------------------------- Data types and variables
  IConverterController immutable private _controller;

  uint public totalBorrowedAmount;
  uint public totalAmountBorrowAssetRepaid;
  uint private _borrowPeriodInBlocks;

  //-----------------------------------------------------
  // Last results passed to onTransferBorrowedAmount
  uint public onTransferAmountsLength;
  address[] public onTransferAmountsAssets;
  uint[] public onTransferAmountsAmounts;
  uint public onTransferBorrowedAmountLastResultAmountBorrowAssetSentToBorrower;

  uint public lastQuoteRepayResultCollateralAmount;
  uint public lastQuoteRepayResultSwappedAmount;
  uint public lastQuoteRepayGasConsumption;
  /// @notice Call quoteRepay for amountToRepay + additional amount
  uint public additionalAmountForQuoteRepay;

  uint public makeRepayCompleteAmountToRepay;
  uint public makeRepayCompletePaidAmount;

  /// @dev {requirePayAmountBack} can be called 1 or 2 times
  struct RequireAmountBackParams {
    uint amountToReturn1;
    uint amountToTransfer1;
    uint amountToReturn2;
    uint amountToTransfer2;

    uint countCalls;
    uint amountPassedToRequireRepayAtFirstCall;
    uint amountPassedToRequireRepayAtSecondCall;

    address poolAdapterAddress;
    uint amountToSendToPoolAdapterAtFirstCall;
    address amountProvider;
    bool closeTheDebtAtFistCall;
  }
  RequireAmountBackParams public requireAmountBackParams;

  struct MakeRepayResults {
    uint collateralAmountOut;
    uint returnedBorrowAmountOut;
    uint swappedLeftoverCollateralOut;
    uint swappedLeftoverBorrowOut;
  }
  MakeRepayResults public repayResults;

  struct MakeRepayCompleteTwoStepsLocal {
    uint borrowBalanceBeforeRepay;
    uint borrowBalanceAfterRepay;
    uint collateralAmountOut;
    uint returnedBorrowAmountOut;
    uint swappedLeftoverCollateralOut;
    uint swappedLeftoverBorrowOut;
  }
  //endregion--------------------------------------------- Data types and variables

  //region--------------------------------------------- Initialization and setup
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
  //endregion--------------------------------------------- Initialization and setup

  //region--------------------------------------------- Borrow
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
  //endregion--------------------------------------------- Borrow

  //region--------------------------------------------- Repay
  function makeRepayComplete(address collateralAsset_, address borrowedAsset_, address receiver_) external returns (
    uint collateralAmountOut,
    uint returnedBorrowAmountOut,
    uint swappedLeftoverCollateralOut,
    uint swappedLeftoverBorrowOut
  ) {
    console.log("makeRepayComplete started gasleft", gasleft());

    uint borrowBalanceBeforeRepay = IERC20(borrowedAsset_).balanceOf(address(this));

    // test quoteRepay prediction
    lastQuoteRepayGasConsumption = gasleft();
    // for quoteRepay we need pure debts without debt-gap
    (uint amountToPay,) = _tc().getDebtAmountCurrent(address(this), collateralAsset_, borrowedAsset_, false);
    console.log("makeRepayComplete amountToPay (no debt gap)", amountToPay);
    console.log("makeRepayComplete borrowed asset balance before repay", borrowBalanceBeforeRepay);
    (lastQuoteRepayResultCollateralAmount, lastQuoteRepayResultSwappedAmount) = _tc().quoteRepay(
      address(this),
      collateralAsset_,
      borrowedAsset_,
      amountToPay + additionalAmountForQuoteRepay
    );
    lastQuoteRepayGasConsumption -= gasleft();
    console.log("makeRepayComplete.quoteRepay", lastQuoteRepayResultCollateralAmount, lastQuoteRepayResultSwappedAmount, lastQuoteRepayGasConsumption);

    // for repay we need debts with debt-gap
    (amountToPay,) = _tc().getDebtAmountCurrent(address(this), collateralAsset_, borrowedAsset_, true);
    console.log("makeRepayComplete amountToPay (with debt gap)", amountToPay);
    IERC20(borrowedAsset_).safeTransfer(address(_tc()), amountToPay);

    console.log("makeRepayComplete repay - start");
    (collateralAmountOut,
     returnedBorrowAmountOut,
     swappedLeftoverCollateralOut,
     swappedLeftoverBorrowOut
    ) = _tc().repay(collateralAsset_, borrowedAsset_, amountToPay, receiver_);

    uint borrowBalanceAfterRepay = IERC20(borrowedAsset_).balanceOf(address(this));
    console.log("makeRepayComplete borrowed asset balance after repay", borrowBalanceAfterRepay);

    makeRepayCompleteAmountToRepay = amountToPay;
    makeRepayCompletePaidAmount = borrowBalanceBeforeRepay > borrowBalanceAfterRepay
      ? borrowBalanceBeforeRepay - borrowBalanceAfterRepay
      : 0;
    totalAmountBorrowAssetRepaid += makeRepayCompletePaidAmount;

    console.log("makeRepayComplete repay - finish");
    console.log("makeRepayComplete borrowed asset balance", IERC20(borrowedAsset_).balanceOf(address(this)));
    _tc().claimRewards(address(this));

    console.log("makeRepayComplete done gasleft", gasleft(), collateralAmountOut, returnedBorrowAmountOut);
    repayResults.collateralAmountOut = collateralAmountOut;
    repayResults.returnedBorrowAmountOut = returnedBorrowAmountOut;
    repayResults.swappedLeftoverBorrowOut = swappedLeftoverBorrowOut;
    repayResults.swappedLeftoverCollateralOut = swappedLeftoverCollateralOut;
  }

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
    (lastQuoteRepayResultCollateralAmount, lastQuoteRepayResultSwappedAmount) = _tc().quoteRepay(
      address(this),
      collateralAsset_,
      borrowedAsset_,
      amountToPay_ + additionalAmountForQuoteRepay
    );
    lastQuoteRepayGasConsumption -= gasleft();
    console.log("makeRepayPartial.quoteRepay", lastQuoteRepayResultCollateralAmount, lastQuoteRepayResultSwappedAmount, lastQuoteRepayGasConsumption);

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

  /// @notice  Direct repay for tests only. The contract uses interface IPoolAdapter directly, real strategy never does it
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
      (uint collateralAmount, uint amountToPay,,,,) = pa.getStatus();
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
  //endregion--------------------------------------------- Repay

  //region--------------------------------------------- Two actions per single block

  /// @notice Make full-repay using two calls of repay() to be sure that two repays are allowed in a single block
  function makeRepayRepay(address collateralAsset_, address borrowedAsset_, address receiver_, uint amountFirstStep) external returns (
    uint collateralAmountOut,
    uint returnedBorrowAmountOut
  ) {
    console.log("makeRepayBorrow.balance.0.borrowAsset", IERC20(borrowedAsset_).balanceOf(address(this)));
    console.log("makeRepayBorrow.balance.0.collateralAsset", IERC20(collateralAsset_).balanceOf(address(this)));
    MakeRepayCompleteTwoStepsLocal memory v;

    console.log("makeRepayRepay - repay 1", amountFirstStep);
    IERC20(borrowedAsset_).safeTransfer(address(_tc()), amountFirstStep);
    (v.collateralAmountOut, v.returnedBorrowAmountOut,,) = _tc().repay(collateralAsset_, borrowedAsset_, amountFirstStep, receiver_);

    // for full repay we need debts with debt-gap
    (uint amountToPay,) = _tc().getDebtAmountCurrent(address(this), collateralAsset_, borrowedAsset_, true);

    console.log("makeRepayBorrow.balance.after repay.borrowAsset", IERC20(borrowedAsset_).balanceOf(address(this)));
    console.log("makeRepayBorrow.balance.after repay.collateralAsset", IERC20(collateralAsset_).balanceOf(address(this)));

    console.log("makeRepayRepay - repay 2", amountToPay);
    IERC20(borrowedAsset_).safeTransfer(address(_tc()), amountToPay);
    (collateralAmountOut, returnedBorrowAmountOut,,) = _tc().repay(collateralAsset_, borrowedAsset_, amountToPay, receiver_);

    v.borrowBalanceAfterRepay = IERC20(borrowedAsset_).balanceOf(address(this));
    console.log("makeRepayBorrow.balance.after repay2.borrowAsset", IERC20(borrowedAsset_).balanceOf(address(this)));
    console.log("makeRepayBorrow.balance.after repay2.collateralAsset", IERC20(collateralAsset_).balanceOf(address(this)));

    return (collateralAmountOut + v.collateralAmountOut, returnedBorrowAmountOut + v.returnedBorrowAmountOut);
  }

  /// @notice Make repay, then borrow same amount to be sure that repay-borrow are allowed in a single block
  function makeRepayBorrow(address collateralAsset_, address borrowedAsset_, address receiver_, uint amount) external returns (
    uint collateralAmountOut,
    uint borrowAmountOut
  ) {
    // we assume here, that there is 1 opened borrow position
    address[] memory activePositions = _tc().getPositions(address(this), collateralAsset_, borrowedAsset_);
    console.log("makeRepayBorrow.activePositions.count", activePositions.length);
    console.log("makeRepayBorrow.activePositions.converter", activePositions[0]);

    (address converter,,,) = IPoolAdapter(activePositions[0]).getConfig();

    console.log("makeRepayBorrow.balance.0.borrowAsset", IERC20(borrowedAsset_).balanceOf(address(this)));
    console.log("makeRepayBorrow.balance.0.collateralAsset", IERC20(collateralAsset_).balanceOf(address(this)));

    // repay the {amount}
    console.log("makeRepayRepay repay, amount=", amount);
    IERC20(borrowedAsset_).safeTransfer(address(_tc()), amount);
    (collateralAmountOut,,,) = _tc().repay(collateralAsset_, borrowedAsset_, amount, receiver_);

    console.log("makeRepayBorrow.balance.after repay.borrowAsset", IERC20(borrowedAsset_).balanceOf(address(this)));
    console.log("makeRepayBorrow.balance.after repay.collateralAsset", IERC20(collateralAsset_).balanceOf(address(this)));

    // borrow the {amount} back
    IERC20(collateralAsset_).safeApprove(_controller.tetuConverter(), collateralAmountOut);
    borrowAmountOut = _tc().borrow(converter, collateralAsset_, collateralAmountOut, borrowedAsset_, amount, address(this));

    console.log("makeRepayBorrow.balance.after borrow.borrowAsset", IERC20(borrowedAsset_).balanceOf(address(this)));
    console.log("makeRepayBorrow.balance.after borrow.collateralAsset", IERC20(collateralAsset_).balanceOf(address(this)));

    return (collateralAmountOut, borrowAmountOut);
  }

  /// @notice Borrow {amount}, then repay the same amount to be sure that borrow-repay are allowed in a single block
  function makeBorrowRepay(address collateralAsset_, address borrowedAsset_, address receiver_, uint sourceAmount_) external returns (
    uint collateralAmount,
    uint amountToBorrow
  ) {
    address converter;
    (converter, collateralAmount, amountToBorrow,) = _tc().findConversionStrategy("", collateralAsset_, sourceAmount_, borrowedAsset_, 1);

    console.log("makeRepayBorrow.balance.0.borrowAsset", IERC20(borrowedAsset_).balanceOf(address(this)));
    console.log("makeRepayBorrow.balance.0.collateralAsset", IERC20(collateralAsset_).balanceOf(address(this)));

    // borrow
    IERC20(collateralAsset_).safeApprove(_controller.tetuConverter(), collateralAmount);
    _tc().borrow(converter, collateralAsset_, collateralAmount / 2, borrowedAsset_, amountToBorrow / 2, address(this));
    _tc().borrow(converter, collateralAsset_, collateralAmount / 2, borrowedAsset_, amountToBorrow / 2, address(this));

    console.log("makeRepayBorrow.balance.after borrow.borrowAsset", IERC20(borrowedAsset_).balanceOf(address(this)));
    console.log("makeRepayBorrow.balance.after borrow.collateralAsset", IERC20(collateralAsset_).balanceOf(address(this)));

    // repay the {amountToBorrow} back
    IERC20(borrowedAsset_).safeTransfer(address(_tc()), amountToBorrow);
    _tc().repay(collateralAsset_, borrowedAsset_, amountToBorrow / 2, receiver_);
    console.log("makeRepayBorrow.balance.after repay.borrowAsset", IERC20(borrowedAsset_).balanceOf(address(this)));
    console.log("makeRepayBorrow.balance.after repay.collateralAsset", IERC20(collateralAsset_).balanceOf(address(this)));

    return (collateralAmount, amountToBorrow);
  }
  
  //endregion--------------------------------------------- Two actions per single block

  //region--------------------------------------------- IBorrower impl

  /// @notice Set up behavior of requireAmountBack()
  ///         There are two different implementations:
  ///         1) Not-NSR strategy. It prepares amount and sends it to the converter in the single call.
  ///         2) NSR strategy. It requires ONE or TWO calls from the converter to get {amount_}.
  ///         1. The {amount_} exists on the balance: send the amount to TetuConverter, return {amount_}
  ///         2. The {amount_} doesn't exist on the balance. Try to receive the {amount_}.
  ///         2.1. if the required amount is received: return {amount_}
  ///         2.2. if less amount X (X < {amount_}) is received return X - gap
  /// @param poolAdapterAddress_ Address of the pool adapter that requires health factor rebalancing.
  ///                            We need it together with amountToSendToPoolAdapterAtFirstCall_
  ///                            to emulate special case, see comment to {amountToSendToPoolAdapterAtFirstCall_}
  /// @param amountToSendToPoolAdapterAtFirstCall_ Allow to imitate the situation when borrower receives
  ///        request to prepare given amount to rebalance health factor of the pool adapter and this
  ///        preparing changes health factor so required amount becomes zero or different.
  function setUpRequireAmountBack(
    uint amountToReturn1_,
    uint amountToTransfer1_,
    uint amountToReturn2_,
    uint amountToTransfer2_,
    address poolAdapterAddress_,
    uint amountToSendToPoolAdapterAtFirstCall_,
    address amountProvider_,
    bool closeTheDebtAtFistCall_
  ) external {
    requireAmountBackParams = RequireAmountBackParams({
      amountToReturn1: amountToReturn1_,
      amountToReturn2: amountToReturn2_,
      amountToTransfer1: amountToTransfer1_,
      amountToTransfer2: amountToTransfer2_,

      countCalls: 0,
      amountPassedToRequireRepayAtFirstCall: 0,
      amountPassedToRequireRepayAtSecondCall: 0,

      poolAdapterAddress: poolAdapterAddress_,
      amountToSendToPoolAdapterAtFirstCall: amountToSendToPoolAdapterAtFirstCall_,
      amountProvider: amountProvider_,
      closeTheDebtAtFistCall: closeTheDebtAtFistCall_
    });
  }

  function requirePayAmountBack(address asset_, uint amount_) external override returns (uint amountOut) {
    RequireAmountBackParams storage p = requireAmountBackParams;
    console.log("Borrower.requirePayAmountBack.asset_, amount_, countCall", asset_, amount_, p.countCalls);

    uint countCalls = p.countCalls;
    p.countCalls = countCalls + 1;

    uint balance = IERC20(asset_).balanceOf(address(this));
    if (countCalls == 0) {
      p.amountPassedToRequireRepayAtFirstCall = amount_;
      uint amountToReturn = p.amountToReturn1 == type(uint).max ? amount_ : p.amountToReturn1;
      uint amountToTransfer = p.amountToTransfer1 == type(uint).max ? amount_ : p.amountToTransfer1;
      console.log("Borrower.requirePayAmountBack.amountToReturn", amountToReturn);
      console.log("Borrower.requirePayAmountBack.amountToTransfer", amountToTransfer);

      // this is the first call of requirePayAmountBack
      require(amountToReturn <= amount_, "setUpRequireAmountBack:1");
      require(amountToTransfer <= balance, "setUpRequireAmountBack:2");

      console.log("Borrower.asset.balance.0", IERC20(asset_).balanceOf(address(this)));
      IERC20(asset_).transfer(address(_tc()), amountToTransfer);

      console.log("Borrower.asset.balance.1", IERC20(asset_).balanceOf(address(this)));
      if (p.poolAdapterAddress != address(0)) {
        if (p.amountToSendToPoolAdapterAtFirstCall != 0) {
          console.log("Borrower.requirePayAmountBack.p.poolAdapterAddress, amountToSendToPoolAdapterAtFirstCall", p.poolAdapterAddress, p.amountToSendToPoolAdapterAtFirstCall);
          balance = IERC20(asset_).balanceOf(address(this));
          require(p.amountToSendToPoolAdapterAtFirstCall <= balance, "setUpRequireAmountBack:5");
          console.log("Borrower.requirePayAmountBack.balance", balance);
          console.log("Borrower.requirePayAmountBack.transfer.from.amountProvider", p.amountToSendToPoolAdapterAtFirstCall);
          IERC20(asset_).transferFrom(p.amountProvider, address(this), p.amountToSendToPoolAdapterAtFirstCall);
          console.log("Borrower.asset.balance.2", IERC20(asset_).balanceOf(address(this)));

          IERC20(asset_).approve(p.poolAdapterAddress, p.amountToSendToPoolAdapterAtFirstCall);
          (,, address collateralAsset,) = PoolAdapterMock(p.poolAdapterAddress).getConfig();
          if (collateralAsset == asset_) {
            // in real adapter repayToRebalance won't be called
            // only real repay() can be called
            // we use repayToRebalance to imitate situation when amount-required-for-rebalancing is changed
            console.log("Borrower.requirePayAmountBack.repayToRebalance", p.amountToSendToPoolAdapterAtFirstCall);
            PoolAdapterMock(p.poolAdapterAddress).repayToRebalance(p.amountToSendToPoolAdapterAtFirstCall, true);
            console.log("Borrower.asset.balance.3", IERC20(asset_).balanceOf(address(this)));
          } else {
            // in real adapter the collateral will be received by the Borrower
            // we receive the collateral on separate address for test purposes only
            console.log("Borrower.requirePayAmountBack.repay", p.amountToSendToPoolAdapterAtFirstCall);
            PoolAdapterMock(p.poolAdapterAddress).repay(p.amountToSendToPoolAdapterAtFirstCall, p.amountProvider, false);
            console.log("Borrower.asset.balance.4", IERC20(asset_).balanceOf(address(this)));
          }
          console.log("Borrower.requirePayAmountBack, status:");
          PoolAdapterMock(p.poolAdapterAddress).getStatus(); // display status
        }

        if (p.closeTheDebtAtFistCall) {
          console.log("requirePayAmountBack.p.poolAdapterAddress, closeTheDebtAtFistCall", p.poolAdapterAddress, p.closeTheDebtAtFistCall);
          PoolAdapterMock(p.poolAdapterAddress).resetTheDebtForcibly();
          console.log("Borrower.asset.balance.5", IERC20(asset_).balanceOf(address(this)));
        }
      }

      console.log("Borrower.requirePayAmountBack.return", amountToReturn);
      return amountToReturn;
    } else {
      console.log("Borrower.asset.balance.6", IERC20(asset_).balanceOf(address(this)));
      p.amountPassedToRequireRepayAtSecondCall = amount_;

      uint amountToReturn = p.amountToReturn2 == type(uint).max ? amount_ : p.amountToReturn2;
      uint amountToTransfer = p.amountToTransfer2 == type(uint).max ? amount_ : p.amountToTransfer2;

      // this is the second call of requirePayAmountBack
      require(amountToReturn <= amount_, "setUpRequireAmountBack:3");
      require(amountToTransfer <= balance, "setUpRequireAmountBack:4");

      console.log("Borrower.requirePayAmountBack.amountToTransfer", amountToTransfer);
      IERC20(asset_).transfer(address(_tc()), amountToTransfer);
      console.log("Borrower.requirePayAmountBack.amountToReturn", amountToReturn);
      console.log("Borrower.asset.balance.7", IERC20(asset_).balanceOf(address(this)));

      return amountToReturn;
    }
  }

  function onTransferAmounts(address[] memory assets_, uint[] memory amounts_) external override {
    onTransferAmountsLength = assets_.length;
    onTransferAmountsAssets = assets_;
    onTransferAmountsAmounts = amounts_;
  }
  function getOnTransferAmountsResults() external view returns (address[] memory assets, uint[] memory amounts) {
    return (onTransferAmountsAssets, onTransferAmountsAmounts);
  }
  //endregion--------------------------------------------- IBorrower impl

  //region--------------------------------------------- View and util functions
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

  function _tc() internal view returns (ITetuConverter) {
    return ITetuConverter(_controller.tetuConverter());
  }
  function _debtMonitor() internal view returns (IDebtMonitor) {
    return IDebtMonitor(_controller.debtMonitor());
  }
  //endregion--------------------------------------------- View and util functions
}
