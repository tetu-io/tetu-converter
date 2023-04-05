// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

/// @notice Initializer for pool-adapters with rewards contract address
interface IPoolAdapterInitializerWithRewards {

  function initialize(
    address controller_,
    address pool_,
    address rewards_,
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    address originConverter_
  ) external;
}
