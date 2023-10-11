// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface ICompoundPriceOracle {

  /// @notice Get the underlying price of a cToken asset
  /// @param cToken The cToken to get the underlying price of
  /// @return The underlying asset price mantissa. Decimals = [36 - decimals of the underlying]
  ///  Zero means the price is unavailable.
  function getUnderlyingPrice(address cToken) external view returns (uint256);
}