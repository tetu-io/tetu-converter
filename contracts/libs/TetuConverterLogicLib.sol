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

//#region ------------------------------------------------- Events
  event OnRequireRepayCloseLiquidatedPosition(address poolAdapter, uint statusAmountToPay);
  event OnRequireRepayRebalancing(address poolAdapter, uint amount, bool isCollateral, uint statusAmountToPay, uint healthFactorAfterRepay18);
  event OnSafeLiquidate(address sourceToken, uint sourceAmount, address targetToken, address receiver, uint outputAmount);
  event OnRepayTheBorrow(address poolAdapter, uint collateralOut, uint repaidAmountOut);
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
    require(controller_.keeper() == msg.sender, AppErrors.KEEPER_ONLY);
    require(requiredBorrowedAmount_ != 0, AppErrors.INCORRECT_VALUE);

    IPoolAdapter pa = IPoolAdapter(poolAdapter_);
    (,address user, address collateralAsset,) = pa.getConfig();
    pa.updateStatus();
    (, uint amountToPay,,,,) = pa.getStatus();

    if (requiredCollateralAmount_ == 0) {
      // Full liquidation happens, we have lost all collateral amount
      // We need to close the position as is and drop away the pool adapter without paying any debt
      IDebtMonitor(IConverterController(controller_).debtMonitor()).closeLiquidatedPosition(address(pa));
      emit OnRequireRepayCloseLiquidatedPosition(address(pa), amountToPay);
    } else {
      // rebalancing
      // we assume here, that requiredBorrowedAmount_ should be less than amountToPay even if it includes the debt-gap
      require(amountToPay != 0 && requiredBorrowedAmount_ < amountToPay, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

      // for definiteness ask the user to send us collateral asset
      (bool skipRepay, uint amount) = _requirePayAmountBack(
        ITetuConverterCallback(user),
        pa,
        collateralAsset,
        requiredCollateralAmount_,
        IBorrowManager(controller_.borrowManager()),
        uint(controller_.minHealthFactor2()) * 10 ** (18 - 2)
      );

      if (! skipRepay) {
        uint resultHealthFactor18 = pa.repayToRebalance(amount, true);
        emit OnRequireRepayRebalancing(address(pa), amount, true, amountToPay, resultHealthFactor18);
      }
    }
  }

  /// @notice Ask user (a strategy) to transfer {amount_} of {asset_} to balance of the converter
  /// @dev Call user_.requirePayAmountBack one or two times
  /// @param user_ The strategy - owner of the {pa_}
  /// @param pa_ Pool adapter with the debt that should be rebalanced
  /// @param asset_ Collateral asset of pa
  /// @param amount_ Amount required by {pa_} to rebalance the debt
  function _requirePayAmountBack(
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
    console.log("_requirePayAmountBack.amountReturnedByUser", amountReturnedByUser);

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
      console.log("_requirePayAmountBack.requiredCollateralToPay", requiredCollateralToPay);

      if (requiredCollateralToPay == 0) {
        skipRepay = true;
      } else {
        require(amountReturnedByUser != 0, AppErrors.ZERO_AMOUNT); // user has any assets to send to converter
        console.log("_requirePayAmountBack.amountReceivedOnBalance", amountReceivedOnBalance);
        console.log("_requirePayAmountBack.Math.min(amountReturnedByUser, requiredCollateralToPay)", Math.min(amountReturnedByUser, requiredCollateralToPay));
        (amountReturnedByUser, amountReceivedOnBalance) = _callRequirePayAmountBack(
          user_,
          asset_,
          Math.min(amountReturnedByUser, requiredCollateralToPay)
        );
        console.log("_requirePayAmountBack.amountReturnedByUser", amountReturnedByUser);
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
    console.log("repayTheBorrow.closePosition", closePosition);
    // update internal debts and get actual amount to repay
    IPoolAdapter pa = IPoolAdapter(poolAdapter_);
    (,address user, address collateralAsset, address borrowAsset) = pa.getConfig();
    pa.updateStatus();

    // add debt gap if necessary
    bool debtGapRequired;
    (collateralAmountOut, repaidAmountOut,,,, debtGapRequired) = pa.getStatus();
    console.log("repayTheBorrow.collateralAmountOut", collateralAmountOut);
    console.log("repayTheBorrow.repaidAmountOut", repaidAmountOut);
    console.log("repayTheBorrow.debtGapRequired", debtGapRequired);
    if (debtGapRequired) {
      repaidAmountOut = getAmountWithDebtGap(repaidAmountOut, controller_.debtGap());
      console.log("repayTheBorrow.repaidAmountOut.fixed", repaidAmountOut);
    }
    require(collateralAmountOut != 0 && repaidAmountOut != 0, AppErrors.REPAY_FAILED);

    // ask the user for the amount-to-repay; use exist balance for safety, normally it should be 0
    uint balanceBefore = IERC20(borrowAsset).balanceOf(address(this));
    console.log("repayTheBorrow.balanceBefore", balanceBefore);

    // for definiteness ask the user to send us collateral asset
    (bool skipRepay, uint amount) = _requirePayAmountBack(
      ITetuConverterCallback(user),
      pa,
      borrowAsset,
      repaidAmountOut - balanceBefore,
      IBorrowManager(controller_.borrowManager()),
      uint(controller_.minHealthFactor2()) * 10 ** (18 - 2)
    );

    if (! skipRepay) {
      uint balanceAfter = IERC20(borrowAsset).balanceOf(address(this));
      console.log("repayTheBorrow.balanceAfter", balanceAfter);

      // ensure that we have received required amount fully or partially
      if (closePosition) {
        require(balanceAfter >= balanceBefore + repaidAmountOut, AppErrors.WRONG_AMOUNT_RECEIVED);
      } else {
        require(balanceAfter > balanceBefore, AppErrors.ZERO_BALANCE);
        repaidAmountOut = balanceAfter - balanceBefore;
      }

      // make full repay and close the position
      balanceBefore = IERC20(borrowAsset).balanceOf(user);
      console.log("repayTheBorrow.balanceBefore.user", balanceBefore);
      collateralAmountOut = pa.repay(repaidAmountOut, user, closePosition);
      console.log("repayTheBorrow.collateralAmountOut", collateralAmountOut);
      emit OnRepayTheBorrow(poolAdapter_, collateralAmountOut, repaidAmountOut);
      balanceAfter = IERC20(borrowAsset).balanceOf(user);
      console.log("repayTheBorrow.balanceBefore.user.final", balanceBefore);

      address[] memory assets = new address[](2);
      assets[0] = borrowAsset;
      assets[1] = collateralAsset;

      uint[] memory amounts = new uint[](2);
      // repay is able to return small amount of borrow-asset back to the user, we should pass it to onTransferAmounts
      amounts[0] = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;
      if (amounts[0] > 0) { // exclude returned part of the debt gap from repaidAmountOut
        repaidAmountOut = repaidAmountOut > amounts[0]
          ? repaidAmountOut - amounts[0]
          : 0;
      }
      amounts[1] = collateralAmountOut;
      ITetuConverterCallback(user).onTransferAmounts(assets, amounts);

      console.log("repayTheBorrow.collateralAmountOut", collateralAmountOut);
      console.log("repayTheBorrow.repaidAmountOut", repaidAmountOut);
      return (collateralAmountOut, repaidAmountOut);
    } else {
      return (0, 0);
    }
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

