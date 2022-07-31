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
  /// @notice asset => cf
  mapping(address => uint256) public collateralFactors;

  /// @notice underline => borrowRates
  mapping(address => uint256) public borrowRates;
  /// @notice underline => liquidity
  mapping(address => uint256) public liquidity;

  constructor(
    address controller_,
    address pool_,
    address converter_,
    address[] memory underlines_,
    uint[] memory collateralFactors_,
    uint[] memory borrowRates_,
    uint[] memory liquidity_
  ) {
    console.log("LendingPlatformMock converter=%s pool=%s", converter_, pool_);
    console.log("LendingPlatformMock this=%s", address(this));
    _pool = pool_;
    _converter = converter_;
    _controller = controller_;

    for (uint i = 0; i < underlines_.length; ++i) {
      collateralFactors[underlines_[i]] = collateralFactors_[i];
      borrowRates[underlines_[i]] = borrowRates_[i];
      liquidity[underlines_[i]] = liquidity_[i];

      console.log("LendingPlatformMock underline=%s", underlines_[i]);
      console.log("collateralFactor=%d", collateralFactors_[i]);
      console.log("borrowRate=%d", borrowRates_[i]);
      console.log("liquidity=%d", liquidity_[i]);
    }
  }

  function getConversionPlan (
    address collateralAsset_,
    address borrowAsset_
  ) external view override returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    return AppDataTypes.ConversionPlan({
      converter: _converter,
      borrowRateKind: AppDataTypes.BorrowRateKind.PER_BLOCK_1,
      collateralFactorWAD: collateralFactors[borrowAsset_],
      borrowRate: borrowRates[borrowAsset_],
      ltvWAD: collateralFactors[borrowAsset_],
      maxAmountToBorrowBT: liquidity[borrowAsset_],
      maxAmountToSupplyCT: 0
    });
  }

  function converters() external view override returns (address[] memory) {
    address[] memory dest = new address[](1);
    dest[0] = _converter;
    return dest;
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
      borrowAsset_
    );
  }
}