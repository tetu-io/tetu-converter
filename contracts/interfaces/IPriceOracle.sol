// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

interface IPriceOracle {
  /// @notice Return asset price in USD, decimals 18
  function getAssetPrice(address asset) external view returns (uint256);
}