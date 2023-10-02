// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../protocols/compound/CompoundAprLib.sol";
import "../../protocols/compound/CompoundPlatformAdapterLib.sol";

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
    _state.comptroller = ICompoundComptrollerBase(controller);
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
}
