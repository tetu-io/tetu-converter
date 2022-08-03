// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IPriceOracle.sol";

contract PriceOracleStub is IPriceOracle {
  uint public priceValue;

  constructor(uint priceValue_) {
    priceValue = priceValue_;
  }
  function getAssetPrice(address) external view override returns (uint256) {
    return priceValue;
  }

  function getUsdPrice(address) external view override returns (uint256) {
    return 1e18 * 1e18 / priceValue;
  }

}