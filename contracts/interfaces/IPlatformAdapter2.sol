// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";

/// @notice Adapter for Dex/lending platform attached to the given platform's pool.
interface IPlatformAdapter2 {

  /// @notice Get pool data required to select best lending pool
  function getPoolInfo (
    address collateralAsset_,
    address borrowAsset_
  ) external view returns (
    AppDataTypes.ConversionPlan memory plan
  );

  /// @notice Full list of supported converters
  ///         Lending platform: converter is template-lending-pool-adapter
  ///         DEX platform: converter is dex-pool-adapter
  function converters() external view returns (address[] memory);

  function isLendingPlatform() external view returns (bool);
}
