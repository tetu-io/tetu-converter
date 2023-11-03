// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

contract PoolAdapterInitializerWithAPMock {
  address public controller;
  address public cTokenAddressProvider;
  address public pool;
  address public user;
  address public collateralAsset;
  address public borrowAsset;
  address public originConverter;

  /// @param cTokenAddressProvider_ This is ICTokenAddressProvider
  function initialize(
    address controller_,
    address cTokenAddressProvider_,
    address pool_,
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    address originConverter_
  ) external {
    controller = controller_;
    cTokenAddressProvider = cTokenAddressProvider_;
    pool = pool_;
    user = user_;
    collateralAsset = collateralAsset_;
    borrowAsset = borrowAsset_;
    originConverter = originConverter_;
  }
}
