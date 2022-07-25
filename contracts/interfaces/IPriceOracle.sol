// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

interface IPriceOracle {
  /// @notice Return a price of one dollar in required tokens
  /// @return Price of 1 USD in given token, decimals 18
  function getUsdPrice(address asset) external view returns (uint256);

  /// @notice Return asset price in USD, decimals 18
  function getAssetPrice(address asset) external view returns (uint256);
}