// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/DataTypes.sol";
import "../interfaces/IPriceOracle.sol";

contract PriceOracleMock is IPriceOracle {
  /// how much 1 token costs in USD, decimals 18
  mapping(address => uint256) public prices;

  constructor(address[] memory assets, uint[] memory pricesInUSD) {
    _changePrices(assets, pricesInUSD);
  }
  ///////////////////////////////////////////////////////
  ///           Set up
  ///////////////////////////////////////////////////////
  function changePrices(address[] memory assets, uint[] memory pricesInUSD) external {
    _changePrices(assets, pricesInUSD);
  }

  function _changePrices(address[] memory assets, uint[] memory pricesInUSD) internal {
    require(assets.length == pricesInUSD.length, "wrong lengths");
    for (uint i = 0; i < assets.length; ++i) {
      prices[assets[i]] = pricesInUSD[i];
    }
  }

  ///////////////////////////////////////////////////////
  ///           IPriceOracle
  ///////////////////////////////////////////////////////

  /// @notice Return asset price in USD, decimals 18
  function getAssetPrice(address asset) external view override returns (uint256) {
    return prices[asset];
  }

  /// @notice Return a price of one dollar in required tokens
  /// @return Price of 1 USD in given token, decimals 18
  function getUsdPrice(address asset) external view override returns (uint256) {
    return 1e18 * 1e18 / prices[asset];
  }

}