// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

contract CompoundPriceOracleMock {
  mapping(address => uint) internal _prices;

  function setUnderlyingPrice(address cToken, uint price) external {
    _prices[cToken] = price;
  }

  /// @notice Get the underlying price of a cToken asset
  /// @param cToken The cToken to get the underlying price of
  /// @return The underlying asset price mantissa (scaled by 1e18).
  ///  Zero means the price is unavailable.
  function getUnderlyingPrice(address cToken) external view returns (uint256) {
    return _prices[cToken];
  }

  //region ---------------------------------------- Support of IPriceOracle
  // The same contract is used in tests as PriceOracle in TetuConverter

  /// @notice Return asset price in USD, decimals 18
  function setAssetPrice(address asset, uint price) external {
    _prices[asset] = price;
  }

  function getAssetPrice(address asset) external view returns (uint256) {
    return _prices[asset];
  }

  //endregion ---------------------------------------- Support of IPriceOracle
}