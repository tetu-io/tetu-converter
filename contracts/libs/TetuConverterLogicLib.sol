// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "./AppErrors.sol";
import "./AppUtils.sol";
import "./SwapLib.sol";
import "./ConverterLogicLib.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/IERC20Metadata.sol";
import "../openzeppelin/Math.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IDebtMonitor.sol";
import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IConverterController.sol";
import "../interfaces/IPriceOracle.sol";
import "../interfaces/ITetuConverterCallback.sol";
import "../integrations/tetu/ITetuLiquidator.sol";

/// @notice TetuConverter-contract logic-related functions (The lib is necessary to reduce contract size)
library TetuConverterLogicLib {
  using SafeERC20 for IERC20;

//#region ------------------------------------------------- Constants
  uint constant internal DEBT_GAP_DENOMINATOR = 100_000;
  /// @dev Absolute value of debt-gap-addon for any token
  /// @notice A value of the debt gap, calculate using debt-gap percent, cannot be less than the following
  uint internal constant MIN_DEBT_GAP_ADDON = 10;
//#endregion ------------------------------------------------- Constants

//#region ------------------------------------------------- Data types
  struct RepayTheBorrowParams {
    IPoolAdapter pa;
    uint balanceBefore;
    bool skipRepay;
    address[] assets;
    uint[] amounts;
    address user;
    address collateralAsset;
    address borrowAsset;
  }

  /// @dev We need to combine local params to struct to avoid stack too deep in coverage
  struct RequireRepayParams {
    address user;
    address collateralAsset;
    uint amountToPay;
    bool skipRepay;
    uint amount;
  }

//#endregion ------------------------------------------------- Data types

//#region ------------------------------------------------- Events
  event OnRequireRepayCloseLiquidatedPosition(address poolAdapter, uint statusAmountToPay);
  event OnRequireRepayRebalancing(address poolAdapter, uint amount, bool isCollateral, uint statusAmountToPay, uint healthFactorAfterRepay18);
  event OnSafeLiquidate(address sourceToken, uint sourceAmount, address targetToken, address receiver, uint outputAmount);
  event OnRepayTheBorrow(address poolAdapter, uint collateralOut, uint repaidAmountOut);
  event OnRepayBorrow(address poolAdapter, uint amountToRepay, address receiver, bool closePosition);
//#endregion ------------------------------------------------- Events

//#region ------------------------------------------------- IKeeperCallback
  /// @notice This function is called by a keeper if there is unhealthy borrow
  ///         The called contract should send either collateral-amount or borrowed-amount to TetuConverter
  /// @param requiredBorrowedAmount_ The borrower should return given borrowed amount back to TetuConverter
  ///                                in order to restore health factor to target value
  /// @param requiredCollateralAmount_ The borrower should send given amount of collateral to TetuConverter
  ///                                  in order to restore health factor to target value
  /// @param poolAdapter_ Address of the pool adapter that has problem health factor
  function requireRepay(
    IConverterController controller_,
    uint requiredBorrowedAmount_,
    uint requiredCollateralAmount_,
    address poolAdapter_
  ) external {
    RequireRepayParams memory p;

    IPoolAdapter pa = IPoolAdapter(poolAdapter_);
    (, p.user, p.collateralAsset,) = pa.getConfig();
    pa.updateStatus();
    (, p.amountToPay,,,,) = pa.getStatus();

    if (requiredCollateralAmount_ == 0) {
      // Full liquidation happens, we have lost all collateral amount
      // We need to close the position as is and drop away the pool adapter without paying any debt
      IDebtMonitor(IConverterController(controller_).debtMonitor()).closeLiquidatedPosition(address(pa));
      emit OnRequireRepayCloseLiquidatedPosition(address(pa), p.amountToPay);
    } else {
      // rebalancing
      // we assume here, that requiredBorrowedAmount_ should be less than amountToPay even if it includes the debt-gap
      require(p.amountToPay != 0 && requiredBorrowedAmount_ < p.amountToPay, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

      // for definiteness ask the user to send us collateral asset
      (p.skipRepay, p.amount) = _requirePayAmountBackToRebalance(
        ITetuConverterCallback(p.user),
        pa,
        p.collateralAsset,
        requiredCollateralAmount_,
        IBorrowManager(controller_.borrowManager()),
        uint(controller_.minHealthFactor2()) * 10 ** (18 - 2)
      );

      if (! p.skipRepay) {
        uint resultHealthFactor18 = pa.repayToRebalance(p.amount, true);
        emit OnRequireRepayRebalancing(address(pa), p.amount, true, p.amountToPay, resultHealthFactor18);
      }
    }
  }

  /// @notice Ask user (a strategy) to transfer {amount_} of {asset_} on the converter balance to restore health status of {pa}
  /// @dev Call user_.requirePayAmountBack one or two times
  /// @param user_ The strategy - owner of the {pa_}
  /// @param pa_ Pool adapter with the debt that should be rebalanced
  /// @param asset_ Collateral asset of pa
  /// @param amount_ Amount required by {pa_} to rebalance the debt
  /// @return skipRepay Repay is not required anymore because the borrow was closed
  ///                   (or its health factor was restored to healthy value)
  ///                   during receiving requested amount on the user's side
  /// @return amountToPay What amount of collateral was received from the user
  function _requirePayAmountBackToRebalance(
    ITetuConverterCallback user_,
    IPoolAdapter pa_,
    address asset_,
    uint amount_,
    IBorrowManager borrowManager_,
    uint healthFactorThreshold18
  ) internal returns (
    bool skipRepay,
    uint amountToPay
  ) {
    (uint amountReturnedByUser, uint amountReceivedOnBalance) = _callRequirePayAmountBack(user_, asset_, amount_);

    // The results of calling requirePayAmountBack depend on whether the required amount is on the user's balance:
    // 1. The {amount_} exists on the balance
    //    User sends the amount to TetuConverter, returns {amount_}
    // 2. The {amount_} doesn't exist on the balance.
    //    User tries to receive {amount_} and sends {amount_*} (it's probably less than original {amount_}
    //    that converter can claims by next call of requirePayAmountBack
    if (amountReceivedOnBalance == 0) {
      // case 2: the {amount_} didn't exist on balance. We should claim amountReturnedByUser by second call

      // strategy cas received some amount on balance
      // it means that it probably has closed some debts
      // there is a chance that {pa_} doesn't require rebalancing anymore or require less amount
      // check what amount is required by {pa_} now
      (, uint requiredCollateralToPay) = ConverterLogicLib.checkPositionHealth(pa_, borrowManager_, healthFactorThreshold18);

      if (requiredCollateralToPay == 0) {
        skipRepay = true;
      } else {
        require(amountReturnedByUser != 0, AppErrors.ZERO_AMOUNT); // user has any assets to send to converter
        (amountReturnedByUser, amountReceivedOnBalance) = _callRequirePayAmountBack(
          user_,
          asset_,
          Math.min(amountReturnedByUser, requiredCollateralToPay)
        );
      }
    }

    // ensure that we have received any amount .. and use it for repayment
    // probably we've received less then expected - it's ok, just let's use as much as possible
    // DebtMonitor will ask to make rebalancing once more if necessary
    require(
      (skipRepay || amountReceivedOnBalance != 0) // user didn't send promised assets
      && (amountReceivedOnBalance <= amount_), // we can receive less amount (partial rebalancing)
      AppErrors.WRONG_AMOUNT_RECEIVED
    );

    return (skipRepay, amountReceivedOnBalance);
  }

  function _callRequirePayAmountBack(ITetuConverterCallback user_, address asset_, uint amount_) internal returns (
    uint amountReturnedByUser,
    uint amountReceivedOnBalance
  ) {
    uint balanceBefore = IERC20(asset_).balanceOf(address(this));
    amountReturnedByUser = user_.requirePayAmountBack(asset_, amount_);
    uint balanceAfter = IERC20(asset_).balanceOf(address(this));

    require(balanceAfter >= balanceBefore, AppErrors.WEIRD_OVERFLOW);
    amountReceivedOnBalance = balanceAfter - balanceBefore;
  }
//#endregion ------------------------------------------------- IKeeperCallback

//#region ------------------------------------------------- repayTheBorrow

  /// @notice Close given borrow and return collateral back to the user, governance only
  /// @dev The pool adapter asks required amount-to-repay from the user internally
  /// @param poolAdapter_ The pool adapter that represents the borrow
  /// @param closePosition Close position after repay
  ///        Usually it should be true, because the function always tries to repay all debt
  ///        false can be used if user doesn't have enough amount to pay full debt
  ///              and we are trying to pay "as much as possible"
  /// @return collateralAmountOut Amount of collateral returned to the user
  /// @return repaidAmountOut Amount of borrow asset paid to the lending platform
  function repayTheBorrow(
    IConverterController controller_,
    address poolAdapter_,
    bool closePosition
  ) external returns (
    uint collateralAmountOut,
    uint repaidAmountOut
  ) {
    RepayTheBorrowParams memory v;

    // update internal debts and get actual amount to repay
    v.pa = IPoolAdapter(poolAdapter_);
    (,v.user, v.collateralAsset, v.borrowAsset) = v.pa.getConfig();
    v.pa.updateStatus();

    // add debt gap if necessary
    {
      bool debtGapRequired;
      (collateralAmountOut, repaidAmountOut,,,, debtGapRequired) = v.pa.getStatus();
      if (debtGapRequired) {
        repaidAmountOut = getAmountWithDebtGap(repaidAmountOut, controller_.debtGap());
      }
    }
    require(collateralAmountOut != 0 && repaidAmountOut != 0, AppErrors.REPAY_FAILED);

    // ask the user for the amount-to-repay; use exist balance for safety, normally it should be 0
    v.balanceBefore = IERC20(v.borrowAsset).balanceOf(address(this));

    // for definiteness ask the user to send us collateral asset
    (v.skipRepay, repaidAmountOut) = _requirePayAmountBackToClosePosition(
      ITetuConverterCallback(v.user),
      v.pa,
      v.borrowAsset,
      repaidAmountOut - v.balanceBefore,
      controller_.debtGap()
    );

    if (! v.skipRepay) {
      uint balanceAfter = IERC20(v.borrowAsset).balanceOf(address(this));

      // ensure that we have received required amount fully or partially
      if (closePosition) {
        require(balanceAfter >= v.balanceBefore + repaidAmountOut, AppErrors.WRONG_AMOUNT_RECEIVED);
      } else {
        require(balanceAfter > v.balanceBefore, AppErrors.ZERO_BALANCE);
        repaidAmountOut = balanceAfter - v.balanceBefore;
      }

      // make full repay and close the position
      v.balanceBefore = IERC20(v.borrowAsset).balanceOf(v.user);
      collateralAmountOut = v.pa.repay(repaidAmountOut, v.user, closePosition);
      emit OnRepayTheBorrow(poolAdapter_, collateralAmountOut, repaidAmountOut);
      balanceAfter = IERC20(v.borrowAsset).balanceOf(v.user);

      v.assets = new address[](2);
      v.assets[0] = v.borrowAsset;
      v.assets[1] = v.collateralAsset;

      v.amounts = new uint[](2);
      // repay is able to return small amount of borrow-asset back to the user, we should pass it to onTransferAmounts
      v.amounts[0] = balanceAfter > v.balanceBefore ? balanceAfter - v.balanceBefore : 0;
      if (v.amounts[0] > 0) { // exclude returned part of the debt gap from repaidAmountOut
        repaidAmountOut = repaidAmountOut > v.amounts[0]
          ? repaidAmountOut - v.amounts[0]
          : 0;
      }
      v.amounts[1] = collateralAmountOut;
      ITetuConverterCallback(v.user).onTransferAmounts(v.assets, v.amounts);

      return (collateralAmountOut, repaidAmountOut);
    } else {
      return (0, 0);
    }
  }

  /// @notice Ask user (a strategy) to transfer {amount_} of {asset_} on converter balance
  ///         to be able to close the position
  /// @dev Call user_.requirePayAmountBack one or two times
  /// @param user_ The strategy - owner of the {pa_}
  /// @param pa_ Pool adapter which debt should be closed
  /// @param asset_ Borrowed asset of the {pa}
  /// @param amount_ Amount required by {pa_} to rebalance the debt
  /// @return skipRepay Repay is not required anymore because the borrow was completely closed
  ///                   during receiving requested amount on the user's side
  ///                   or because it was liquidated (collateral amount is zero)
  /// @return amountToPay What amount of borrow asset was received from the user
  function _requirePayAmountBackToClosePosition(
    ITetuConverterCallback user_,
    IPoolAdapter pa_,
    address asset_,
    uint amount_,
    uint debtGap
  ) internal returns (
    bool skipRepay,
    uint amountToPay
  ) {
    (uint amountReturnedByUser, uint amountReceivedOnBalance) = _callRequirePayAmountBack(user_, asset_, amount_);

    // The results of calling requirePayAmountBack depend on whether the required amount is on the user's balance:
    // 1. The {amount_} exists on the balance
    //    User sends the amount to TetuConverter, returns {amount_}
    // 2. The {amount_} doesn't exist on the balance.
    //    User tries to receive {amount_} and sends {amount_*} (it's probably less than original {amount_}
    //    that converter can claims by next call of requirePayAmountBack
    if (amountReceivedOnBalance == 0) {
      // case 2: the {amount_} didn't exist on balance. We should claim amountReturnedByUser by second call

      // strategy cas received some amount on balance
      // it means that it probably has closed some debts
      // there is a chance that {pa_} doesn't require rebalancing anymore or require less amount
      // check what amount is required by {pa_} now
      (uint collateralAmount, uint debtAmount,,,, bool debtGapRequired) = pa_.getStatus();
      if (debtGapRequired) {
        debtAmount = getAmountWithDebtGap(debtAmount, debtGap);
      }

      if (collateralAmount == 0) {
        skipRepay = true; // debt is closed or liquidated
      } else {
        require(amountReturnedByUser != 0, AppErrors.ZERO_AMOUNT); // user has any assets to send to converter
        (, amountReceivedOnBalance) = _callRequirePayAmountBack(
          user_,
          asset_,
          Math.min(amountReturnedByUser, debtAmount)
        );
      }
    }

    // ensure that we have received any amount .. and use it for repayment
    // probably we've received less then expected - it's ok, just let's use as much as possible
    // DebtMonitor will ask to make rebalancing once more if necessary
    require(
      (skipRepay || amountReceivedOnBalance != 0) // user didn't send promised assets
      && (amountReceivedOnBalance <= amount_), // we can receive less amount (partial rebalancing)
      AppErrors.WRONG_AMOUNT_RECEIVED
    );

    return (skipRepay, amountReceivedOnBalance);
  }
//#endregion ------------------------------------------------- repayTheBorrow

//#region ------------------------------------------------- Safe liquidation
  /// @notice Swap {amountIn_} of {assetIn_} to {assetOut_} and send result amount to {receiver_}
  ///         The swapping is made using TetuLiquidator with checking price impact using embedded price oracle.
  /// @param amountIn_ Amount of {assetIn_} to be swapped.
  ///                      It should be transferred on balance of the TetuConverter before the function call
  /// @param receiver_ Result amount will be sent to this address
  /// @param priceImpactToleranceSource_ Price impact tolerance for liquidate-call, decimals = 100_000
  /// @param priceImpactToleranceTarget_ Price impact tolerance for price-oracle-check, decimals = 100_000
  /// @return amountOut The amount of {assetOut_} that has been sent to the receiver
  function safeLiquidate(
    IConverterController controller_,
    address assetIn_,
    uint amountIn_,
    address assetOut_,
    address receiver_,
    uint priceImpactToleranceSource_,
    uint priceImpactToleranceTarget_
  ) external returns (
    uint amountOut
  ) {
    ITetuLiquidator tetuLiquidator = ITetuLiquidator(controller_.tetuLiquidator());
    uint targetTokenBalanceBefore = IERC20(assetOut_).balanceOf(address(this));

    IERC20(assetIn_).safeApprove(address(tetuLiquidator), amountIn_);
    tetuLiquidator.liquidate(assetIn_, assetOut_, amountIn_, priceImpactToleranceSource_);

    amountOut = IERC20(assetOut_).balanceOf(address(this)) - targetTokenBalanceBefore;
    IERC20(assetOut_).safeTransfer(receiver_, amountOut);

    require(  // The result amount shouldn't be too different from the value calculated directly using price oracle prices
      SwapLib.isConversionValid(IPriceOracle(controller_.priceOracle()), assetIn_, amountIn_, assetOut_, amountOut, priceImpactToleranceTarget_),
      AppErrors.TOO_HIGH_PRICE_IMPACT
    );
    emit OnSafeLiquidate(assetIn_, amountIn_, assetOut_, receiver_, amountOut);
  }
//#endregion ------------------------------------------------- Safe liquidation

//#region ------------------------------------------------- Repay
  /// @notice Repay debts of the given pool adapter
  /// @param totalAmountToRepay Amount of the total debt (all pool adapter) that should be paid
  /// @param poolAdapter Pools adapter whose debts we are going to repay
  /// @param totalDebtForPoolAdapter Total debt of the {poolAdapter} (with debt gap)
  /// @param receiver Receiver of collateral and excess amount-to-repay
  /// @param lastPoolAdapter True if the {poolAdapter} is last one (all remained debts belong to it)
  /// @return remainTotalDebt Total amount of remain debt
  /// @return collateralAmountOut Amount of collateral returned by the pool adapter after debt repaying
  function repay(
    uint totalAmountToRepay,
    IPoolAdapter poolAdapter,
    uint totalDebtForPoolAdapter,
    address receiver,
    bool lastPoolAdapter,
    address borrowAsset_
  ) internal returns (
    uint remainTotalDebt,
    uint collateralAmountOut
  ) {
    uint delta;
    uint amountToPayToPoolAdapter = totalAmountToRepay >= totalDebtForPoolAdapter
      ? totalDebtForPoolAdapter
      : totalAmountToRepay;

    // make repayment, assume infinity approve: IERC20(borrowAsset_).safeApprove(address(pa), amountToPayToPoolAdapter);
    // the amount-to-repay can contain debt gap, so a part of the amount can be returned back
    bool closePosition = amountToPayToPoolAdapter == totalDebtForPoolAdapter;
    if (lastPoolAdapter) {
      // last pool adapter is able to allow the receiver to receive excess amount-to-repay directly
      collateralAmountOut = poolAdapter.repay(amountToPayToPoolAdapter, receiver, closePosition);
    } else {
      // not-last pool adapter should receive excess amount-to-repay back to TetuConverter balance
      // and so it will be possible to reuse this amount to repay debts of the next pool adapters (scb-821)
      uint balanceBefore = IERC20(borrowAsset_).balanceOf(address(this));
      collateralAmountOut = poolAdapter.repay(amountToPayToPoolAdapter, receiver, closePosition);
      delta = AppUtils.sub0(IERC20(borrowAsset_).balanceOf(address(this)), balanceBefore);
    }
    remainTotalDebt = totalDebtForPoolAdapter + delta - amountToPayToPoolAdapter;

    emit OnRepayBorrow(address(poolAdapter), amountToPayToPoolAdapter, receiver, closePosition);
  }

//#endregion ------------------------------------------------- Repay

  //region ----------------------------------------------------- Utils
  /// @notice Add {debtGap} to the {amount}
  /// @param debtGap debt-gap percent [0..1), decimals DEBT_GAP_DENOMINATOR
  function getAmountWithDebtGap(uint amount, uint debtGap) public pure returns (uint) {
    // Real value of debt gap in AAVE can be very low but it's greater than zero
    // so, even if the amount is very low, the result debt gap addon must be greater than zero
    // we assume here, that it should be not less than MIN_DEBT_GAP_ADDON
    return Math.max(amount * (DEBT_GAP_DENOMINATOR + debtGap) / DEBT_GAP_DENOMINATOR, amount + MIN_DEBT_GAP_ADDON);
  }
  //endregion ----------------------------------------------------- Utils
}

