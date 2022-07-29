// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../../interfaces/IPlatformAdapter.sol";
import "../../../openzeppelin/SafeERC20.sol";
import "../../../openzeppelin/IERC20.sol";
import "hardhat/console.sol";

/// @notice Adapter to read current pools info from HundredFinance-protocol, see https://docs.hundred.finance/
contract HundredFinancePlatformAdapter is IPlatformAdapter {
  using SafeERC20 for IERC20;

  function getConversionPlan (
    address collateralAsset_,
    address borrowAsset_
  ) external override view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    //TODO
    return plan;
  }

  /// @notice Full list of supported converters
  function converters() external view override returns (address[] memory outConverters) {
    return outConverters; //TODO
  }

  /// @notice Initialize {poolAdapter_} created from {converter_} using minimal proxy pattern
  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external override {
    //TODO
  }
}