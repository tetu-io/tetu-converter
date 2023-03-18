// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./AppErrors.sol";
import "../openzeppelin/IERC20Metadata.sol";
import "../interfaces/IPriceOracle.sol";

/// @notice Various swap-related routines
library SwapLib {
  uint public constant PRICE_IMPACT_NUMERATOR = 100_000;
  uint public constant PRICE_IMPACT_TOLERANCE_DEFAULT = PRICE_IMPACT_NUMERATOR * 2 / 100; // 2%


  /// @notice Convert amount of {assetIn_} to the corresponded amount of {assetOut_} using price oracle prices
  /// @return Result amount in terms of {assetOut_}
  function convertUsingPriceOracle(
    IPriceOracle priceOracle_,
    address assetIn_,
    uint amountIn_,
    address assetOut_
  ) internal view returns (uint) {
    uint priceOut = priceOracle_.getAssetPrice(assetOut_);
    uint priceIn = priceOracle_.getAssetPrice(assetIn_);
    require(priceOut != 0 && priceIn != 0, AppErrors.ZERO_PRICE);

    return amountIn_
      * 10**IERC20Metadata(assetOut_).decimals()
      * priceIn
      / priceOut
      / 10**IERC20Metadata(assetIn_).decimals();
  }

  /// @notice Check if {amountOut_} is less than expected more than allowed by {priceImpactTolerance_}
  ///         Expected amount is calculated using embedded price oracle.
  /// @return Price difference is ok for the given {priceImpactTolerance_}
  function isConversionValid(
    IPriceOracle priceOracle_,
    address assetIn_,
    uint amountIn_,
    address assetOut_,
    uint amountOut_,
    uint priceImpactTolerance_
  ) internal view returns (bool) {
    uint priceOut = priceOracle_.getAssetPrice(assetOut_);
    uint priceIn = priceOracle_.getAssetPrice(assetIn_);
    require(priceOut != 0 && priceIn != 0, AppErrors.ZERO_PRICE);

    uint expectedAmountOut = amountIn_
      * 10**IERC20Metadata(assetOut_).decimals()
      * priceIn
      / priceOut
      / 10**IERC20Metadata(assetIn_).decimals();
    return (amountOut_ > expectedAmountOut
      ? 0 // we assume here, that higher output amount is not a problem
      : expectedAmountOut - amountOut_
    ) <= expectedAmountOut * priceImpactTolerance_ / SwapLib.PRICE_IMPACT_NUMERATOR;
  }
}