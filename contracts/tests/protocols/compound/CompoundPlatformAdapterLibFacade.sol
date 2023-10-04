// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../protocols/compound/CompoundAprLib.sol";
import "../../../protocols/compound/CompoundPlatformAdapterLib.sol";

/// @notice Facade for CompoundAprLib to make external functions available for tests
contract CompoundPlatformAdapterLibFacade {
  CompoundPlatformAdapterLib.State internal _state;

  function setState(
    address controller,
    address comptroller,
    address converter,
    bool frozen,
    address[] memory tokens,
    address[] memory cTokens
  ) external {
    _state.controller = IConverterController(controller);
    _state.comptroller = ICompoundComptrollerBase(comptroller);
    _state.converter = converter;
    _state.frozen = frozen;
    for (uint i = 0; i < tokens.length; ++i) {
      _state.activeAssets[tokens[i]] = cTokens[i];
    }
  }

  function getState() external view returns (
    address controller,
    address comptroller,
    address converter,
    bool frozen
  ) {
    return (
      address(_state.controller),
      address(_state.comptroller),
      address(_state.converter),
      _state.frozen
    );
  }

  function getActiveAsset(address underlying) external view returns (address cToken) {
    return _state.activeAssets[underlying];
  }

  function init (
    CompoundLib.ProtocolFeatures memory f_,
    address controller_,
    address comptroller_,
    address templatePoolAdapter_,
    address[] memory activeCTokens_
  ) external {
    CompoundPlatformAdapterLib.init(
      _state,
      f_,
      controller_,
      comptroller_,
      templatePoolAdapter_,
      activeCTokens_
    );
  }

  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external {
    CompoundPlatformAdapterLib.initializePoolAdapter(
      _state,
      converter_,
      poolAdapter_,
      user_,
      collateralAsset_,
      borrowAsset_
    );
  }

  function setFrozen(bool frozen_) external {
    CompoundPlatformAdapterLib.setFrozen(_state, frozen_);
  }

  function registerCTokens(
    CompoundLib.ProtocolFeatures memory f_,
    address[] memory cTokens_
  ) external {
    return CompoundPlatformAdapterLib.registerCTokens(_state, f_, cTokens_);
  }

  function _registerCTokens(
    CompoundLib.ProtocolFeatures memory f_,
    address[] memory cTokens_
  ) external {
    return CompoundPlatformAdapterLib._registerCTokens(_state, f_, cTokens_);
  }

  function getCTokenByUnderlying(address token1_, address token2_) external view returns (
    address cToken1,
    address cToken2
  ) {
    return CompoundPlatformAdapterLib.getCTokenByUnderlying(_state, token1_, token2_);
  }

  function getConversionPlan (
    CompoundLib.ProtocolFeatures memory f_,
    AppDataTypes.InputConversionParams memory p_,
    uint16 healthFactor2_
  ) external view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    return CompoundPlatformAdapterLib.getConversionPlan(_state, f_, p_, healthFactor2_);
  }

  function getBorrowRateAfterBorrow(
    address borrowAsset_,
    uint amountToBorrow_
  ) external view returns (uint) {
    return CompoundPlatformAdapterLib.getBorrowRateAfterBorrow(_state, borrowAsset_, amountToBorrow_);
  }

  function getMarketsInfo(
    CompoundLib.ProtocolFeatures memory f_,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) external view returns (
    uint ltv18,
    uint liquidityThreshold18
  ) {
    return CompoundPlatformAdapterLib.getMarketsInfo(_state, f_, cTokenCollateral_, cTokenBorrow_);
  }

//region ----------------------------------- getConversionPlan implementation

  function reduceAmountsByMax(
    AppDataTypes.ConversionPlan memory plan,
    uint collateralAmount_,
    uint amountToBorrow_
  ) external pure returns (
    uint collateralAmount,
    uint amountToBorrow
  ) {
    return CompoundPlatformAdapterLib.reduceAmountsByMax(plan, collateralAmount_, amountToBorrow_);
  }

  function getValuesForApr(
    AppDataTypes.ConversionPlan memory plan_,
    CompoundLib.ProtocolFeatures memory f_,
    CompoundPlatformAdapterLib.ConversionPlanLocal memory v_,
    AppDataTypes.InputConversionParams memory p_,
    AppDataTypes.PricesAndDecimals memory pd_
  ) external view returns (
    uint borrowCost36,
    uint supplyIncomeInBorrowAsset36,
    uint amountCollateralInBorrowAsset36
  ) {
    return CompoundPlatformAdapterLib.getValuesForApr(plan_, f_, v_, p_, pd_);
  }

  function getMaxAmountToBorrow(CompoundPlatformAdapterLib.ConversionPlanLocal memory v) external view returns (uint maxAmountToBorrow) {
    return CompoundPlatformAdapterLib.getMaxAmountToBorrow(v);
  }

  function _initConversionPlanLocal(
    AppDataTypes.InputConversionParams memory p_,
    CompoundPlatformAdapterLib.ConversionPlanLocal memory dest
  ) external view returns (bool, CompoundPlatformAdapterLib.ConversionPlanLocal memory) {
    bool ret = CompoundPlatformAdapterLib._initConversionPlanLocal(_state, p_, dest);
    return (ret, dest);
  }

  function _initPricesAndDecimals(
    AppDataTypes.PricesAndDecimals memory dest,
    address collateralAsset,
    address borrowAsset,
    CompoundPlatformAdapterLib.ConversionPlanLocal memory vars
  ) external view returns (AppDataTypes.PricesAndDecimals memory) {
    CompoundPlatformAdapterLib._initPricesAndDecimals(dest, collateralAsset, borrowAsset, vars);
    return dest;
  }

  function getAmountsForEntryKind(
    AppDataTypes.InputConversionParams memory p_,
    uint liquidationThreshold18,
    uint16 healthFactor2_,
    AppDataTypes.PricesAndDecimals memory pd,
    bool priceDecimals36
  ) external pure returns (
    uint collateralAmount,
    uint amountToBorrow
  ) {
    return CompoundPlatformAdapterLib.getAmountsForEntryKind(p_, liquidationThreshold18, healthFactor2_, pd, priceDecimals36);
  }
//endregion ----------------------------------- getConversionPlan implementation
}
