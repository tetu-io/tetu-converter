// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";
import "../interfaces/IPlatformAdapter.sol";
import "hardhat/console.sol";
import "./PoolAdapterMock.sol";

contract LendingPlatformMock is IPlatformAdapter {
  address private _pool;
  address private _converter;
  address private _controller;
  /// @notice asset => liquidation threshold18
  mapping(address => uint256) public liquidationThresholds18;
  address private _priceOracle;

  /// @notice underline => borrowRates
  mapping(address => uint256) public borrowRates;
  /// @notice underline => liquidity
  mapping(address => uint256) public liquidity;
  /// @notice underline => cToken
  mapping(address => address) public cTokens;

  constructor(
    address controller_,
    address pool_,
    address converter_,
    address[] memory underlines_,
    uint[] memory liquidationThresholds18_,
    uint[] memory borrowRates_,
    uint[] memory liquidity_,
    address[] memory cTokens_,
    address priceOracle_
  ) {
    console.log("LendingPlatformMock converter=%s pool=%s", converter_, pool_);
    console.log("LendingPlatformMock this=%s", address(this));
    _pool = pool_;
    _converter = converter_;
    _controller = controller_;
    _priceOracle = priceOracle_;

    for (uint i = 0; i < underlines_.length; ++i) {
      liquidationThresholds18[underlines_[i]] = liquidationThresholds18_[i];
      borrowRates[underlines_[i]] = borrowRates_[i];
      liquidity[underlines_[i]] = liquidity_[i];
      cTokens[underlines_[i]] = cTokens_[i];

      console.log("LendingPlatformMock underline=%s", underlines_[i]);
      console.log("liquidationThreshold18=%d", liquidationThresholds18_[i]);
      console.log("borrowRate=%d", borrowRates_[i]);
      console.log("liquidity=%d", liquidity_[i]);
      console.log("cTokens=%s", cTokens_[i]);
    }
  }

  function getConversionPlan (
    address collateralAsset_,
    address borrowAsset_,
    uint borrowAmountFactor //TODO
  ) external view override returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    return AppDataTypes.ConversionPlan({
      converter: _converter,
      liquidationThreshold18: liquidationThresholds18[collateralAsset_],
      aprPerBlock18: borrowRates[borrowAsset_],
      ltv18: liquidationThresholds18[collateralAsset_],
      maxAmountToBorrowBT: liquidity[borrowAsset_],
      maxAmountToSupplyCT: type(uint).max
    });
  }

  function converters() external view override returns (address[] memory) {
    address[] memory dest = new address[](1);
    dest[0] = _converter;
    return dest;
  }

  /// @notice Returns the prices of the supported assets in BASE_CURRENCY of the market. Decimals 18
  /// @dev Different markets can have different BASE_CURRENCY
  function getAssetsPrices(address[] calldata assets_) external view override returns (uint[] memory prices18) {
    IPriceOracle p = IPriceOracle(_priceOracle);

    uint lenAssets = assets_.length;
    prices18 = new uint[](lenAssets);
    for (uint i = 0; i < lenAssets; i++) {
      prices18[i] = p.getAssetPrice(assets_[i]);
    }

    return prices18;
  }

  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external override {
    console.log("initializePoolAdapter %s", poolAdapter_);
    PoolAdapterMock(poolAdapter_).initialize(
      _controller,
      _pool,
      user_,
      collateralAsset_,
      borrowAsset_,
      converter_,

      cTokens[collateralAsset_],
      liquidationThresholds18[collateralAsset_],
      borrowRates[borrowAsset_],
      _priceOracle
    );
  }

  function changeBorrowRate(address asset_, uint borrowRate_) external {
    borrowRates[asset_] = borrowRate_;
  }

  function getBorrowRateAfterBorrow(address borrowAsset_, uint amountToBorrow_) external view override returns (uint) {
    return 0;
  }
}