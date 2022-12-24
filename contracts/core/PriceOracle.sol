// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../interfaces/IPriceOracle.sol";
import "../integrations/aave3/IAavePriceOracle.sol";

/// @notice Trivial implementation of a price oracle as a wrapper of AAVE3 price oracle
contract PriceOracle is IPriceOracle {
  address public constant AAVE3_PRICE_ORACLE = 0xb023e699F5a33916Ea823A16485e259257cA8Bd1;
  IAavePriceOracle immutable _priceOracle;

  constructor() {
    _priceOracle = IAavePriceOracle(AAVE3_PRICE_ORACLE);
  }

  /// @notice Return asset price in USD, decimals 18
  function getAssetPrice(address asset) external view override returns (uint256) {
    // AAVE3 price oracle returns price with decimals 1e8, we need decimals 18
    try _priceOracle.getAssetPrice(asset) returns (uint value) {
      return value * 1e10;
    } catch {}

    return 0; // unknown asset or unknown price
  }
}
