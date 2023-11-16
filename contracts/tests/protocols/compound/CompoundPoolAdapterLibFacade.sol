// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../protocols/compound/CompoundAprLib.sol";
import "../../../protocols/compound/CompoundPoolAdapterLib.sol";
import "./CompoundLibFacade.sol";

/// @notice Facade for CompoundAprLib to make external functions available for tests
contract CompoundPoolAdapterLibFacade {
  //region -------------------------------------------------------- State
  CompoundPoolAdapterLib.State internal _state;
  CompoundLib.ProtocolFeatures public _f;

  function setProtocolFeatures(CompoundLib.ProtocolFeatures memory f_) external {
    _f = f_;
  }

  function setState(
    address collateralAsset,
    address borrowAsset,
    address collateralCToken,
    address borrowCToken,
    address user,
    IConverterController controller,
    ICompoundComptrollerBase comptroller,
    address originConverter,
    uint collateralTokensBalance
  ) external {
    _state = CompoundPoolAdapterLib.State({
      collateralAsset: collateralAsset,
      borrowAsset: borrowAsset,
      collateralCToken: collateralCToken,
      borrowCToken: borrowCToken,
      user: user,
      controller: controller,
      comptroller: comptroller,
      originConverter: originConverter,
      collateralTokensBalance: collateralTokensBalance
    });
  }

  function getState() external view returns (
    address collateralAsset,
    address borrowAsset,
    address collateralCToken,
    address borrowCToken,
    address user,
    IConverterController controller,
    ICompoundComptrollerBase comptroller,
    address originConverter,
    uint collateralTokensBalance
  ) {
    return (
      _state.collateralAsset,
      _state.borrowAsset,
      _state.collateralCToken,
      _state.borrowCToken,
      _state.user,
      _state.controller,
      _state.comptroller,
      _state.originConverter,
      _state.collateralTokensBalance
    );
  }
  //endregion -------------------------------------------------------- State

  //region -------------------------------------------------------- CompoundPoolAdapterLib

  function initialize(
    address controller_,
    address cTokenAddressProvider_,
    address comptroller_,
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    address originConverter_
  ) external {
    return CompoundPoolAdapterLib.initialize(
      _state,
      controller_,
      cTokenAddressProvider_,
      comptroller_,
      user_,
      collateralAsset_,
      borrowAsset_,
      originConverter_
    );
  }

  function updateStatus() external {
    CompoundPoolAdapterLib.updateStatus(_state);
  }

  function borrow(uint collateralAmount_, uint borrowAmount_, address receiver_) external returns (uint) {
    return CompoundPoolAdapterLib.borrow(_state, _f, collateralAmount_, borrowAmount_, receiver_);
  }

  function _supply(address cTokenCollateral_, uint collateralAmount_) external returns (uint) {
    return CompoundPoolAdapterLib._supply(_f, cTokenCollateral_, collateralAmount_);
  }

  function _validateHealthStatusAfterBorrow(
    IConverterController controller_,
    ICompoundComptrollerBase comptroller_,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) external view returns (uint, uint) {
    return CompoundPoolAdapterLib._validateHealthStatusAfterBorrow(_f, controller_, comptroller_, cTokenCollateral_, cTokenBorrow_);
  }

  function borrowToRebalance(uint borrowAmount_, address receiver_) external view returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {
    return CompoundPoolAdapterLib.borrowToRebalance(_state, _f, borrowAmount_, receiver_);
  }

  function repay(uint amountToRepay_, address receiver_, bool closePosition_) external returns (uint) {
    return CompoundPoolAdapterLib.repay(_state, _f, amountToRepay_, receiver_, closePosition_);
  }

  function _getCollateralTokensToRedeem(
    CompoundPoolAdapterLib.AccountData memory data,
    bool closePosition_,
    uint amountToRepay_
  ) external pure returns (
    uint collateralTokenToRedeem
  ) {
    return CompoundPoolAdapterLib._getCollateralTokensToRedeem(data, closePosition_, amountToRepay_);
  }

  function repayToRebalance(uint amount_, bool isCollateral_) external returns (uint resultHealthFactor18) {
    return CompoundPoolAdapterLib.repayToRebalance(_state, _f, amount_, isCollateral_);
  }

  function getCollateralAmountToReturn(uint amountToRepay_, bool closePosition_) external view returns (
    uint amountCollateralOut
  ) {
    return CompoundPoolAdapterLib.getCollateralAmountToReturn(_state, amountToRepay_, closePosition_);
  }

  function getStatus() external view returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated,
    bool debtGapRequired
  ) {
    return CompoundPoolAdapterLib.getStatus(_state, _f);
  }

  /// @dev This function is required in Bookkeeper-related tests: onRepay and onBorrow can call getConfig on the caller
  function getConfig() external view returns (
    address origin,
    address outUser,
    address outCollateralAsset,
    address outBorrowAsset
  ) {
    return (_state.originConverter, _state.user, _state.collateralAsset, _state.borrowAsset);
  }

  function _getHealthFactor(uint collateralFactor, uint collateralAmountBase_, uint borrowAmountBase_) external pure returns (
    uint collateralAmountBaseSafeToUse,
    uint healthFactor18
  ) {
    return CompoundPoolAdapterLib._getHealthFactor(collateralFactor, collateralAmountBase_, borrowAmountBase_);
  }

  function _getCollateralFactor(
    ICompoundComptrollerBase comptroller_,
    address cTokenCollateral_
  ) external view returns (
    uint collateralFactor
  ) {
    return CompoundPoolAdapterLib._getCollateralFactor(_f, comptroller_, cTokenCollateral_);
  }

  function _validateHealthFactor(IConverterController controller_, uint healthFactorAfter, uint healthFactorBefore)
  external view {
    return CompoundPoolAdapterLib._validateHealthFactor(controller_, healthFactorAfter, healthFactorBefore);
  }

  function _getBalance(address asset) external view returns (uint) {
    return CompoundPoolAdapterLib._getBalance(_f, asset);
  }

  function _getBaseAmounts(
    CompoundPoolAdapterLib.AccountData memory data,
    CompoundPoolAdapterLib.PricesData memory prices
  ) external pure returns (
    uint collateralBase,
    uint borrowBase
  ) {
    return CompoundPoolAdapterLib._getBaseAmounts(data, prices);
  }

  function _initAccountData(address cTokenCollateral, address cTokenBorrow) external view returns (
    CompoundPoolAdapterLib.AccountData memory dest
  ) {
    CompoundPoolAdapterLib._initAccountData(cTokenCollateral, cTokenBorrow, dest);
    return dest;
  }

  function _initPricesData(ICompoundComptrollerBase comptroller, address cTokenCollateral, address cTokenBorrow)
  external view returns (
    CompoundPoolAdapterLib.PricesData memory dest
  ) {
    CompoundPoolAdapterLib._initPricesData(comptroller, cTokenCollateral, cTokenBorrow, dest);
    return dest;
  }

  function _getAccountValues(
    CompoundLib.ProtocolFeatures memory f_,
    ICompoundComptrollerBase comptroller_,
    address cTokenCollateral_,
    CompoundPoolAdapterLib.AccountData memory data_,
    CompoundPoolAdapterLib.PricesData memory prices_
  ) external view returns (
    uint healthFactor18,
    uint collateralBase,
    uint safeDebtAmountBase,
    uint borrowBase
  ) {
    return CompoundPoolAdapterLib._getAccountValues(f_, comptroller_, cTokenCollateral_, data_, prices_);
  }
  //endregion -------------------------------------------------------- CompoundPoolAdapterLib
}