// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";

/// @notice A lending platform (AAVE, HF, etc). Allow to work with comptroller and any pool of the platform.
interface IPlatformAdapter2 {

  /// @notice Get pool data required to select best lending pool
  function getPoolInfo (
    address collateralAsset_,
    address borrowAsset_
  ) external view returns (
    AppDataTypes.ConversionPlan memory plan
  );
}
