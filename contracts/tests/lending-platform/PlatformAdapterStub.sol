// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../../libs/AppDataTypes.sol";
import "../../interfaces/IPlatformAdapter.sol";

/// @notice Return predefined list of converters
contract PlatformAdapterStub {
  string public constant PLATFORM_ADAPTER_VERSION = "1.0.0";

  address[] _converters;
  constructor (address[] memory converters_) {
    for (uint i = 0; i < converters_.length; ++i) {
      _converters.push(converters_[i]);
    }
  }
  function converters() external view returns (address[] memory) {
    return _converters;
  }

  function getConversionPlan (
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint16 healthFactor2_,
    uint countBlocks_
  ) external pure returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    collateralAsset_;
    collateralAmount_;
    borrowAsset_;
    healthFactor2_;
    countBlocks_;

    return plan;
  }

  function getAssetsPrices(address[] calldata assets_) external pure returns (uint[] memory prices18){
    assets_;
    return prices18;
  }

  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external pure {
    converter_;
    poolAdapter_;
    user_;
    collateralAsset_;
    borrowAsset_;
  }

  function getBorrowRateAfterBorrow(address borrowAsset_, uint amountToBorrow_) external pure returns (uint) {
    borrowAsset_;
    amountToBorrow_;

    return 0;
  }
}

