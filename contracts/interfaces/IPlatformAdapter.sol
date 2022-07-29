// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";

/// @notice Adapter for Dex/lending platform attached to the given platform's pool.
interface IPlatformAdapter {

  /// @notice Get pool data required to select best lending pool
  function getConversionPlan (
    address collateralAsset_,
    address borrowAsset_
  ) external view returns (
    AppDataTypes.ConversionPlan memory plan
  );

  /// @notice Full list of supported converters
  function converters() external view returns (address[] memory);

  /// @notice Initialize {poolAdapter_} created from {converter_} using minimal proxy pattern
  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external;
}
