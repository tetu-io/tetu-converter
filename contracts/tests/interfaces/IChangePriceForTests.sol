// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IChangePriceForTests {
  /// @notice Take exist price of the asset and multiple it on (multiplier100_/100)
  function changePrice(address asset_, uint multiplier100_) external;
}