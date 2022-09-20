// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";

/// @notice Adapter for lending platform attached to the given platform's pool.
interface IPlatformAdapter {

  /// @notice Get pool data required to select best lending pool
  /// @param collateralAmount_ Amount of collateral. We need it to calculate rewards and APRs correctly.
  /// @param borrowAmountFactor18_ Coefficient to calculate available borrow amount
  ///                              = 1e18 * sourceAmount18 * priceCollateral18 / (priceBorrow18 * healthFactor18)
  ///                              Here 18 means "decimals 18"
  ///                              Max borrow amount = borrowAmountFactor18 * liquidationThreshold / 1e18
  /// @param countBlocks_ Estimated period of the borrow in blocks.
  function getConversionPlan (
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint borrowAmountFactor18_,
    uint countBlocks_
  ) external view returns (
    AppDataTypes.ConversionPlan memory plan
  );

  /// @notice Full list of supported converters
  function converters() external view returns (address[] memory);

  /// @notice Initialize {poolAdapter_} created from {converter_} using minimal proxy pattern
  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external;

  /// @notice Returns the prices of the supported assets in BASE_CURRENCY of the market. Decimals 18
  /// @dev Different markets can have different BASE_CURRENCY
  function getAssetsPrices(address[] calldata assets) external view returns (uint[] memory prices18);

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  function getBorrowRateAfterBorrow(address borrowAsset_, uint amountToBorrow_) external view returns (uint);
}
