// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../libs/SwapLib.sol";

/// @notice Direct access to internal functions of SwapLib
contract SwapLibFacade {
  function convertUsingPriceOracle(
    IPriceOracle priceOracle_,
    address assetIn_,
    uint amountIn_,
    address assetOut_
  ) external view returns (uint) {
    return SwapLib.convertUsingPriceOracle(priceOracle_, assetIn_, amountIn_, assetOut_);
  }

  function isConversionValid(
    IPriceOracle priceOracle_,
    address assetIn_,
    uint amountIn_,
    address assetOut_,
    uint amountOut_,
    uint priceImpactTolerance_
  ) external view returns (bool) {
    return SwapLib.isConversionValid(priceOracle_, assetIn_, amountIn_, assetOut_, amountOut_, priceImpactTolerance_);
  }
}