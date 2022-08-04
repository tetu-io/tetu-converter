// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Initializer for pool-adapters with AddressProvider
interface IPoolAdapterInitializerWithAP {

  /// @param cTokenAddressProvider_ This is ICTokenAddressProvider
  function initialize(
    address controller_,
    address cTokenAddressProvider_,
    address pool_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external;
}