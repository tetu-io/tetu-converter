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

/// @notice Main application contract
contract TetuConverter is ITetuConverter {
  using SafeERC20 for IERC20;

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

  function findConversionStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint periodInBlocks_,
    uint8 conversionKind
  ) external view override returns (
    address converter,
    uint maxTargetAmount,
    int aprForPeriod36
  ) {
    return _findConversionStrategy(sourceToken_,
      sourceAmount_,
      targetToken_,
      periodInBlocks_,
      AppDataTypes.ConversionKind(conversionKind)
    );
  }

  /// @param periodInBlocks_ how long you want hold targetToken. When 0 - always borrows, when uint.max - always swaps
  function _findConversionStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint periodInBlocks_,
    AppDataTypes.ConversionKind conversionKind
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

    if (conversionKind == AppDataTypes.ConversionKind.SWAP_1) {
      // get swap
      return _swapManager().getConverter(params);
    } else if (conversionKind == AppDataTypes.ConversionKind.BORROW_2) {
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
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_
) external override {
    _convert(converter_, sourceToken_, sourceAmount_, targetToken_, targetAmount_, receiver_, msg.sender);
  }

  function _convert(
    address converter_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_,
    address collateralProvider_
  ) internal {
    if (IConverter(converter_).getConversionKind() == AppDataTypes.ConversionKind.BORROW_2) {
      // make borrow

      // get exist or register new pool adapter
      address poolAdapter = _borrowManager().getPoolAdapter(converter_, msg.sender, sourceToken_, targetToken_);
      if (poolAdapter == address(0)) {
        poolAdapter = _borrowManager().registerPoolAdapter(
          converter_,
          msg.sender,
          sourceToken_,
          targetToken_
        );
      }
      require(poolAdapter != address(0), AppErrors.POOL_ADAPTER_NOT_FOUND);

      // transfer the collateral from the user directly to the pool adapter; assume, that the transfer is approved
      IPoolAdapter(poolAdapter).syncBalance(true);
      if (collateralProvider_ == address(this)) {
        IERC20(sourceToken_).transfer(poolAdapter, sourceAmount_);
      } else {
        IERC20(sourceToken_).transferFrom(collateralProvider_, poolAdapter, sourceAmount_);
      }
      // borrow target-amount and transfer borrowed amount to the receiver
      IPoolAdapter(poolAdapter).borrow(sourceAmount_, targetAmount_, receiver_);

    } if (IConverter(converter_).getConversionKind() == AppDataTypes.ConversionKind.SWAP_1) {
      IERC20(sourceToken_).transfer(converter_, sourceAmount_);
      // TODO move to fn params
      // Bogdoslav: I guess better do that after merge -
      // because _convert function params could be changed
      // and tests should be fixed
      ISwapConverter(converter_).swap(
        sourceToken_,
        sourceAmount_,
        targetToken_,
        targetAmount_,
        receiver_
      );

    }

    revert(AppErrors.UNSUPPORTED_CONVERSION_KIND);
  }

  ///////////////////////////////////////////////////////
  ///       Make repay, close position
  ///////////////////////////////////////////////////////

  function repay(
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_,
    address collateralReceiver_,
    address poolAdapterOptional_
  ) external override {
    // TODO
    collateralAsset_;
    borrowAsset_;
    amountToRepay_;
    collateralReceiver_;
    poolAdapterOptional_;
  }

  /// @notice Calculate total amount of borrow tokens that should be repaid to close the loan completely.
  function getAmountToRepay(
    address collateralAsset_,
    address borrowAsset_
  ) external view override returns (uint) {
    // TODO
    collateralAsset_;
    borrowAsset_;
    return 0;
  }

  /// @notice User needs to redeem some collateral amount. Calculate an amount that should be repaid
  function estimateRepay(
    address collateralAsset_,
    uint collateralAmountToRedeem_,
    address borrowAsset_
  ) external view override returns (uint) {
    // TODO
    collateralAsset_;
    collateralAmountToRedeem_;
    borrowAsset_;
    return 0;
  }

  ///////////////////////////////////////////////////////
  ///       Check and claim rewards
  ///////////////////////////////////////////////////////

  /// @notice Check if any reward tokens exist on the balance of the pool adapter
  function checkRewards() external view override returns (
    address[] memory rewardTokens,
    uint[] memory amounts
  ) {
    // TODO
    return (rewardTokens, amounts);
  }

  /// @notice Transfer all given reward tokens to {receiver_}
  function claimRewards(
    address receiver_,
    address[] memory rewardTokens_
  ) external override {
    // TODO
    receiver_;
    rewardTokens_;
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
      AppDataTypes.ConversionKind.UNKNOWN_0
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
