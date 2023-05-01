// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../../libs/AppDataTypes.sol";
import "../../libs/EntryKinds.sol";
import "../../interfaces/IPlatformAdapter.sol";
import "../../libs/AppUtils.sol";

contract LendingPlatformMock2 is IPlatformAdapter {
  using AppUtils for uint;
  string public constant override PLATFORM_ADAPTER_VERSION = "1.0.0";

  //-----------------------------------------------------
  // getConversionPlan
  //-----------------------------------------------------

  struct ConversionPlanParams {
    AppDataTypes.InputConversionParams params;
    AppDataTypes.ConversionPlan results;
  }
  ConversionPlanParams internal conversionPlanParams;

  function setupGetConversionPlan(AppDataTypes.InputConversionParams memory params, AppDataTypes.ConversionPlan memory results) external {
    conversionPlanParams = ConversionPlanParams({
      params: params,
      results: results
    });
  }

  function getConversionPlan(
    AppDataTypes.InputConversionParams memory params_,
    uint16 healthFactor2_
  ) external view override returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    healthFactor2_;
    if (
      params_.collateralAsset == conversionPlanParams.params.collateralAsset
      && params_.borrowAsset == conversionPlanParams.params.borrowAsset
    ) {
      plan = conversionPlanParams.results;
    }

    return plan;
  }

  //-----------------------------------------------------
  // converters
  //-----------------------------------------------------
  struct ConvertersParams {
    address[] converters;
  }
  ConvertersParams internal convertersParams;
  function setupConverters(address[] memory converters_) external {
    convertersParams = ConvertersParams({
    converters: converters_
    });
  }

  /// @notice Full list of supported converters
  function converters() external view returns (address[] memory) {
    return convertersParams.converters;
  }

  //-----------------------------------------------------
  // initializePoolAdapter
  //-----------------------------------------------------
  /// @notice Initialize {poolAdapter_} created from {converter_} using minimal proxy pattern
  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external pure {
    converter_;
    poolAdapter_;
    user_;
    collateralAsset_;
    borrowAsset_;
  }

  //-----------------------------------------------------
  // frozen
  //-----------------------------------------------------
  /// @notice True if the platform is frozen and new borrowing is not possible (at this moment)
  bool internal _frozen;
  function frozen() external view returns (bool) {
    return _frozen;
  }

  //-----------------------------------------------------
  // setFrozen
  //-----------------------------------------------------
  /// @notice Set platform to frozen/unfrozen state. In frozen state any new borrowing is forbidden.
  function setFrozen(bool frozen_) external {
    _frozen = frozen_;
  }

  function platformKind() external pure returns (AppDataTypes.LendingPlatformKinds) {
    return AppDataTypes.LendingPlatformKinds.UNKNOWN_0;
  }

}
