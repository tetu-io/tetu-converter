// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../libs/AppDataTypes.sol";
import "../libs/AppErrors.sol";
import "../libs/AppUtils.sol";
import "../libs/EntryKinds.sol";
import "../libs/SwapLib.sol";
import "../openzeppelin/IERC20Metadata.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/IERC20.sol";
import "../openzeppelin/ReentrancyGuard.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/ISwapManager.sol";
import "../interfaces/ITetuConverter.sol";
import "../interfaces/IPlatformAdapter.sol";
import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IConverterController.sol";
import "../interfaces/IDebtMonitor.sol";
import "../interfaces/IConverter.sol";
import "../interfaces/ISwapConverter.sol";
import "../interfaces/IKeeperCallback.sol";
import "../interfaces/ITetuConverterCallback.sol";
import "../interfaces/IRequireAmountBySwapManagerCallback.sol";
import "../interfaces/IPriceOracle.sol";
import "../integrations/tetu/ITetuLiquidator.sol";
import "../integrations/market/ICErc20.sol";

/// @notice Main application contract
contract TetuConverter is ITetuConverter, IKeeperCallback, IRequireAmountBySwapManagerCallback, ReentrancyGuard {
  using SafeERC20 for IERC20;
  using AppUtils for uint;

  /// @notice After additional borrow result health factor should be near to target value, the difference is limited.
  uint constant public ADDITIONAL_BORROW_DELTA_DENOMINATOR = 1;

  ///////////////////////////////////////////////////////
  ///                Members
  ///////////////////////////////////////////////////////

  IConverterController public immutable override controller;

  /// We cache immutable addresses here to avoid exceed calls to the controller
  IBorrowManager public immutable borrowManager;
  IDebtMonitor public immutable debtMonitor;
  ISwapManager public immutable swapManager;
  address public immutable keeper;
  IPriceOracle public immutable priceOracle;


  ///////////////////////////////////////////////////////
  ///                Data types
  ///////////////////////////////////////////////////////

  /// @notice Local vars for {findConversionStrategy}
  struct FindConversionStrategyLocal {
    address[] borrowConverters;
    uint[] borrowSourceAmounts;
    uint[] borrowTargetAmounts;
    int[] borrowAprs18;
    address swapConverter;
    uint swapSourceAmount;
    uint swapTargetAmount;
    int swapApr18;
  }

  ///////////////////////////////////////////////////////
  ///               Events
  ///////////////////////////////////////////////////////
  event OnSwap(
    address signer,
    address converter,
    address sourceAsset,
    uint sourceAmount,
    address targetAsset,
    address receiver,
    uint targetAmountOut
  );

  event OnBorrow(
    address poolAdapter,
    uint collateralAmount,
    uint amountToBorrow,
    address receiver,
    uint borrowedAmountOut
  );

  event OnRepayBorrow(
    address poolAdapter,
    uint amountToRepay,
    address receiver,
    bool closePosition
  );

  /// @notice A part of target amount cannot be repaid or swapped
  ///         so it was just returned back to receiver as is
  event OnRepayReturn(
    address asset,
    address receiver,
    uint amount
  );

  event OnRequireRepayCloseLiquidatedPosition(
    address poolAdapter,
    uint statusAmountToPay
  );

  event OnRequireRepayRebalancing(
    address poolAdapter,
    uint amount,
    bool isCollateral,
    uint statusAmountToPay,
    uint healthFactorAfterRepay18
  );

  event OnClaimRewards(
    address poolAdapter,
    address rewardsToken,
    uint amount,
    address receiver
  );

  event OnSafeLiquidate(
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    address receiver,
    uint outputAmount
  );

  event OnRepayTheBorrow(
    address poolAdapter,
    uint collateralOut,
    uint repaidAmountOut
  );

  ///////////////////////////////////////////////////////
  ///                Initialization
  ///////////////////////////////////////////////////////

  constructor(
    address controller_,
    address borrowManager_,
    address debtMonitor_,
    address swapManager_,
    address keeper_,
    address priceOracle_
  ) {
    require(
      controller_ != address(0)
      && borrowManager_ != address(0)
      && debtMonitor_ != address(0)
      && swapManager_ != address(0)
      && keeper_ != address(0)
      && priceOracle_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    controller = IConverterController(controller_);
    borrowManager = IBorrowManager(borrowManager_);
    debtMonitor = IDebtMonitor(debtMonitor_);
    swapManager = ISwapManager(swapManager_);
    keeper = keeper_;
    priceOracle = IPriceOracle(priceOracle_);
  }

  ///////////////////////////////////////////////////////
  ///       Find best strategy for conversion
  ///////////////////////////////////////////////////////

  /// @notice Find best conversion strategy (swap or borrow) and provide "cost of money" as interest for the period.
  ///         It calls both findBorrowStrategy and findSwapStrategy and selects a best strategy.
  /// @dev This is writable function with read-only behavior.
  ///      It should be writable to be able to simulate real swap and get a real APR for swapping.
  /// @param amountIn_  The meaning depends on entryData
  ///                   For entryKind=0 it's max available amount of collateral
  ///                   This amount must be approved to TetuConverter before the call.
  ///                   For entryKind=2 we don't know amount of collateral before the call,
  ///                   so it's necessary to approve large enough amount (or make infinity approve)
  /// @param periodInBlocks_ Estimated period to keep target amount. It's required to compute APR
  /// @return converter Result contract that should be used for conversion to be passed to borrow().
  /// @return collateralAmountOut Amount of {sourceToken_} that should be swapped to get {targetToken_}
  ///                            It can be different from the {sourceAmount_} for some entry kinds.
  /// @return amountToBorrowOut Result amount of {targetToken_} after conversion
  /// @return apr18 Interest on the use of {outMaxTargetAmount} during the given period, decimals 18
  function findConversionStrategy(
    bytes memory entryData_,
    address sourceToken_,
    uint amountIn_,
    address targetToken_,
    uint periodInBlocks_
  ) external override returns (
    address converter,
    uint collateralAmountOut,
    uint amountToBorrowOut,
    int apr18
  ) {
    require(amountIn_ != 0, AppErrors.ZERO_AMOUNT);
    require(periodInBlocks_ != 0, AppErrors.INCORRECT_VALUE);

    FindConversionStrategyLocal memory p;
    if (!controller.paused()) {
      (p.borrowConverters,
       p.borrowSourceAmounts,
       p.borrowTargetAmounts,
       p.borrowAprs18
      ) = borrowManager.findConverter(entryData_, sourceToken_, targetToken_, amountIn_, periodInBlocks_);

      (p.swapConverter,
       p.swapSourceAmount,
       p.swapTargetAmount,
       p.swapApr18) = _findSwapStrategy(entryData_, sourceToken_, amountIn_, targetToken_);
    }

    if (p.borrowConverters.length == 0) {
      return (p.swapConverter == address(0))
        ? (address(0), uint(0), uint(0), int(0))
        : (p.swapConverter, p.swapSourceAmount, p.swapTargetAmount, p.swapApr18);
    } else {
      if (p.swapConverter == address(0)) {
        return (p.borrowConverters[0], p.borrowSourceAmounts[0], p.borrowTargetAmounts[0], p.borrowAprs18[0]);
      } else {
        return (p.swapApr18 > p.borrowAprs18[0])
          ? (p.borrowConverters[0], p.borrowSourceAmounts[0], p.borrowTargetAmounts[0], p.borrowAprs18[0])
          : (p.swapConverter, p.swapSourceAmount, p.swapTargetAmount, p.swapApr18);
      }
    }
  }

  /// @notice Find possible borrow strategies and provide "cost of money" as interest for the period for each strategy
  ///         Result arrays of the strategy are ordered in ascending order of APR.
  /// @param entryData_ Encoded entry kind and additional params if necessary (set of params depends on the kind)
  ///                   See EntryKinds.sol\ENTRY_KIND_XXX constants for possible entry kinds
  ///                   0 is used by default
  /// @param amountIn_  The meaning depends on entryData
  ///                   For entryKind=0 it's max available amount of collateral
  /// @param periodInBlocks_ Estimated period to keep target amount. It's required to compute APR
  /// @return converters Array of available converters ordered in ascending order of APR.
  ///                    Each item contains a result contract that should be used for conversion; it supports IConverter
  ///                    This address should be passed to borrow-function during conversion.
  ///                    The length of array is always equal to the count of available lending platforms.
  ///                    Last items in array can contain zero addresses (it means they are not used)
  /// @return collateralAmountsOut Amounts that should be provided as a collateral
  /// @return amountToBorrowsOut Amounts that should be borrowed
  /// @return aprs18 Interests on the use of {amountIn_} during the given period, decimals 18
  function findBorrowStrategies(
    bytes memory entryData_,
    address sourceToken_,
    uint amountIn_,
    address targetToken_,
    uint periodInBlocks_
  ) external view override returns (
    address[] memory converters,
    uint[] memory collateralAmountsOut,
    uint[] memory amountToBorrowsOut,
    int[] memory aprs18
  ) {
    require(amountIn_ != 0, AppErrors.ZERO_AMOUNT);
    require(periodInBlocks_ != 0, AppErrors.INCORRECT_VALUE);

    return controller.paused()
      ? (converters, collateralAmountsOut, amountToBorrowsOut, aprs18) // no conversion is available
      : borrowManager.findConverter(entryData_, sourceToken_, targetToken_, amountIn_, periodInBlocks_);
  }

  /// @notice Find best swap strategy and provide "cost of money" as interest for the period
  /// @dev This is writable function with read-only behavior.
  ///      It should be writable to be able to simulate real swap and get a real APR.
  /// @param amountIn_  The meaning depends on entryData
  ///                   For entryKind=0 it's max available amount of collateral
  ///                   This amount must be approved to TetuConverter before the call.
  ///                   For entryKind=2 we don't know amount of collateral before the call,
  ///                   so it's necessary to approve large enough amount (or make infinity approve)
  /// @return converter Result contract that should be used for conversion to be passed to borrow()
  /// @return sourceAmountOut Amount of {sourceToken_} that should be swapped to get {targetToken_}
  ///                         It can be different from the {sourceAmount_} for some entry kinds.
  /// @return targetAmountOut Result amount of {targetToken_} after swap
  /// @return apr18 Interest on the use of {outMaxTargetAmount} during the given period, decimals 18
  function findSwapStrategy(
    bytes memory entryData_,
    address sourceToken_,
    uint amountIn_,
    address targetToken_
  ) external override returns (
    address converter,
    uint sourceAmountOut,
    uint targetAmountOut,
    int apr18
  ) {
    require(amountIn_ != 0, AppErrors.ZERO_AMOUNT);

    return controller.paused()
      ? (converter, sourceAmountOut, targetAmountOut, apr18) // no conversion is available
      : _findSwapStrategy(entryData_, sourceToken_, amountIn_, targetToken_);
  }

  /// @notice Calculate amount to swap according to the given {entryData_} and estimate result amount of {targetToken_}
  function _findSwapStrategy(
    bytes memory entryData_,
    address sourceToken_,
    uint amountIn_,
    address targetToken_
  ) internal returns (
    address converter,
    uint sourceAmountOut,
    uint targetAmountOut,
    int apr18
  ) {
    uint entryKind = EntryKinds.getEntryKind(entryData_);
    if (entryKind == EntryKinds.ENTRY_KIND_EXACT_PROPORTION_1) {
      // Split {sourceAmount_} on two parts: C1 and C2. Swap C2 => {targetAmountOut}
      // Result cost of {targetAmountOut} and C1 should be equal or almost equal
      // For simplicity we assume here that swap doesn't have any lost:
      // if S1 is swapped to S2 then costs of S1 and S2 are equal
      sourceAmountOut = EntryKinds.getCollateralAmountToConvert(entryData_, amountIn_, 1, 1);
    } else {
      sourceAmountOut = amountIn_;
    }

    (converter, targetAmountOut) = swapManager.getConverter(
      msg.sender,
      sourceToken_,
      sourceAmountOut,
      targetToken_
    );
    if (converter != address(0)) {
      apr18 = swapManager.getApr18(sourceToken_, sourceAmountOut, targetToken_, targetAmountOut);
    }

    return (converter, sourceAmountOut, targetAmountOut, apr18);
  }

  ///////////////////////////////////////////////////////
  ///       Make conversion, open position
  ///////////////////////////////////////////////////////

  /// @notice Convert {collateralAmount_} to {amountToBorrow_} using {converter_}
  ///         Target amount will be transferred to {receiver_}. No re-balancing here.
  /// @dev Transferring of {collateralAmount_} by TetuConverter-contract must be approved by the caller before the call
  ///      Only whitelisted users are allowed to make borrows
  /// @param converter_ A converter received from findBestConversionStrategy.
  /// @param collateralAmount_ Amount of {collateralAsset_}.
  ///                          This amount must be approved to TetuConverter before the call.
  /// @param amountToBorrow_ Amount of {borrowAsset_} to be borrowed and sent to {receiver_}
  /// @param receiver_ A receiver of borrowed amount
  /// @return borrowedAmountOut Exact borrowed amount transferred to {receiver_}
  function borrow(
    address converter_,
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint amountToBorrow_,
    address receiver_
  ) external override nonReentrant returns (
    uint borrowedAmountOut
  ) {
    require(controller.isWhitelisted(msg.sender), AppErrors.OUT_OF_WHITE_LIST);
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
    require(receiver_ != address(0) && converter_ != address(0), AppErrors.ZERO_ADDRESS);
    require(collateralAmount_ != 0 && amountToBorrow_ != 0, AppErrors.ZERO_AMOUNT);

    IERC20(collateralAsset_).safeTransferFrom(msg.sender, address(this), collateralAmount_);

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

        // TetuConverter doesn't keep assets on its balance, so it's safe to use infinity approve
        // All approves replaced by infinity-approve were commented in the code below
        IERC20(collateralAsset_).safeApprove(poolAdapter, 2**255); // 2*255 is more gas-efficient than type(uint).max
        IERC20(borrowAsset_).safeApprove(poolAdapter, 2**255); // 2*255 is more gas-efficient than type(uint).max
      }

      // replaced by infinity approve: IERC20(collateralAsset_).safeApprove(poolAdapter, collateralAmount_);

      // borrow target-amount and transfer borrowed amount to the receiver
      borrowedAmountOut = IPoolAdapter(poolAdapter).borrow(collateralAmount_, amountToBorrow_, receiver_);
      emit OnBorrow(poolAdapter, collateralAmount_, amountToBorrow_, receiver_, borrowedAmountOut);
    } else if (conversionKind == AppDataTypes.ConversionKind.SWAP_1) {
      require(converter_ == address(swapManager), AppErrors.INCORRECT_CONVERTER_TO_SWAP);
      borrowedAmountOut = _makeSwap(
        converter_,
        collateralAsset_,
        collateralAmount_,
        borrowAsset_,
        receiver_
      );
    } else {
      revert(AppErrors.UNSUPPORTED_CONVERSION_KIND);
    }
  }

  /// @notice Transfer {sourceAmount_} to swap-converter, make swap, return result target amount
  function _makeSwap(
    address swapConverter_,
    address sourceAsset_,
    uint sourceAmount_,
    address targetAsset_,
    address receiver_
  ) internal returns (uint amountOut) {
    IERC20(sourceAsset_).safeTransfer(swapConverter_, sourceAmount_);
    amountOut = ISwapConverter(swapConverter_).swap(
      sourceAsset_,
      sourceAmount_,
      targetAsset_,
      receiver_
    );

    emit OnSwap(msg.sender, swapConverter_, sourceAsset_, sourceAmount_, targetAsset_, receiver_, amountOut);
  }

  ///////////////////////////////////////////////////////
  ///       Make repay, close position
  ///////////////////////////////////////////////////////

  /// @notice Full or partial repay of the borrow
  /// @dev A user should transfer {amountToRepay_} to TetuConverter before calling repay()
  /// @param amountToRepay_ Amount of borrowed asset to repay.
  ///                       You can know exact total amount of debt using {getStatusCurrent}.
  ///                       if the amount exceed total amount of the debt:
  ///                       - the debt will be fully repaid
  ///                       - remain amount will be swapped from {borrowAsset_} to {collateralAsset_}
  /// @param receiver_ A receiver of the collateral that will be withdrawn after the repay
  ///                  The remained amount of borrow asset will be returned to the {receiver_} too
  /// @return collateralAmountOut Exact collateral amount transferred to {collateralReceiver_}
  ///         If TetuConverter is not able to make the swap, it reverts
  /// @return returnedBorrowAmountOut A part of amount-to-repay that wasn't converted to collateral asset
  ///                                 because of any reasons (i.e. there is no available conversion strategy)
  ///                                 This amount is returned back to the collateralReceiver_
  /// @return swappedLeftoverCollateralOut A part of collateral received through the swapping
  /// @return swappedLeftoverBorrowOut A part of amountToRepay_ that was swapped
  function repay(
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_,
    address receiver_
  ) external override nonReentrant returns (
    uint collateralAmountOut,
    uint returnedBorrowAmountOut,
    uint swappedLeftoverCollateralOut,
    uint swappedLeftoverBorrowOut
  ) {
    require(receiver_ != address(0), AppErrors.ZERO_ADDRESS);

    // ensure that we have received required amount
    require(amountToRepay_ == IERC20(borrowAsset_).balanceOf(address(this)), AppErrors.WRONG_AMOUNT_RECEIVED);

    // we will decrease amountToRepay_ in the code (to avoid creation additional variable)
    // it shows how much is left to convert from borrow asset to collateral asset

    // we need to repay exact amount using any pool adapters
    // simplest strategy: use first available pool adapter
    address[] memory poolAdapters = debtMonitor.getPositions(msg.sender, collateralAsset_, borrowAsset_);
    uint lenPoolAdapters = poolAdapters.length;

    // at first repay debts for any opened positions
    // repay don't make any rebalancing here
    for (uint i = 0; i < lenPoolAdapters; i = i.uncheckedInc()) {
      if (amountToRepay_ == 0) {
        break;
      }
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      pa.updateStatus();

      (,uint totalDebtForPoolAdapter,,,) = pa.getStatus();
      uint amountToPayToPoolAdapter = amountToRepay_ >= totalDebtForPoolAdapter
        ? totalDebtForPoolAdapter
        : amountToRepay_;

      // replaced by infinity approve: IERC20(borrowAsset_).safeApprove(address(pa), amountToPayToPoolAdapter);

      // make repayment
      bool closePosition = amountToPayToPoolAdapter == totalDebtForPoolAdapter;
      collateralAmountOut += pa.repay(amountToPayToPoolAdapter, receiver_, closePosition);
      amountToRepay_ -= amountToPayToPoolAdapter;

      emit OnRepayBorrow(address(pa), amountToPayToPoolAdapter, receiver_, closePosition);
    }

    // if all debts were paid but we still have some amount of borrow asset
    // let's swap it to collateral asset and send to collateral-receiver
    if (amountToRepay_ > 0) {
      // getConverter requires the source amount be approved to TetuConverter, but a contract doesn't need to approve itself
      (address converter,) = swapManager.getConverter(address(this), borrowAsset_, amountToRepay_, collateralAsset_);

      if (converter == address(0)) {
        // there is no swap-strategy to convert remain {amountToPay} to {collateralAsset_}
        // let's return this amount back to the {receiver_}
        returnedBorrowAmountOut = amountToRepay_;
        IERC20(borrowAsset_).safeTransfer(receiver_, amountToRepay_);
        emit OnRepayReturn(borrowAsset_, receiver_, amountToRepay_);
      } else {
        // conversion strategy is found
        // let's convert all remaining {amountToPay} to {collateralAsset}
        swappedLeftoverCollateralOut = _makeSwap(converter, borrowAsset_, amountToRepay_, collateralAsset_, receiver_);
        swappedLeftoverBorrowOut = amountToRepay_;

        collateralAmountOut += swappedLeftoverCollateralOut;
      }
    }

    return (collateralAmountOut, returnedBorrowAmountOut, swappedLeftoverCollateralOut, swappedLeftoverBorrowOut);
  }

  /// @notice Estimate result amount after making full or partial repay
  /// @dev It works in exactly same way as repay() but don't make actual repay
  ///      Anyway, the function is write, not read-only, because it makes updateStatus()
  /// @param user_ user whose amount-to-repay will be calculated
  /// @param amountToRepay_ Amount of borrowed asset to repay.
  /// @return collateralAmountOut Total collateral amount to be returned after repay in exchange of {amountToRepay_}
  function quoteRepay(
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_
  ) external override returns (
    uint collateralAmountOut
  ) {
    address[] memory poolAdapters = debtMonitor.getPositions(
      user_,
      collateralAsset_,
      borrowAsset_
    );
    uint lenPoolAdapters = poolAdapters.length;
    for (uint i = 0; i < lenPoolAdapters; i = i.uncheckedInc()) {
      if (amountToRepay_ == 0) {
        break;
      }

      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);

      pa.updateStatus();
      (, uint totalDebtForPoolAdapter,,,) = pa.getStatus();

      bool closePosition = totalDebtForPoolAdapter <= amountToRepay_;
      uint currentAmountToRepay = closePosition ? totalDebtForPoolAdapter : amountToRepay_;
      uint collateralAmountToReceive = pa.getCollateralAmountToReturn(currentAmountToRepay, closePosition);

      amountToRepay_ -= currentAmountToRepay;
      collateralAmountOut += collateralAmountToReceive;
    }

    if (amountToRepay_ > 0) {
      uint priceBorrowAsset = priceOracle.getAssetPrice(borrowAsset_);
      uint priceCollateralAsset = priceOracle.getAssetPrice(collateralAsset_);
      require(priceCollateralAsset != 0 && priceBorrowAsset != 0, AppErrors.ZERO_PRICE);

      collateralAmountOut += amountToRepay_
        * 10**IERC20Metadata(collateralAsset_).decimals()
        * priceBorrowAsset
        / priceCollateralAsset
        / 10**IERC20Metadata(borrowAsset_).decimals();
    }

    return collateralAmountOut;
  }

  ///////////////////////////////////////////////////////
  ///       IKeeperCallback
  ///////////////////////////////////////////////////////

  /// @notice This function is called by a keeper if there is unhealthy borrow
  ///         The called contract should send either collateral-amount or borrowed-amount to TetuConverter
  /// @param requiredBorrowedAmount_ The borrower should return given borrowed amount back to TetuConverter
  ///                                in order to restore health factor to target value
  /// @param requiredCollateralAmount_ The borrower should send given amount of collateral to TetuConverter
  ///                                  in order to restore health factor to target value
  /// @param poolAdapter_ Address of the pool adapter that has problem health factor
  function requireRepay(
    uint requiredBorrowedAmount_,
    uint requiredCollateralAmount_,
    address poolAdapter_
  ) external nonReentrant override {
    require(keeper == msg.sender, AppErrors.KEEPER_ONLY);
    require(requiredBorrowedAmount_ != 0, AppErrors.INCORRECT_VALUE);

    IPoolAdapter pa = IPoolAdapter(poolAdapter_);
    (,address user, address collateralAsset,) = pa.getConfig();
    pa.updateStatus();
    (, uint amountToPay,,,) = pa.getStatus();

    if (requiredCollateralAmount_ == 0) {
      // Full liquidation happens, we have lost all collateral amount
      // We need to close the position as is and drop away the pool adapter without paying any debt
      debtMonitor.closeLiquidatedPosition(address(pa));
      emit OnRequireRepayCloseLiquidatedPosition(address(pa), amountToPay);
    } else {
      // rebalancing
      require(amountToPay != 0 && requiredBorrowedAmount_ < amountToPay, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

      // for borrowers it's much easier to return collateral asset than borrow asset
      // so ask the borrower to send us collateral asset
      uint balanceBefore = IERC20(collateralAsset).balanceOf(address(this));
      ITetuConverterCallback(user).requirePayAmountBack(collateralAsset, requiredCollateralAmount_);
      uint balanceAfter = IERC20(collateralAsset).balanceOf(address(this));

      // ensure that we have received any amount .. and use it for repayment
      // probably we've received less then expected - it's ok, just let's use as much as possible
      // DebtMonitor will ask to make rebalancing once more if necessary
      require(
        balanceAfter > balanceBefore // smth is wrong
        && balanceAfter - balanceBefore <= requiredCollateralAmount_, // we can receive less amount (partial rebalancing)
        AppErrors.WRONG_AMOUNT_RECEIVED
      );
      uint amount = balanceAfter - balanceBefore;
      // replaced by infinity approve: IERC20(collateralAsset).safeApprove(poolAdapter_, requiredAmountCollateralAsset_);

      uint resultHealthFactor18 = pa.repayToRebalance(amount, true);
      emit OnRequireRepayRebalancing(address(pa), amount, true, amountToPay, resultHealthFactor18);
    }
  }

  ///////////////////////////////////////////////////////
  ///       Close borrow forcibly by governance
  ///////////////////////////////////////////////////////
  /// @notice Close given borrow and return collateral back to the user, governance only
  /// @dev The pool adapter asks required amount-to-repay from the user internally
  /// @param poolAdapter_ The pool adapter that represents the borrow
  /// @param closePosition Close position after repay
  ///        Usually it should be true, because the function always tries to repay all debt
  ///        false can be used if user doesn't have enough amount to pay full debt
  ///              and we are trying to pay "as much as possible"
  /// @return collateralAmountOut Amount of collateral returned to the user
  /// @return repaidAmountOut Amount of borrow asset repaid to the lending platform
  function repayTheBorrow(address poolAdapter_, bool closePosition) external returns (
    uint collateralAmountOut,
    uint repaidAmountOut
  ) {
    require(msg.sender == controller.governance(), AppErrors.GOVERNANCE_ONLY);

    // update internal debts and get actual amount to repay
    IPoolAdapter pa = IPoolAdapter(poolAdapter_);
    (,address user,, address borrowAsset) = pa.getConfig();
    pa.updateStatus();
    (collateralAmountOut, repaidAmountOut,,,) = pa.getStatus();

    require(
      collateralAmountOut != 0 && repaidAmountOut != 0,
      AppErrors.REPAY_FAILED
    );

    // ask the user for the amount-to-repay
    uint balanceBefore = IERC20(borrowAsset).balanceOf(address(this));
    ITetuConverterCallback(user).requirePayAmountBack(borrowAsset, repaidAmountOut);
    uint balanceAfter = IERC20(borrowAsset).balanceOf(address(this));

    // ensure that we have received full required amount
    if (closePosition) {
      require(balanceAfter == balanceBefore + repaidAmountOut, AppErrors.WRONG_AMOUNT_RECEIVED);
    } else {
      require(balanceAfter > balanceBefore, AppErrors.ZERO_BALANCE);
      repaidAmountOut = balanceAfter - balanceBefore;
    }

    // make full repay and close the position

    // replaced by infinity approve: IERC20(borrowAsset).safeApprove(address(pa), repaidAmountOut);
    collateralAmountOut = pa.repay(repaidAmountOut, user, closePosition);
    emit OnRepayTheBorrow(poolAdapter_, collateralAmountOut, repaidAmountOut);

    return (collateralAmountOut, repaidAmountOut);
  }

  ///////////////////////////////////////////////////////
  ///       Get debt/repay info
  ///////////////////////////////////////////////////////

  /// @notice Update status in all opened positions
  ///         After this call getDebtAmount will be able to return exact amount to repay
  /// @param user_ user whose debts will be returned
  /// @return totalDebtAmountOut Borrowed amount that should be repaid to pay off the loan in full
  /// @return totalCollateralAmountOut Amount of collateral that should be received after paying off the loan
  function getDebtAmountCurrent(
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external override nonReentrant returns (
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) {
    address[] memory poolAdapters = debtMonitor.getPositions(
      user_,
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

  /// @notice Total amount of borrow tokens that should be repaid to close the borrow completely.
  /// @dev Actual debt amount can be a little LESS then the amount returned by this function.
  ///      I.e. AAVE's pool adapter returns (amount of debt + tiny addon ~ 1 cent)
  ///      The addon is required to workaround dust-tokens problem.
  ///      After repaying the remaining amount is transferred back on the balance of the caller strategy.
  /// @param user_ user whose debts will be returned
  /// @return totalDebtAmountOut Borrowed amount that should be repaid to pay off the loan in full
  /// @return totalCollateralAmountOut Amount of collateral that should be received after paying off the loan
  function getDebtAmountStored(
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external view override returns (
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) {
    address[] memory poolAdapters = debtMonitor.getPositions(
      user_,
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

  /// @notice User needs to redeem some collateral amount. Calculate an amount of borrow token that should be repaid
  /// @param collateralAmountToRedeem_ Amount of collateral required by the user
  /// @return borrowAssetAmount Borrowed amount that should be repaid to receive back following amount of collateral:
  ///                           amountToReceive = collateralAmountRequired_ - unobtainableCollateralAssetAmount
  /// @return unobtainableCollateralAssetAmount A part of collateral that cannot be obtained in any case
  ///                                           even if all borrowed amount will be returned.
  ///                                           If this amount is not 0, you ask to get too much collateral.
  function estimateRepay(
    address user_,
    address collateralAsset_,
    uint collateralAmountToRedeem_,
    address borrowAsset_
  ) external view override returns (
    uint borrowAssetAmount,
    uint unobtainableCollateralAssetAmount
  ) {
    address[] memory poolAdapters = debtMonitor.getPositions(
      user_,
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

  /// @notice Transfer all reward tokens to {receiver_}
  /// @return rewardTokensOut What tokens were transferred. Same reward token can appear in the array several times
  /// @return amountsOut Amounts of transferred rewards, the array is synced with {rewardTokens}
  function claimRewards(address receiver_) external override nonReentrant returns (
    address[] memory rewardTokensOut,
    uint[] memory amountsOut
  ) {
    // The sender is able to claim his own rewards only, so no need to check sender
    address[] memory poolAdapters = debtMonitor.getPositionsForUser(msg.sender);

    uint lenPoolAdapters = poolAdapters.length;
    address[] memory rewardTokens = new address[](lenPoolAdapters);
    uint[] memory amounts = new uint[](lenPoolAdapters);
    uint countPositions = 0;
    for (uint i = 0; i < lenPoolAdapters; i = i.uncheckedInc()) {
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      (rewardTokens[countPositions], amounts[countPositions]) = pa.claimRewards(receiver_);
      if (amounts[countPositions] != 0) {
        emit OnClaimRewards(address(pa), rewardTokens[countPositions], amounts[countPositions], receiver_);
        ++countPositions;
      }
    }

    if (countPositions != 0) {
      rewardTokensOut = AppUtils.removeLastItems(rewardTokens, countPositions);
      amountsOut = AppUtils.removeLastItems(amounts, countPositions);
    }

    return (rewardTokensOut, amountsOut);
  }

  ///////////////////////////////////////////////////////
  ///       Simulate swap
  ///////////////////////////////////////////////////////

  /// @notice Transfer {sourceAmount_} approved by {sourceAmountApprover_} to swap manager
  function onRequireAmountBySwapManager(
    address sourceAmountApprover_,
    address sourceToken_,
    uint sourceAmount_
  ) external override {
    require(address(swapManager) == msg.sender, AppErrors.ONLY_SWAP_MANAGER);

    if (sourceAmountApprover_ == address(this)) {
      IERC20(sourceToken_).safeTransfer(address(swapManager), sourceAmount_);
    } else {
      IERC20(sourceToken_).safeTransferFrom(sourceAmountApprover_, address(swapManager), sourceAmount_);
    }
  }

  ///////////////////////////////////////////////////////
  ///       Liquidate with checking
  ///////////////////////////////////////////////////////

  /// @notice Swap {amountIn_} of {assetIn_} to {assetOut_} and send result amount to {receiver_}
  ///         The swapping is made using TetuLiquidator with checking price impact using embedded price oracle.
  /// @param amountIn_ Amount of {assetIn_} to be swapped.
  ///                      It should be transferred on balance of the TetuConverter before the function call
  /// @param receiver_ Result amount will be sent to this address
  /// @param priceImpactToleranceSource_ Price impact tolerance for liquidate-call, decimals = 100_000
  /// @param priceImpactToleranceTarget_ Price impact tolerance for price-oracle-check, decimals = 100_000
  /// @return amountOut The amount of {assetOut_} that has been sent to the receiver
  function safeLiquidate(
    address assetIn_,
    uint amountIn_,
    address assetOut_,
    address receiver_,
    uint priceImpactToleranceSource_,
    uint priceImpactToleranceTarget_
  ) override external returns (
    uint amountOut
  ) { // there are no restrictions for the msg.sender, anybody can make liquidation
    ITetuLiquidator tetuLiquidator = ITetuLiquidator(controller.tetuLiquidator());
    uint targetTokenBalanceBefore = IERC20(assetOut_).balanceOf(address(this));

    IERC20(assetIn_).safeApprove(address(tetuLiquidator), amountIn_);
    tetuLiquidator.liquidate(assetIn_, assetOut_, amountIn_, priceImpactToleranceSource_);

    amountOut = IERC20(assetOut_).balanceOf(address(this)) - targetTokenBalanceBefore;
    IERC20(assetOut_).safeTransfer(receiver_, amountOut);
    // The result amount shouldn't be too different from the value calculated directly using price oracle prices
    require(
      SwapLib.isConversionValid(
        priceOracle,
        assetIn_,
        amountIn_,
        assetOut_,
        amountOut,
        priceImpactToleranceTarget_
      ),
      AppErrors.TOO_HIGH_PRICE_IMPACT
    );
    emit OnSafeLiquidate(assetIn_, amountIn_, assetOut_, receiver_, amountOut);
  }

  /// @notice Check if {amountOut_} is too different from the value calculated directly using price oracle prices
  /// @return Price difference is ok for the given {priceImpactTolerance_}
  function isConversionValid(
    address assetIn_,
    uint amountIn_,
    address assetOut_,
    uint amountOut_,
    uint priceImpactTolerance_
  ) external override view returns (bool) {
    return SwapLib.isConversionValid(
      priceOracle,
      assetIn_,
      amountIn_,
      assetOut_,
      amountOut_,
      priceImpactTolerance_
    );
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
