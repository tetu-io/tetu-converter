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
  ///       Find best strategy for conversion
  ///////////////////////////////////////////////////////

  // todo docs
  function findConversionStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint periodInBlocks_,
    ConversionMode conversionMode
  ) external view override returns (
    address converter,
    uint maxTargetAmount,
    int apr18
  ) {
    require(sourceAmount_ > 0, AppErrors.ZERO_AMOUNT);
    require(periodInBlocks_ > 0, AppErrors.INCORRECT_VALUE);

    AppDataTypes.InputConversionParams memory params = AppDataTypes.InputConversionParams({
      sourceToken: sourceToken_,
      targetToken: targetToken_,
      sourceAmount: sourceAmount_,
      periodInBlocks: periodInBlocks_
    });

    // There are only two modes - BORROW and AUTO (SWAP or BORROW)
    // To make pure SWAP it's necessary to use TetuLiquidator directly
    if (conversionMode == ITetuConverter.ConversionMode.BORROW_1) {
      // find best lending platform
      return IBorrowManager(controller.borrowManager()).findConverter(params);
    } else {
      (
        address borrowConverter,
        uint borrowMaxTargetAmount,
        int borrowingApr18
      ) = IBorrowManager(controller.borrowManager()).findConverter(params);

      (
        address swapConverter,
        uint swapMaxTargetAmount,
        int swapApr18
      ) = _swapManager().getConverter(params);

      bool useBorrow =
        swapConverter == address(0)
        || (
          borrowConverter != address(0)
          && swapApr18 > borrowingApr18
        );

      return useBorrow
        ? (borrowConverter, borrowMaxTargetAmount, borrowingApr18)
        : (swapConverter, swapMaxTargetAmount, swapApr18);
    }
  }

  ///////////////////////////////////////////////////////
  ///       Make conversion, open position
  ///////////////////////////////////////////////////////

  // todo docs
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
    // todo all open function should have reentrancy check
    return _convert(
      converter_,
      collateralAsset_,
      collateralAmount_,
      borrowAsset_,
      amountToBorrow_,
      receiver_
    );
  }

  function _convert(
    address converter_,
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint amountToBorrow_,
    address receiver_
  ) internal returns (
    uint borrowedAmountOut
  ) {
    require(IERC20(collateralAsset_).balanceOf(address(this)) >= collateralAmount_, AppErrors.WRONG_AMOUNT_RECEIVED);
    require(receiver_ != address(0) && converter_ != address(0), AppErrors.ZERO_ADDRESS);
    require(collateralAmount_ != 0 && amountToBorrow_ != 0, AppErrors.ZERO_AMOUNT);
    IBorrowManager borrowManager = IBorrowManager(controller.borrowManager());

    AppDataTypes.ConversionKind conversionKind = IConverter(converter_).getConversionKind();
    if (conversionKind == AppDataTypes.ConversionKind.BORROW_2) {
      // make borrow
      // get exist or register new pool adapter
      address poolAdapter = borrowManager.getPoolAdapter(converter_, msg.sender, collateralAsset_, borrowAsset_);

      if (poolAdapter != address(0)) {
        // the pool adapter can have three possible states:
        // - healthy (normal), it's ok to make new borrow using the pool adapter
        // - unhealthy, health factor is less 1. It means that liquidation happens and the pool adapter is not usable.
        // - unhealthy, health factor is greater 1 but it's less min-allowed-value.
        //              It means, that because of some reasons keeper doesn't make rebalance
        (,, uint healthFactor18,,) = IPoolAdapter(poolAdapter).getStatus();
        if (healthFactor18 < 1e18) {
          // the pool adapter is unhealthy, we should mark it as dirty and create new pool adapter for the borrow
          borrowManager.markPoolAdapterAsDirty(converter_, msg.sender, collateralAsset_, borrowAsset_);
          poolAdapter = address(0);
        } else if (healthFactor18 <= (uint(controller.minHealthFactor2()) * 10**(18-2))) {
          // this is not normal situation
          // keeper doesn't work? it's too risky to make new borrow
          revert(AppErrors.REBALANCING_IS_REQUIRED);
        }
      }

      // create new pool adapter if we don't have ready-to-borrow one
      if (poolAdapter == address(0)) {
        poolAdapter = borrowManager.registerPoolAdapter(
          converter_,
          msg.sender,
          collateralAsset_,
          borrowAsset_
        );
      }

      // todo you do not need refresh approve if you use the all
      // todo and you can use infinity approve - this contract not suppose to hold any assets, make approve only if needed
      IERC20(collateralAsset_).safeApprove(poolAdapter, 0);
      IERC20(collateralAsset_).safeApprove(poolAdapter, collateralAmount_);

      // borrow target-amount and transfer borrowed amount to the receiver
      return IPoolAdapter(poolAdapter).borrow(collateralAmount_, amountToBorrow_, receiver_);

    } else if (conversionKind == AppDataTypes.ConversionKind.SWAP_1) {
      require(converter_ == address(_swapManager()), AppErrors.INCORRECT_CONVERTER_TO_SWAP);
      IERC20(collateralAsset_).safeTransfer(converter_, collateralAmount_);
      return ISwapConverter(converter_).swap(
        collateralAsset_,
        collateralAmount_,
        borrowAsset_,
        amountToBorrow_,
        receiver_
      );
    } else {
      revert(AppErrors.UNSUPPORTED_CONVERSION_KIND);
    }
  }

  ///////////////////////////////////////////////////////
  ///       Make repay, close position
  ///////////////////////////////////////////////////////

  // todo docs
  function repay(
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_,
    address receiver_
  ) external override returns (
    uint collateralAmountOut,
    uint returnedBorrowAmountOut
  ) {
    // todo all open function should have reentrancy check
    require(receiver_ != address(0), AppErrors.ZERO_ADDRESS);

    // ensure that we have received required amount
    require(amountToRepay_ == IERC20(borrowAsset_).balanceOf(address(this)), AppErrors.WRONG_AMOUNT_RECEIVED);

    // how much is left to convert from borrow asset to collateral asset
    uint amountToPay = amountToRepay_;

    // we need to repay exact amount using any pool adapters
    // simplest strategy: use first available pool adapter
    address[] memory poolAdapters = _debtMonitor().getPositions(
      msg.sender,
      collateralAsset_,
      borrowAsset_
    );
    uint lenPoolAdapters = poolAdapters.length;

    // at first repay debts for any opened positions
    // repay don't make any rebalancing here
    for (uint i = 0; i < lenPoolAdapters; i = i.uncheckedInc()) {
      if (amountToPay == 0) {
        break;
      }
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      pa.updateStatus();

      (,uint totalDebtForPoolAdapter,,,) = pa.getStatus();
      uint amountToPayToPoolAdapter = amountToPay >= totalDebtForPoolAdapter
        ? totalDebtForPoolAdapter
        : amountToPay;

      // todo you do not need refresh approve if you use the all
      // todo and you can use infinity approve - this contract not suppose to hold any assets, make approve only if needed
      // send amount to pool adapter
      IERC20(borrowAsset_).safeApprove(address(pa), 0);
      IERC20(borrowAsset_).safeApprove(address(pa), amountToPayToPoolAdapter);

      // make repayment
      collateralAmountOut += pa.repay(
        amountToPayToPoolAdapter,
        receiver_,
        amountToPayToPoolAdapter == totalDebtForPoolAdapter // close position
      );
      amountToPay -= amountToPayToPoolAdapter;
    }

    // if all debts were paid but we still have some amount of borrow asset
    // let's swap it to collateral asset and send to collateral-receiver
    if (amountToPay > 0) {
      AppDataTypes.InputConversionParams memory params = AppDataTypes.InputConversionParams({
        sourceToken: borrowAsset_,
        targetToken: collateralAsset_,
        sourceAmount: amountToPay,
        periodInBlocks: 1 // optimal converter strategy doesn't depend on the period of blocks
      });
      (address converter, uint collateralAmount,) = _swapManager().getConverter(params);
      if (converter == address(0)) {
        // there is no swap-strategy to convert remain {amountToPay} to {collateralAsset_}
        // let's return this amount back to the {receiver_}
        returnedBorrowAmountOut = amountToPay;
        IERC20(borrowAsset_).safeTransfer(receiver_, amountToPay);
      } else {
        // conversion strategy is found
        // let's convert all remaining {amountToPay} to {collateralAsset}
        IERC20(borrowAsset_).safeTransfer(converter, amountToPay);
        ISwapConverter(converter).swap(
          borrowAsset_,
          amountToPay,
          collateralAsset_,
          collateralAmount,
          receiver_
        );
        collateralAmountOut += collateralAmount;
      }
    }

    return (collateralAmountOut, returnedBorrowAmountOut);
  }

  ///////////////////////////////////////////////////////
  ///       IKeeperCallback
  ///////////////////////////////////////////////////////

  // todo docs
  function requireRepay(
    uint requiredAmountBorrowAsset_,
    uint requiredAmountCollateralAsset_,
    address poolAdapter_
  ) external override {
    require(controller.keeper() == msg.sender, AppErrors.KEEPER_ONLY);
    require(requiredAmountBorrowAsset_ > 0, AppErrors.INCORRECT_VALUE);

    IPoolAdapter pa = IPoolAdapter(poolAdapter_);
    (,address user, address collateralAsset, address borrowAsset) = pa.getConfig();
    pa.updateStatus();
    (, uint amountToPay,,,) = pa.getStatus();

    if (requiredAmountCollateralAsset_ == 0) {
      // Full liquidation happens, we have lost all collateral amount
      // We need to close the position as is and drop away the pool adapter without paying any debt
      _debtMonitor().closeLiquidatedPosition(address(pa));
    } else {
      // rebalancing
      //!TODO: we have exactly same checking inside pool adapters... we need to check this condition only once
      require(amountToPay > 0 && requiredAmountBorrowAsset_ < amountToPay, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

      // ask the borrower to send us required part of the borrowed amount
      uint balanceBorrowedAsset = IERC20(borrowAsset).balanceOf(address(this));
      uint balanceCollateralAsset = IERC20(collateralAsset).balanceOf(address(this));
      (, bool isCollateral) = ITetuConverterCallback(user).requireAmountBack(
        collateralAsset,
        requiredAmountCollateralAsset_,
        borrowAsset,
        requiredAmountBorrowAsset_
      );

      // re-send amount-to-repay to the pool adapter and make rebalancing
      if (isCollateral) {
        // the borrower has sent us the amount of collateral asset
        require(
          IERC20(collateralAsset).balanceOf(address(this)) - balanceCollateralAsset == requiredAmountCollateralAsset_,
          AppErrors.WRONG_AMOUNT_RECEIVED
        );
        // todo you do not need refresh approve if you use the all
        // todo and you can use infinity approve - this contract not suppose to hold any assets, make approve only if needed
        IERC20(collateralAsset).safeApprove(poolAdapter_, 0);
        IERC20(collateralAsset).safeApprove(poolAdapter_, requiredAmountCollateralAsset_);
      } else {
        // todo IERC20(borrowAsset).balanceOf(address(this)) - balanceBorrowedAsset can throw overflow
        // the borrower has sent us the amount of borrow asset
        require(
          IERC20(borrowAsset).balanceOf(address(this)) - balanceBorrowedAsset == requiredAmountBorrowAsset_,
          AppErrors.WRONG_AMOUNT_RECEIVED
        );
        // todo you do not need refresh approve if you use the all
        // todo and you can use infinity approve - this contract not suppose to hold any assets, make approve only if needed
        IERC20(borrowAsset).safeApprove(poolAdapter_, 0);
        IERC20(borrowAsset).safeApprove(poolAdapter_, requiredAmountBorrowAsset_);
      }

      uint resultHealthFactor18 = pa.repayToRebalance(
        isCollateral ? requiredAmountCollateralAsset_ : requiredAmountBorrowAsset_,
        isCollateral
      );

      // ensure that the health factor was restored to ~target health factor value
      ensureApproxSameToTargetHealthFactor(borrowAsset, resultHealthFactor18);
    }
  }

  function ensureApproxSameToTargetHealthFactor(
    address borrowAsset_,
    uint resultHealthFactor18_
  ) public view {
    // after rebalancing we should have health factor ALMOST equal to the target health factor
    // but the equality is not exact
    // let's allow small difference < 1/10 * (target health factor - min health factor)
    uint targetHealthFactor18 = uint(
      IBorrowManager(controller.borrowManager()).getTargetHealthFactor2(borrowAsset_)
    ) * 10**(18-2);
    uint minHealthFactor18 = uint(controller.minHealthFactor2()) * 10**(18-2);
    // todo can throw overflow
    uint delta = (targetHealthFactor18 - minHealthFactor18) / ADDITIONAL_BORROW_DELTA_DENOMINATOR;

    require(
      resultHealthFactor18_ + delta > targetHealthFactor18
      // todo can throw overflow
      && resultHealthFactor18_ - delta < targetHealthFactor18,
      AppErrors.WRONG_REBALANCING
    );
  }

  ///////////////////////////////////////////////////////
  ///       Get debt/repay info
  ///////////////////////////////////////////////////////

  /// @notice Update status in all opened positions
  ///         After this call getDebtAmount will be able to return exact amount to repay
  function getDebtAmountCurrent(
    address collateralAsset_,
    address borrowAsset_
  ) external override returns (
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) {
    // todo all open function should have reentrancy check
    address[] memory poolAdapters = _debtMonitor().getPositions(
      msg.sender,
      collateralAsset_,
      borrowAsset_
    );
    uint lenPoolAdapters = poolAdapters.length;

    for (uint i = 0; i < lenPoolAdapters; i = i.uncheckedInc()) {
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      pa.updateStatus();
      (uint collateralAmount, uint totalDebtForPoolAdapter,,,) = pa.getStatus();
      totalDebtAmountOut += totalDebtForPoolAdapter;
      totalCollateralAmountOut += collateralAmount;
    }

    return (totalDebtAmountOut, totalCollateralAmountOut);
  }

  // todo docs
  function getDebtAmountStored(
    address collateralAsset_,
    address borrowAsset_
  ) external view override returns (
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) {
    address[] memory poolAdapters = _debtMonitor().getPositions(
      msg.sender,
      collateralAsset_,
      borrowAsset_
    );
    uint lenPoolAdapters = poolAdapters.length;

    for (uint i = 0; i < lenPoolAdapters; i = i.uncheckedInc()) {
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      (uint collateralAmount, uint totalDebtForPoolAdapter,,,) = pa.getStatus();
      totalDebtAmountOut += totalDebtForPoolAdapter;
      totalCollateralAmountOut += collateralAmount;
    }

    return (totalDebtAmountOut, totalCollateralAmountOut);
  }

  /// @notice User needs to redeem some collateral amount. Calculate an amount that should be repaid
  function estimateRepay(
    address collateralAsset_,
    uint collateralAmountToRedeem_,
    address borrowAsset_
  ) external view override returns (
    uint borrowAssetAmount,
    uint unobtainableCollateralAssetAmount
  ) {
    address[] memory poolAdapters = _debtMonitor().getPositions(
      msg.sender,
      collateralAsset_,
      borrowAsset_
    );
    uint lenPoolAdapters = poolAdapters.length;

    uint collateralAmountRemained = collateralAmountToRedeem_;
    for (uint i = 0; i < lenPoolAdapters; i = i.uncheckedInc()) {
      if (collateralAmountRemained == 0) {
        break;
      }

      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      (uint collateralAmount, uint borrowedAmount,,,) = pa.getStatus();

      if (collateralAmountRemained >= collateralAmount) {
        collateralAmountRemained -= collateralAmount;
        borrowAssetAmount += borrowedAmount;
      } else {
        borrowAssetAmount += borrowedAmount * collateralAmountRemained / collateralAmount;
        collateralAmountRemained = 0;
      }
    }

    return (borrowAssetAmount, collateralAmountRemained);
  }

  ///////////////////////////////////////////////////////
  ///       Check and claim rewards
  ///////////////////////////////////////////////////////

  function claimRewards(address receiver_) external override returns (
    address[] memory rewardTokensOut,
    uint[] memory amountsOut
  ) {
    // todo all open function should have reentrancy check
    address[] memory poolAdapters = _debtMonitor().getPositionsForUser(msg.sender);
    uint lenPoolAdapters = poolAdapters.length;

    address[] memory rewardTokens = new address[](lenPoolAdapters);
    uint[] memory amounts = new uint[](lenPoolAdapters);
    uint countPositions = 0;
    for (uint i = 0; i < lenPoolAdapters; i = i.uncheckedInc()) {
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      (rewardTokens[countPositions], amounts[countPositions]) = pa.claimRewards(receiver_);
      if (amounts[countPositions] != 0) {
        ++countPositions;
      }
    }

    if (countPositions > 0) {
      rewardTokensOut = AppUtils.removeLastItems(rewardTokens, countPositions);
      amountsOut = AppUtils.removeLastItems(amounts, countPositions);
    }

    return (rewardTokensOut, amountsOut);
  }

  ///////////////////////////////////////////////////////
  ///  Additional functions, not required by strategies
  ///////////////////////////////////////////////////////
  function findBorrows (
    address collateralToken_,
    address borrowedToken_
  ) external view override returns (
    address[] memory poolAdapters
  ) {
    return _debtMonitor().getPositions(msg.sender, collateralToken_, borrowedToken_);
  }

  ///////////////////////////////////////////////////////
  ///       Inline functions //todo check where better to use local vars
  ///////////////////////////////////////////////////////
  function _debtMonitor() internal view returns (IDebtMonitor) {
    return IDebtMonitor(controller.debtMonitor());
  }

  function _swapManager() internal view returns (ISwapManager) {
    return ISwapManager(controller.swapManager());
  }


  ///////////////////////////////////////////////////////
  ///       Next version features
  ///////////////////////////////////////////////////////
//  function requireAdditionalBorrow(
//    uint amountToBorrow_,
//    address poolAdapter_
//  ) external override {
//    onlyKeeper();
//
//    IPoolAdapter pa = IPoolAdapter(poolAdapter_);
//
//    (, address user, address collateralAsset, address borrowAsset) = pa.getConfig();
//
//    // make rebalancing
//    (uint resultHealthFactor18, uint borrowedAmountOut) = pa.borrowToRebalance(amountToBorrow_, user);
//    _ensureApproxSameToTargetHealthFactor(borrowAsset, resultHealthFactor18);
//
//    // notify the borrower about new available borrowed amount
//    ITetuConverterCallback(user).onTransferBorrowedAmount(collateralAsset, borrowAsset, borrowedAmountOut);
//  }
//
//  function requireReconversion(
//    address poolAdapter_,
//    uint periodInBlocks_
//  ) external override {
//    onlyKeeper();
//
//    //TODO: draft (not tested) implementation
//
//    IPoolAdapter pa = IPoolAdapter(poolAdapter_);
//    (address originConverter, address user, address collateralAsset, address borrowAsset) = pa.getConfig();
//    (,uint amountToPay,,) = pa.getStatus();
//
//    // require borrowed amount back
//    uint balanceBorrowedAsset = IERC20(borrowAsset).balanceOf(address(this));
//    ITetuConverterCallback(user).requireAmountBack(
//      collateralAsset,
//      borrowAsset,
//      amountToPay,
//      0 // TODO if we allow to pass 0 as collateral amount it means that borrow amount MUST be returned
//    // TODO but currently it's not implemented
//    );
//    require(
//      IERC20(borrowAsset).balanceOf(address(this)) - balanceBorrowedAsset == amountToPay,
//      AppErrors.WRONG_AMOUNT_RECEIVED
//    );
//
//    //make repay and close position
//    uint balanceCollateralAsset = IERC20(collateralAsset).balanceOf(address(this));
//    pa.syncBalance(false, false);
//    IERC20(borrowAsset).safeTransfer(poolAdapter_, amountToPay);
//    pa.repay(amountToPay, address(this), true);
//    uint collateralAmount = IERC20(collateralAsset).balanceOf(address(this)) - balanceCollateralAsset;
//
//    // find new plan
//    (address converter, uint maxTargetAmount,) = _findConversionStrategy(
//      collateralAsset,
//      collateralAmount,
//      borrowAsset,
//      periodInBlocks_,
//      ITetuConverter.ConversionMode.AUTO_0
//    );
//    require(converter != originConverter, AppErrors.RECONVERSION_WITH_SAME_CONVERTER_FORBIDDEN);
//    require(converter != address(0), AppErrors.CONVERTER_NOT_FOUND);
//
//    // make conversion using new pool adapter, transfer borrowed amount back to user
//    uint newBorrowedAmount = _convert(
//      converter,
//      collateralAsset,
//      collateralAmount,
//      borrowAsset,
//      maxTargetAmount,
//      user
//    );
//    ITetuConverterCallback(user).onTransferBorrowedAmount(collateralAsset, borrowAsset, newBorrowedAmount);
//  }
}
