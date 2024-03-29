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
import "../openzeppelin/Math.sol";
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
import "../proxy/ControllableV3.sol";
import "../libs/ConverterLogicLib.sol";
import "../libs/TetuConverterLogicLib.sol";

/// @notice Main application contract
contract TetuConverter is ControllableV3, ITetuConverter, IKeeperCallback, IRequireAmountBySwapManagerCallback, ReentrancyGuard {
  using SafeERC20 for IERC20;
  using AppUtils for uint;

  //region ----------------------------------------------------- Constants
  string public constant TETU_CONVERTER_VERSION = "1.1.0";
  /// @notice After additional borrow result health factor should be near to target value, the difference is limited.
  uint constant public ADDITIONAL_BORROW_DELTA_DENOMINATOR = 1;
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Data types
  struct RepayLocal {
    address[] poolAdapters;
    uint len;
    uint debtGap;
    IPoolAdapter pa;
    uint totalDebtForPoolAdapter;
    bool debtGapRequired;
    IConverterController controller;
  }

  /// @notice Local vars for {findConversionStrategy}
  struct FindConversionStrategyLocal {
    address[] borrowConverters;
    address user;
    address swapConverter;
    IBorrowManager borrowManager;
    uint[] borrowSourceAmounts;
    uint[] borrowTargetAmounts;
    int[] borrowAprs18;
    uint swapSourceAmount;
    uint swapTargetAmount;
    int swapApr18;
  }
  //endregion ----------------------------------------------------- Data types

  //region ----------------------------------------------------- Events
  event OnSwap(address signer, address converter, address sourceAsset, uint sourceAmount, address targetAsset, address receiver, uint targetAmountOut);
  event OnBorrow(address poolAdapter, uint collateralAmount, uint amountToBorrow, address receiver, uint borrowedAmountOut);
  event OnRepayBorrow(address poolAdapter, uint amountToRepay, address receiver, bool closePosition);

  /// @notice A part of target amount cannot be repaid or swapped
  ///         so it was just returned back to receiver as is
  event OnRepayReturn(address asset, address receiver, uint amount);
  event OnClaimRewards(address poolAdapter, address rewardsToken, uint amount, address receiver);
  event OnRepayTheBorrow(address poolAdapter, uint collateralOut, uint repaidAmountOut);
  event OnSalvage(address receiver, address token, uint amount);
  //endregion ----------------------------------------------------- Events

  //region ----------------------------------------------------- Initialization
  function init(address controller_) external initializer {
    __Controllable_init(controller_);
  }
  //endregion ----------------------------------------------------- Initialization

  //region ----------------------------------------------------- Access
  function _getControllerWhitelistedOnly() internal view returns (IConverterController controllerOut) {
    controllerOut = IConverterController(controller());
    require(controllerOut.isWhitelisted(msg.sender), AppErrors.OUT_OF_WHITE_LIST);
  }

  function _getControllerGovernanceOnly() internal view returns (IConverterController controllerOut) {
    controllerOut = IConverterController(controller());
    require(msg.sender == controllerOut.governance(), AppErrors.GOVERNANCE_ONLY);
  }
  //endregion ----------------------------------------------------- Access

  //region ----------------------------------------------------- Find best strategy for conversion

  /// @inheritdoc ITetuConverter
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

    IConverterController _controller = _getControllerWhitelistedOnly();

    FindConversionStrategyLocal memory p;
    if (!_controller.paused()) {
      p.borrowManager = IBorrowManager(_controller.borrowManager());

      // little gas optimization: skip any checking of exist debts if the user doesn't have any debts at all
      p.user = _controller.rebalanceOnBorrowEnabled()
        && IDebtMonitor(_controller.debtMonitor()).getPositions(msg.sender, sourceToken_, targetToken_).length != 0
        ? msg.sender
        : address(0);

      (p.borrowConverters,
        p.borrowSourceAmounts,
        p.borrowTargetAmounts,
        p.borrowAprs18
      ) = p.borrowManager.findConverter(entryData_, p.user, sourceToken_, targetToken_, amountIn_, periodInBlocks_);

      (p.swapConverter,
        p.swapSourceAmount,
        p.swapTargetAmount,
        p.swapApr18) = _findSwapStrategy(_controller, entryData_, sourceToken_, amountIn_, targetToken_);
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

  /// @inheritdoc ITetuConverter
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

    IConverterController _controller = IConverterController(controller());
    if (_controller.paused()) {
      return (converters, collateralAmountsOut, amountToBorrowsOut, aprs18); // no conversion is available
    } else {
    // little gas optimization: skip any checking of exist debts if the user doesn't have any debts at all
      address user = _controller.rebalanceOnBorrowEnabled()
        && IDebtMonitor(_controller.debtMonitor()).getPositions(msg.sender, sourceToken_, targetToken_).length != 0
        ? msg.sender
        : address(0);

      IBorrowManager borrowManager = IBorrowManager(_controller.borrowManager());
      return borrowManager.findConverter(entryData_, user, sourceToken_, targetToken_, amountIn_, periodInBlocks_);
    }
  }

  /// @inheritdoc ITetuConverter
  function findSwapStrategy(bytes memory entryData_, address sourceToken_, uint amountIn_, address targetToken_) external override returns (
    address converter,
    uint sourceAmountOut,
    uint targetAmountOut,
    int apr18
  ) {
    require(amountIn_ != 0, AppErrors.ZERO_AMOUNT);

    IConverterController _controller = _getControllerWhitelistedOnly();
    return _controller.paused()
      ? (converter, sourceAmountOut, targetAmountOut, apr18) // no conversion is available
      : _findSwapStrategy(_controller, entryData_, sourceToken_, amountIn_, targetToken_);
  }

  /// @notice Calculate amount to swap according to the given {entryData_} and estimate result amount of {targetToken_}
  function _findSwapStrategy(
    IConverterController controller_,
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

    ISwapManager swapManager = ISwapManager(controller_.swapManager());
    (converter, targetAmountOut) = swapManager.getConverter(msg.sender, sourceToken_, sourceAmountOut, targetToken_);
    if (converter != address(0)) {
      apr18 = swapManager.getApr18(sourceToken_, sourceAmountOut, targetToken_, targetAmountOut);
    }

    return (converter, sourceAmountOut, targetAmountOut, apr18);
  }
  //endregion ----------------------------------------------------- Find best strategy for conversion

  //region ----------------------------------------------------- Make conversion, open position

  /// @inheritdoc ITetuConverter
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
    IConverterController _controller = _getControllerWhitelistedOnly();
    require(receiver_ != address(0) && converter_ != address(0), AppErrors.ZERO_ADDRESS);
    require(collateralAmount_ != 0 && amountToBorrow_ != 0, AppErrors.ZERO_AMOUNT);

    IERC20(collateralAsset_).safeTransferFrom(msg.sender, address(this), collateralAmount_);
    IBorrowManager borrowManager = IBorrowManager(_controller.borrowManager());

    AppDataTypes.ConversionKind conversionKind = IConverter(converter_).getConversionKind();
    if (conversionKind == AppDataTypes.ConversionKind.BORROW_2) {
      // get exist or register new pool adapter
      address poolAdapter = borrowManager.getPoolAdapter(converter_, msg.sender, collateralAsset_, borrowAsset_);

      if (poolAdapter != address(0)) {
        (,, uint healthFactor18,,,) = IPoolAdapter(poolAdapter).getStatus();
        ConverterLogicLib.HealthStatus status = ConverterLogicLib.getHealthStatus(healthFactor18, _controller.minHealthFactor2());
        if (status == ConverterLogicLib.HealthStatus.DIRTY_1) {
          // the pool adapter is unhealthy, we should mark it as dirty and create new pool adapter for the borrow
          borrowManager.markPoolAdapterAsDirty(converter_, msg.sender, collateralAsset_, borrowAsset_);
          poolAdapter = address(0);
        }
      }

      // create new pool adapter if we don't have ready-to-borrow one
      if (poolAdapter == address(0)) {
        poolAdapter = borrowManager.registerPoolAdapter(converter_, msg.sender, collateralAsset_, borrowAsset_);

        // TetuConverter doesn't keep assets on its balance, so it's safe to use infinity approve
        IERC20(collateralAsset_).safeApprove(poolAdapter, 2 ** 255); // 2*255 is more gas-efficient than type(uint).max
        IERC20(borrowAsset_).safeApprove(poolAdapter, 2 ** 255); // 2*255 is more gas-efficient than type(uint).max
      }

      // borrow target-amount and transfer borrowed amount to the receiver, infinity approve is assumed
      borrowedAmountOut = IPoolAdapter(poolAdapter).borrow(collateralAmount_, amountToBorrow_, receiver_);
      emit OnBorrow(poolAdapter, collateralAmount_, amountToBorrow_, receiver_, borrowedAmountOut);
    } else if (conversionKind == AppDataTypes.ConversionKind.SWAP_1) {
      require(converter_ == _controller.swapManager(), AppErrors.INCORRECT_CONVERTER_TO_SWAP);
      borrowedAmountOut = _makeSwap(converter_, collateralAsset_, collateralAmount_, borrowAsset_, receiver_);
    } else {
      revert(AppErrors.UNSUPPORTED_VALUE);
    }
  }

  /// @notice Transfer {sourceAmount_} to swap-converter, make swap, return result target amount
  function _makeSwap(address swapConverter, address sourceAsset_, uint amountIn, address targetAsset_, address receiver_) internal returns (
    uint amountOut
  ) {
    IERC20(sourceAsset_).safeTransfer(swapConverter, amountIn);
    amountOut = ISwapConverter(swapConverter).swap(sourceAsset_, amountIn, targetAsset_, receiver_);
    emit OnSwap(msg.sender, swapConverter, sourceAsset_, amountIn, targetAsset_, receiver_, amountOut);
  }
  //endregion ----------------------------------------------------- Make conversion, open position

  //region ----------------------------------------------------- Make repay, close position

  /// @inheritdoc ITetuConverter
  function repay(address collateralAsset_, address borrowAsset_, uint amountToRepay_, address receiver_) external override nonReentrant returns (
    uint collateralAmountOut,
    uint returnedBorrowAmountOut,
    uint swappedLeftoverCollateralOut,
    uint swappedLeftoverBorrowOut
  ) {
    RepayLocal memory v;

    v.controller = _getControllerWhitelistedOnly();
    require(receiver_ != address(0), AppErrors.ZERO_ADDRESS);

    // ensure that we have received required amount
    require(amountToRepay_ <= IERC20(borrowAsset_).balanceOf(address(this)), AppErrors.WRONG_AMOUNT_RECEIVED);

    // we will decrease amountToRepay_ in the code (to avoid creation additional variable)
    // it shows how much is left to convert from borrow asset to collateral asset

    // we need to repay exact amount using any pool adapters; simplest strategy: use first available pool adapter
    v.poolAdapters = IDebtMonitor(v.controller.debtMonitor()).getPositions(msg.sender, collateralAsset_, borrowAsset_);
    v.len = v.poolAdapters.length;
    v.debtGap = v.controller.debtGap();

    // at first repay debts for any opened positions, repay don't make any rebalancing here
    for (uint i; i < v.len; i = i.uncheckedInc()) {
      if (amountToRepay_ == 0) break;
      v.pa = IPoolAdapter(v.poolAdapters[i]);
      v.pa.updateStatus();

      (, v.totalDebtForPoolAdapter,,,, v.debtGapRequired) = v.pa.getStatus();

      if (v.totalDebtForPoolAdapter == 0) {
        // remove empty adapters
        IDebtMonitor(v.controller.debtMonitor()).closeLiquidatedPosition(v.poolAdapters[i]);
        continue;
      }

      if (v.debtGapRequired) {
        // we assume here, that amountToRepay_ includes all required dept-gaps
        v.totalDebtForPoolAdapter = TetuConverterLogicLib.getAmountWithDebtGap(v.totalDebtForPoolAdapter, v.debtGap);
      }
      uint amountToPayToPoolAdapter = amountToRepay_ >= v.totalDebtForPoolAdapter
        ? v.totalDebtForPoolAdapter
        : amountToRepay_;

      // make repayment, assume infinity approve: IERC20(borrowAsset_).safeApprove(address(pa), amountToPayToPoolAdapter);
      bool closePosition = amountToPayToPoolAdapter == v.totalDebtForPoolAdapter;
      collateralAmountOut += v.pa.repay(amountToPayToPoolAdapter, receiver_, closePosition);
      amountToRepay_ -= amountToPayToPoolAdapter;

      emit OnRepayBorrow(address(v.pa), amountToPayToPoolAdapter, receiver_, closePosition);
    }

    // if all debts were paid but we still have some amount of borrow asset
    // let's swap it to collateral asset and send to collateral-receiver
    if (amountToRepay_ > 0) {
      // getConverter requires the source amount be approved to TetuConverter, but a contract doesn't need to approve itself
      (address converter,) = ISwapManager(v.controller.swapManager()).getConverter(address(this), borrowAsset_, amountToRepay_, collateralAsset_);

      if (converter == address(0) || amountToRepay_ < 1000) {
        // there is no swap-strategy to convert remain {amountToPay} to {collateralAsset_}
        // or the amount is too small to be swapped
        // let's return this amount back to the {receiver_}

        // SCB-710: returnedBorrowAmountOut should not take into account dust amounts
        //          to avoid revert in _closePositionExact
        if (amountToRepay_ >= 1000) {
          returnedBorrowAmountOut = amountToRepay_;
        }
        IERC20(borrowAsset_).safeTransfer(receiver_, amountToRepay_);
        emit OnRepayReturn(borrowAsset_, receiver_, amountToRepay_);
      } else {
        // conversion strategy is found, let's convert all remaining {amountToPay} to {collateralAsset}
        swappedLeftoverCollateralOut = _makeSwap(converter, borrowAsset_, amountToRepay_, collateralAsset_, receiver_);
        swappedLeftoverBorrowOut = amountToRepay_;

        collateralAmountOut += swappedLeftoverCollateralOut;
      }
    }

    return (collateralAmountOut, returnedBorrowAmountOut, swappedLeftoverCollateralOut, swappedLeftoverBorrowOut);
  }

  /// @inheritdoc ITetuConverter
  function quoteRepay(address user_, address collateralAsset_, address borrowAsset_, uint amountToRepay_) external override returns (
    uint collateralAmountOut,
    uint swappedAmountOut
  ) {
    IConverterController _controller = _getControllerWhitelistedOnly();

    address[] memory poolAdapters = IDebtMonitor(_controller.debtMonitor()).getPositions(user_, collateralAsset_, borrowAsset_);
    uint len = poolAdapters.length;
    for (uint i; i < len; i = i.uncheckedInc()) {
      if (amountToRepay_ == 0) break;

      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      pa.updateStatus();

      // debt-gaps are not taken into account here because getCollateralAmountToReturn doesn't take it into account
      (, uint totalDebtForPoolAdapter,,,,) = pa.getStatus();

      bool closePosition = totalDebtForPoolAdapter <= amountToRepay_;
      uint currentAmountToRepay = closePosition ? totalDebtForPoolAdapter : amountToRepay_;
      uint collateralAmountToReceive = pa.getCollateralAmountToReturn(currentAmountToRepay, closePosition);

      amountToRepay_ -= currentAmountToRepay;
      collateralAmountOut += collateralAmountToReceive;
    }

    if (amountToRepay_ > 0) {
      IPriceOracle priceOracle = IPriceOracle(_controller.priceOracle());
      uint priceBorrowAsset = priceOracle.getAssetPrice(borrowAsset_);
      uint priceCollateralAsset = priceOracle.getAssetPrice(collateralAsset_);
      require(priceCollateralAsset != 0 && priceBorrowAsset != 0, AppErrors.ZERO_PRICE);

      swappedAmountOut = amountToRepay_
        * 10 ** IERC20Metadata(collateralAsset_).decimals()
        * priceBorrowAsset
        / priceCollateralAsset
        / 10 ** IERC20Metadata(borrowAsset_).decimals();
    }

    return (collateralAmountOut + swappedAmountOut, swappedAmountOut);
  }
  //endregion ----------------------------------------------------- Make repay, close position

  //region ----------------------------------------------------- IKeeperCallback, close borrow forcibly

  /// @inheritdoc IKeeperCallback
  function requireRepay(
    uint requiredBorrowedAmount_,
    uint requiredCollateralAmount_,
    address poolAdapter_
  ) external
  // not nonReentrant: nested repay() calls are possible
  override {
    IConverterController _controller = IConverterController(controller());

    require(_controller.keeper() == msg.sender, AppErrors.KEEPER_ONLY);
    require(requiredBorrowedAmount_ != 0, AppErrors.INCORRECT_VALUE);

    TetuConverterLogicLib.requireRepay(_controller, requiredBorrowedAmount_, requiredCollateralAmount_, poolAdapter_);
  }

  /// @inheritdoc ITetuConverter
  function repayTheBorrow(address poolAdapter_, bool closePosition)
  external
    // not nonReentrant: nested repay() calls are possible
  returns (
    uint collateralAmountOut,
    uint repaidAmountOut
  ) {
    IConverterController _controller = _getControllerGovernanceOnly();
    return TetuConverterLogicLib.repayTheBorrow(_controller, poolAdapter_, closePosition);
  }
  //endregion ----------------------------------------------------- IKeeperCallback, close borrow forcibly

  //region ----------------------------------------------------- Get debt/repay info

  /// @inheritdoc ITetuConverter
  /// @dev nonReentrant is not used because: requireRepay(nonReentrant) => ... => getDebtAmountCurrent(), see SCB-746
  function getDebtAmountCurrent(address user_, address collateralAsset_, address borrowAsset_, bool useDebtGap_) external override /* nonReentrant */ returns (
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) {
    IConverterController _controller = _getControllerWhitelistedOnly();

    address[] memory poolAdapters = IDebtMonitor(_controller.debtMonitor()).getPositions(user_, collateralAsset_, borrowAsset_);
    uint len = poolAdapters.length;

    uint debtGap = useDebtGap_ ? _controller.debtGap() : 0;

    for (uint i; i < len; i = i.uncheckedInc()) {
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      pa.updateStatus();
      (totalDebtAmountOut, totalCollateralAmountOut) = _addDebtAmounts(pa, totalDebtAmountOut, totalCollateralAmountOut, debtGap);
    }

    return (totalDebtAmountOut, totalCollateralAmountOut);
  }

  /// @inheritdoc ITetuConverter
  function getDebtAmountStored(address user_, address collateralAsset_, address borrowAsset_, bool useDebtGap_) external view override returns (
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) {
    IConverterController _controller = IConverterController(controller());

    address[] memory poolAdapters = IDebtMonitor(_controller.debtMonitor()).getPositions(user_, collateralAsset_, borrowAsset_);
    uint len = poolAdapters.length;

    uint debtGap = useDebtGap_ ? _controller.debtGap() : 0;

    for (uint i; i < len; i = i.uncheckedInc()) {
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      (totalDebtAmountOut, totalCollateralAmountOut) = _addDebtAmounts(pa, totalDebtAmountOut, totalCollateralAmountOut, debtGap);
    }

    return (totalDebtAmountOut, totalCollateralAmountOut);
  }

  /// @notice A function to reduce contract size (shared code from getDebtAmountCurrent and getDebtAmountStored)
  function _addDebtAmounts(IPoolAdapter pa, uint amountDebt_, uint collateralAmount_, uint debtGap) internal view returns (
    uint debtAmountOut,
    uint collateralAmountOut
  ) {
    (uint collateralAmount, uint totalDebtForPoolAdapter,,,, bool debtGapRequired) = pa.getStatus();
    debtAmountOut = amountDebt_ + (
      (debtGap != 0 && debtGapRequired)
        ? TetuConverterLogicLib.getAmountWithDebtGap(totalDebtForPoolAdapter, debtGap)
        : totalDebtForPoolAdapter
    );
    collateralAmountOut = collateralAmount_ + collateralAmount;
  }

  /// @inheritdoc ITetuConverter
  function estimateRepay(address user_, address collateralAsset_, uint collateralAmountToRedeem_, address borrowAsset_) external view override returns (
    uint borrowAssetAmount,
    uint unobtainableCollateralAssetAmount
  ) {
    IConverterController _controller = IConverterController(controller());

    address[] memory poolAdapters = IDebtMonitor(_controller.debtMonitor()).getPositions(user_, collateralAsset_, borrowAsset_);
    uint len = poolAdapters.length;

    uint collateralAmountRemained = collateralAmountToRedeem_;
    for (uint i; i < len; i = i.uncheckedInc()) {
      if (collateralAmountRemained == 0) break;

      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      (uint collateralAmount, uint borrowedAmount,,,,bool debtGapRequired) = pa.getStatus();
      if (debtGapRequired) {
        borrowedAmount = TetuConverterLogicLib.getAmountWithDebtGap(borrowedAmount, _controller.debtGap());
      }

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

  /// @inheritdoc ITetuConverter
  function getPositions(address user_, address collateralToken_, address borrowedToken_) external view returns (
    address[] memory poolAdaptersOut
  ) {
    return IDebtMonitor(IConverterController(controller()).debtMonitor()).getPositions(user_, collateralToken_, borrowedToken_);
  }
  //endregion ----------------------------------------------------- Get debt/repay info

  //region ----------------------------------------------------- Check and claim rewards

  /// @inheritdoc ITetuConverter
  function claimRewards(address receiver_) external override nonReentrant returns (
    address[] memory rewardTokensOut,
    uint[] memory amountsOut
  ) {
    // The sender is able to claim his own rewards only, so no need to check sender
    address[] memory poolAdapters = IDebtMonitor(IConverterController(controller()).debtMonitor()).getPositionsForUser(msg.sender);

    uint len = poolAdapters.length;
    address[] memory rewardTokens = new address[](len);
    uint[] memory amounts = new uint[](len);
    uint countPositions = 0;
    for (uint i; i < len; i = i.uncheckedInc()) {
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

  /// @inheritdoc ITetuConverter
  function salvage(address receiver, address token, uint amount) external {
    _getControllerGovernanceOnly();

    IERC20(token).safeTransfer(receiver, amount);
    emit OnSalvage(receiver, token, amount);
  }

  //endregion ----------------------------------------------------- Check and claim rewards

  //region ----------------------------------------------------- Simulate swap

  /// @notice Transfer {sourceAmount_} approved by {approver_} to swap manager
  function onRequireAmountBySwapManager(address approver_, address sourceToken_, uint sourceAmount_) external override {
    address swapManager = IConverterController(controller()).swapManager();
    require(swapManager == msg.sender, AppErrors.ONLY_SWAP_MANAGER);

    if (approver_ == address(this)) {
      IERC20(sourceToken_).safeTransfer(swapManager, sourceAmount_);
    } else {
      IERC20(sourceToken_).safeTransferFrom(approver_, swapManager, sourceAmount_);
    }
  }
  //endregion ----------------------------------------------------- Simulate swap

  //region ----------------------------------------------------- Liquidate with checking

  /// @inheritdoc ITetuConverter
  function safeLiquidate(
    address assetIn_,
    uint amountIn_,
    address assetOut_,
    address receiver_,
    uint priceImpactToleranceSource_,
    uint priceImpactToleranceTarget_
  ) override external returns (
    uint amountOut
  ) {
    IConverterController _controller = _getControllerWhitelistedOnly();
    return TetuConverterLogicLib.safeLiquidate(
      _controller,
      assetIn_,
      amountIn_,
      assetOut_,
      receiver_,
      priceImpactToleranceSource_,
      priceImpactToleranceTarget_
    );
  }

  /// @inheritdoc ITetuConverter
  function isConversionValid(
    address assetIn_,
    uint amountIn_,
    address assetOut_,
    uint amountOut_,
    uint priceImpactTolerance_
  ) external override view returns (bool) {
    return SwapLib.isConversionValid(
      IPriceOracle(IConverterController(controller()).priceOracle()),
      assetIn_,
      amountIn_,
      assetOut_,
      amountOut_,
      priceImpactTolerance_
    );
  }
  //endregion ----------------------------------------------------- Liquidate with checking

}

