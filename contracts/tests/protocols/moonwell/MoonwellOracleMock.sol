// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IChangePriceForTests.sol";

/// @notice Replacement for the original Moonwell price oracle
contract MoonwellOracleMock is IChangePriceForTests {
  /// @notice cToken => price
  mapping(address => uint) public prices;

  /// @notice Take exist price of the asset and multiple it on (multiplier100_/100)
  function changePrice(address cToken_, uint multiplier100_) external {
    prices[cToken_] = multiplier100_ * prices[cToken_] / 100;
  }

  //region -------------------------------- Same set of functions as in the original Hundred Finance oracle
  function admin() external pure returns (address) {
    return 0x8b621804a7637b781e2BbD58e256a591F2dF7d51;
  }

  function assetPrices(address asset) external pure returns (uint256) {
    asset;
    return 0;
  }

  function getFeed(string memory /* symbol */) external pure returns (address) {
    return address(0);
  }

  function getUnderlyingPrice(address mToken) external view returns (uint256) {
    return prices[mToken];
  }

  function isPriceOracle() external pure returns (bool) {
    return true;
  }

  function nativeToken() external pure returns (bytes32) {
    return 0x6a79aceed0101d32d27cfac92136e9ad1aaf6c49082d6a2359a6ce0147ea50a9;
  }


  function setAdmin(address newAdmin) external pure {
    newAdmin;
    // no implemented
  }

  function setDirectPrice(address asset, uint256 price) external pure {
    asset;
    price;
  }

  function setFeed(string memory symbol, address feed) external pure {
    symbol;
    feed;
  }

  function setUnderlyingPrice(address mToken, uint256 underlyingPriceMantissa) external {
    prices[mToken] = underlyingPriceMantissa;
  }
  //endregion -------------------------------- Same set of functions as in the original Hundred Finance oracle
}

