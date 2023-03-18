// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../libs/AppErrors.sol";
import "../interfaces/IPriceOracle.sol";
import "../integrations/aave3/IAavePriceOracle.sol";

/// @notice Trivial implementation of a price oracle as a wrapper of AAVE3 price oracle
contract PriceOracle is IPriceOracle {
  IAavePriceOracle public immutable priceOracle;

  constructor(address aave3priceOracle_) {
    require(aave3priceOracle_ != address(0), AppErrors.ZERO_ADDRESS);
    priceOracle = IAavePriceOracle(aave3priceOracle_);
  }

  /// @notice Return asset price in USD, decimals 18
  function getAssetPrice(address asset) external view override returns (uint256) {
    // AAVE3 price oracle returns price with decimals 1e8, we need decimals 18
    try priceOracle.getAssetPrice(asset) returns (uint value) {
      return value * 1e10;
    } catch {}

    return 0; // unknown asset or unknown price
  }
}
