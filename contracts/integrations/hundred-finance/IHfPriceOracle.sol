// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from 0x0b510A226F4A7A66c480988704eCd5306B6f1954 (events removed)
interface IHfPriceOracle {
  function ethUsdChainlinkAggregatorAddress() external view returns (address);

  /**
    * @notice Get the underlying price of a cToken asset
      * @param cToken The cToken to get the underlying price of
      * @return The underlying asset price mantissa (scaled by 1e18).
      *  Zero means the price is unavailable.
      */
  function getUnderlyingPrice(address cToken) external view returns (uint256);

  /// @notice Indicator that this is a PriceOracle contract (for inspection)
  function isPriceOracle() external view returns (bool);
  function owner() external view returns (address);
  function renounceOwnership() external;
  function setEthUsdChainlinkAggregatorAddress(address addr) external;

  function setTokenConfigs(
    address[] memory cTokenAddress,
    address[] memory chainlinkAggregatorAddress,
    uint256[] memory chainlinkPriceBase,
    uint256[] memory underlyingTokenDecimals
  ) external;

  function tokenConfig(address)
  external
  view
  returns (
    address chainlinkAggregatorAddress,
    uint256 chainlinkPriceBase,
    uint256 underlyingTokenDecimals
  );

  function transferOwnership(address newOwner) external;
}

// THIS FILE WAS AUTOGENERATED FROM THE FOLLOWING ABI JSON:
/*
[{"inputs":[{"internalType":"address","name":"ethUsdChainlinkAggregatorAddress_","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"cTokenAddress","type":"address"},{"indexed":false,"internalType":"address","name":"chainlinkAggregatorAddress","type":"address"},{"indexed":false,"internalType":"uint256","name":"chainlinkPriceBase","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"underlyingTokenDecimals","type":"uint256"}],"name":"TokenConfigUpdated","type":"event"},{"inputs":[],"name":"ethUsdChainlinkAggregatorAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"contract CTokenInterface","name":"cToken","type":"address"}],"name":"getUnderlyingPrice","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"isPriceOracle","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"addr","type":"address"}],"name":"setEthUsdChainlinkAggregatorAddress","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address[]","name":"cTokenAddress","type":"address[]"},{"internalType":"address[]","name":"chainlinkAggregatorAddress","type":"address[]"},{"internalType":"uint256[]","name":"chainlinkPriceBase","type":"uint256[]"},{"internalType":"uint256[]","name":"underlyingTokenDecimals","type":"uint256[]"}],"name":"setTokenConfigs","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"tokenConfig","outputs":[{"internalType":"address","name":"chainlinkAggregatorAddress","type":"address"},{"internalType":"uint256","name":"chainlinkPriceBase","type":"uint256"},{"internalType":"uint256","name":"underlyingTokenDecimals","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"}]
*/
