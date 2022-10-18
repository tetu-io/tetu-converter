// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/ITetuConverter.sol";
import "../integrations/market/ICErc20.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/ISwapManager.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/IERC20.sol";
import "../interfaces/IPlatformAdapter.sol";
import "./AppDataTypes.sol";
import "./AppErrors.sol";
import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IController.sol";
import "../interfaces/IDebtsMonitor.sol";
import "../interfaces/IConverter.sol";
import "../interfaces/ISwapConverter.sol";
import "../interfaces/IKeeperCallback.sol";
import "../interfaces/ITetuConverterCallback.sol";
import "./AppUtils.sol";
import "hardhat/console.sol";

/// @notice Main application contract
contract TetuConverter is ITetuConverter, IKeeperCallback {
  using SafeERC20 for IERC20;
  using AppUtils for uint;

  /// @notice After additional borrow result health factor should be near to target value, the difference is limited.
  uint constant public ADDITIONAL_BORROW_DELTA_DENOMINATOR = 10;

  ///////////////////////////////////////////////////////
  ///                Members
  ///////////////////////////////////////////////////////

  IController public immutable controller;

  ///////////////////////////////////////////////////////
  ///                Initialization
  ///////////////////////////////////////////////////////

  constructor(address controller_) {
    require(controller_ != address(0), AppErrors.ZERO_ADDRESS);

    controller = IController(controller_);
  }

  ///////////////////////////////////////////////////////
  ///                Access control
  ///////////////////////////////////////////////////////
  function onlyKeeper() internal view {
    //TODO
  }

  ///////////////////////////////////////////////////////
  ///       Find best strategy for conversion
  ///////////////////////////////////////////////////////

  function findConversionStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint periodInBlocks_,
    ConversionMode conversionMode
  ) external view override returns (
    address converter,
    uint maxTargetAmount,
    int aprForPeriod36
  ) {
    return _findConversionStrategy(sourceToken_,
      sourceAmount_,
      targetToken_,
      periodInBlocks_,
      conversionMode
    );
  }

  /// @param periodInBlocks_ how long you want hold targetToken. When 0 - always borrows, when uint.max - always swaps
  function _findConversionStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint periodInBlocks_,
    ConversionMode conversionMode
  ) internal view returns (
    address converter,
    uint maxTargetAmount,
    int aprForPeriod36
  ) {
    AppDataTypes.InputConversionParams memory params = AppDataTypes.InputConversionParams({
      sourceToken: sourceToken_,
      targetToken: targetToken_,
      sourceAmount: sourceAmount_,
      periodInBlocks: periodInBlocks_
    });

    if (conversionMode == ITetuConverter.ConversionMode.SWAP_1) {
      // get swap
      return _swapManager().getConverter(params);
    } else if (conversionMode == ITetuConverter.ConversionMode.BORROW_2) {
      // find best lending platform
      return _borrowManager().findConverter(params);
    } else {
      // TODO develop decision making function, that can be tested separately
      // use healthFactor2_, calculate cost of swap (forward and back)
      // for now just use borrow manager for dv tests compatibility
      return _borrowManager().findConverter(params);
    }

  }

  ///////////////////////////////////////////////////////
  ///       Make conversion, open position
  ///////////////////////////////////////////////////////

  function borrow(
    address converter_,
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint amountToBorrow_,
    address receiver_
) external override returns (
    uint borrowedAmountOut
  ) {
    return _convert(
      converter_,
      collateralAsset_,
      collateralAmount_,
      borrowAsset_,
      amountToBorrow_,
      receiver_,
      msg.sender
    );
  }

  function _convert(
    address converter_,
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint amountToBorrow_,
    address receiver_,
    address collateralProvider_
  ) internal returns (
    uint borrowedAmountOut
  ) {
    if (IConverter(converter_).getConversionKind() == AppDataTypes.ConversionKind.BORROW_2) {
      // make borrow

      // get exist or register new pool adapter
      address poolAdapter = _borrowManager().getPoolAdapter(converter_, msg.sender, collateralAsset_, borrowAsset_);
      if (poolAdapter == address(0)) {
        poolAdapter = _borrowManager().registerPoolAdapter(
          converter_,
          msg.sender,
          collateralAsset_,
          borrowAsset_
        );
      }
      require(poolAdapter != address(0), AppErrors.POOL_ADAPTER_NOT_FOUND);
      console.log("Sender", msg.sender);
      console.log("Pool adapter", poolAdapter);

      // transfer the collateral from the borrower directly to the pool adapter; assume, that the transfer is approved
      IPoolAdapter(poolAdapter).syncBalance(true);
      if (collateralProvider_ == address(this)) {
        IERC20(collateralAsset_).transfer(poolAdapter, collateralAmount_);
      } else {
        IERC20(collateralAsset_).transferFrom(collateralProvider_, poolAdapter, collateralAmount_);
      }
      // borrow target-amount and transfer borrowed amount to the receiver
      return IPoolAdapter(poolAdapter).borrow(collateralAmount_, amountToBorrow_, receiver_);

    } else if (IConverter(converter_).getConversionKind() == AppDataTypes.ConversionKind.SWAP_1) {
      IERC20(collateralAsset_).transfer(converter_, collateralAmount_);
      // TODO move to fn params
      // Bogdoslav: I guess better do that after merge -
      // because _convert function params could be changed
      // and tests should be fixed
      ISwapConverter(converter_).swap(
        collateralAsset_,
        collateralAmount_,
        borrowAsset_,
        amountToBorrow_,
        receiver_
      );
      return 0; //TODO bogdoslav: return amount transferred to the borrower
    } else {
      revert(AppErrors.UNSUPPORTED_CONVERSION_KIND);
    }
  }

  ///////////////////////////////////////////////////////
  ///       Make repay, close position
  ///////////////////////////////////////////////////////

  function repay(
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_,
    address collateralReceiver_
  ) external override returns (
    uint collateralAmountOut
  ) {
    console.log("repay");
    require(collateralReceiver_ != address(0), AppErrors.ZERO_ADDRESS);

    // repay don't make any rebalancing here

    // we need to repay exact amount using any pool adapters
    // simplest strategy: use first available pool adapter
    address[] memory poolAdapters = _debtMonitor().getPositions(
      msg.sender,
      collateralAsset_,
      borrowAsset_
    );
    uint lenPoolAdapters = poolAdapters.length;

    uint amountToPay = amountToRepay_;
    for (uint i = 0; i < lenPoolAdapters; i = i.uncheckedInc()) {
      if (amountToPay == 0) {
        break;
      }
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      (,uint totalDebtForPoolAdapter,,) = pa.getStatus();
      uint amountToPayToPoolAdapter = amountToPay >= totalDebtForPoolAdapter
        ? totalDebtForPoolAdapter
        : amountToPay;

      // send amount to pool adapter
      pa.syncBalance(false);
      require(
        IERC20(borrowAsset_).balanceOf(address(this)) >= amountToPayToPoolAdapter,
          AppErrors.WRONG_BORROWED_BALANCE
      );
      IERC20(borrowAsset_).transfer(address(pa), amountToPayToPoolAdapter);

      // make repayment
      collateralAmountOut += pa.repay(
        amountToPayToPoolAdapter,
        collateralReceiver_,
        amountToPayToPoolAdapter == totalDebtForPoolAdapter // close position
      );
      amountToPay -= amountToPayToPoolAdapter;
    }
    require(amountToPay == 0, AppErrors.TRY_TO_REPAY_TOO_MUCH);

    return collateralAmountOut;
  }

  ///////////////////////////////////////////////////////
  ///       ITetuConverterCallback
  ///////////////////////////////////////////////////////

  function requireRepay(
    uint amountToRepay_,
    address poolAdapter_
  ) external override {
    onlyKeeper();

    IPoolAdapter pa = IPoolAdapter(poolAdapter_);
    (,address user, address collateralAsset, address borrowAsset) = pa.getConfig();

    //!TODO: we have exactly same checking inside pool adapters... we need to check this condition only once
    (,uint amountToPay,,) = pa.getStatus();
    require(amountToPay > 0 && amountToRepay_ < amountToPay, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

    // ask the borrower to send us required part of the borrowed amount
    uint balanceBorrowedAsset = IERC20(borrowAsset).balanceOf(address(this));
    ITetuConverterCallback(user).requireBorrowedAmountBack(collateralAsset, borrowAsset, amountToRepay_);
    require(
      IERC20(borrowAsset).balanceOf(address(this)) - balanceBorrowedAsset == amountToRepay_,
      AppErrors.WRONG_AMOUNT_RECEIVED
    );

    // re-send amount-to-repay to the pool adapter and make rebalancing
    pa.syncBalance(false);
    IERC20(borrowAsset).transfer(poolAdapter_, amountToRepay_);
    uint resultHealthFactor18 = pa.repayToRebalance(amountToRepay_);

    // ensure that the health factor was restored to ~target health factor value
    _ensureApproxSameToTargetHealthFactor(borrowAsset, resultHealthFactor18);
  }

  function requireAdditionalBorrow(
    uint amountToBorrow_,
    address poolAdapter_
  ) external override {
    onlyKeeper();

    IPoolAdapter pa = IPoolAdapter(poolAdapter_);

    (, address user, address collateralAsset, address borrowAsset) = pa.getConfig();

    // make rebalancing
    (uint resultHealthFactor18, uint borrowedAmountOut) = pa.borrowToRebalance(amountToBorrow_, user);
    _ensureApproxSameToTargetHealthFactor(borrowAsset, resultHealthFactor18);

    // notify the borrower about new available borrowed amount
    ITetuConverterCallback(user).onTransferBorrowedAmount(collateralAsset, borrowAsset, borrowedAmountOut);
  }

  function requireReconversion(
    address poolAdapter_
  ) external override {
    onlyKeeper();

    //TODO
    poolAdapter_;
  }

  function _ensureApproxSameToTargetHealthFactor(
    address borrowAsset_,
    uint resultHealthFactor18_
  ) internal view {
    // after rebalancing we should have health factor ALMOST equal to the target health factor
    // but the equality is not exact
    // let's allow small difference < 1/10 * (target health factor - min health factor)
    uint targetHealthFactor18 = uint(_borrowManager().getTargetHealthFactor2(borrowAsset_)) * 10**(18-2);
    uint minHealthFactor18 = uint(controller.minHealthFactor2()) * 10**(18-2);
    uint delta = (targetHealthFactor18 - minHealthFactor18) / ADDITIONAL_BORROW_DELTA_DENOMINATOR;
    require(
      resultHealthFactor18_ + delta > targetHealthFactor18
      && resultHealthFactor18_ - delta < targetHealthFactor18,
      AppErrors.WRONG_REBALANCING
    );
  }
  ///////////////////////////////////////////////////////
  ///       Get debt/repay info
  ///////////////////////////////////////////////////////

  /// @notice Calculate total amount of borrow tokens that should be repaid to close the loan completely.
  function getDebtAmount(
    address collateralAsset_,
    address borrowAsset_
  ) external view override returns (uint outTotalDebtBorrowAsset) {
    address[] memory poolAdapters = _debtMonitor().getPositions(
      msg.sender,
      collateralAsset_,
      borrowAsset_
    );
    uint lenPoolAdapters = poolAdapters.length;
    console.log("getDebtAmount", lenPoolAdapters);

    for (uint i = 0; i < lenPoolAdapters; i = i.uncheckedInc()) {
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      (,uint totalDebtForPoolAdapter,,) = pa.getStatus();
      outTotalDebtBorrowAsset += totalDebtForPoolAdapter;
    }

    return outTotalDebtBorrowAsset;
  }

  /// @notice User needs to redeem some collateral amount. Calculate an amount that should be repaid
  function estimateRepay(
    address collateralAsset_,
    uint collateralAmountToRedeem_,
    address borrowAsset_
  ) external view override returns (
    uint borrowAssetAmount
  ) {
    // TODO
    collateralAsset_;
    collateralAmountToRedeem_;
    borrowAsset_;
    return 0;
  }

  ///////////////////////////////////////////////////////
  ///       Check and claim rewards
  ///////////////////////////////////////////////////////

  function claimRewards(address receiver_) external override returns (
    address[] memory rewardTokens,
    uint[] memory amounts
  ) {
    // TODO
    return (rewardTokens, amounts);
  }

  ///////////////////////////////////////////////////////
  ///  Additional functions, not required by strategies
  ///////////////////////////////////////////////////////

  function reconvert(
    address poolAdapter_,
    uint periodInBlocks_,
    address receiver_
  ) external override {
    // we assume, that the caller has already transferred borrowed amount back to the pool adapter

    // prepare to repay
    IPoolAdapter pa = IPoolAdapter(poolAdapter_);
    (address originConverter, address user, address collateralAsset, address borrowAsset) = pa.getConfig();
    require(user == msg.sender, AppErrors.USER_ONLY);

    (, uint amountToPay,,) = pa.getStatus();

    // temporary store current balance of the collateral - we need to know balance delta after and before repay
    uint deltaCollateral = IERC20(collateralAsset).balanceOf(address(this));

    // repay
    pa.repay(amountToPay, address(this), true);
    deltaCollateral = IERC20(collateralAsset).balanceOf(address(this)) - deltaCollateral;

    // find new plan
    (address converter, uint maxTargetAmount,) = _findConversionStrategy(
      collateralAsset,
      deltaCollateral,
      borrowAsset,
      periodInBlocks_,
      ITetuConverter.ConversionMode.AUTO_0
    );
    require(converter != originConverter, AppErrors.RECONVERSION_WITH_SAME_CONVERTER_FORBIDDEN);

    // make conversion using new pool adapter, transfer borrowed amount {receiver_}
    _convert(
      converter,
      collateralAsset,
      deltaCollateral,
      borrowAsset,
      maxTargetAmount,
      receiver_,
      address(this)
    );
  }

  function findBorrows (
    address collateralToken_,
    address borrowedToken_
  ) external view override returns (
    address[] memory poolAdapters
  ) {
    return _debtMonitor().getPositions(msg.sender, collateralToken_, borrowedToken_);
  }

  ///////////////////////////////////////////////////////
  ///       Inline functions
  ///////////////////////////////////////////////////////
  function _borrowManager() internal view returns (IBorrowManager) {
    return IBorrowManager(controller.borrowManager());
  }

  function _debtMonitor() internal view returns (IDebtMonitor) {
    return IDebtMonitor(controller.debtMonitor());
  }

  function _swapManager() internal view returns (ISwapManager) {
    return ISwapManager(controller.swapManager());
  }
}
