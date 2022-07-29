// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Initializer suitable for most pool-adapters
interface IPoolAdapterInitializer {
  function initialize(
    address pool_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external;
}