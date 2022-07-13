// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/DataTypes.sol";
import "../interfaces/IPriceOracle.sol";

contract PriceOracleMock is IPriceOracle {
  mapping(address => uint256) public prices;

  constructor(address[] memory assets, uint[] memory pricesInUSD) {
    require(assets.length == pricesInUSD.length, "wrong lengths");
    for (uint i = 0; i < assets.length; ++i) {
      prices[assets[i]] = pricesInUSD[i];
    }
  }

  /// @notice Return asset price in USD, decimals 18
  function getAssetPrice(address asset) external view override returns (uint256) {
    return prices[asset];
  }

}