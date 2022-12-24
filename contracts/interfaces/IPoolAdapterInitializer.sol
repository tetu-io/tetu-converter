// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

/// @notice Initializer suitable for most pool-adapters
interface IPoolAdapterInitializer {
  function initialize(
    address controller,
    address pool_,
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    address originConveter_
  ) external;
}
