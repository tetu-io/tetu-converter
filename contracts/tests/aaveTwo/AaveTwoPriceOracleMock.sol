// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../interfaces/IChangePriceForTests.sol";
import "../interfaces/IChangePriceForTests.sol";
import "../../integrations/aaveTwo/IAaveTwoPriceOracle.sol";
import "hardhat/console.sol";

contract AaveTwoPriceOracleMock is IAaveTwoPriceOracle, IChangePriceForTests {
  address private _owner;
  address private _weth;
  address private _fallbackOracle;
  mapping(address => address) private _sources;
  mapping(address => uint) private _prices;

  constructor(
    address owner_,
    address weth_,
    address fallbackOracle_
  ) {
    _owner = owner_;
    _fallbackOracle = fallbackOracle_;
    _weth = weth_;
  }

  //-----------------------------------------------------//////////
  ///                   Setup prices
  //-----------------------------------------------------//////////
  function setPrices(address[] memory assets_, uint[] memory values_) external {
    for (uint i = 0; i < assets_.length; ++i) {
      console.log("Set price", assets_[i], values_[i]);
      _prices[assets_[i]] = values_[i];
    }
  }

  //-----------------------------------------------------//////////
  ///                 IChangePriceForTests
  //-----------------------------------------------------//////////

  /// @notice Take exist price of the asset and multiple it on (multiplier100_/100)
  function changePrice(address asset_, uint multiplier100_) external {
    _prices[asset_] = multiplier100_ * _prices[asset_] / 100;
    console.log("AAVETwoPriceOracleMock changePrice", asset_, _prices[asset_], multiplier100_);
  }

  //-----------------------------------------------------//////////
  ///                 IAaveTwoPriceOracle
  //-----------------------------------------------------//////////

    function WETH() external view override returns (address) {
      return _weth;
    }
  /**
   * @notice Returns the asset price in the base currency
   * @param asset The address of the asset
   * @return The price of the asset
   **/
  function getAssetPrice(address asset) external view override returns (uint256) {
    console.log("getAssetPrice", asset, _prices[asset]);
    return _prices[asset];
  }
  /**
   * @notice Returns a list of prices from a list of assets addresses
   * @param assets The list of assets addresses
   * @return The prices of the given assets
   */
  function getAssetsPrices(address[] memory assets) external view override returns (uint256[] memory) {
    uint[] memory dest = new uint[](assets.length);
    for (uint i = 0; i < assets.length; ++i) {
      console.log("getAssetsPrices", assets[i], _prices[assets[i]]);
      dest[i] = _prices[assets[i]];
    }
    return dest;
  }
  /**
   * @notice Returns the address of the fallback oracle
   * @return The address of the fallback oracle
   */
  function getFallbackOracle() external view override returns (address) {
    return _fallbackOracle;
  }
  /**
   * @notice Returns the address of the source for an asset address
   * @param asset The address of the asset
   * @return The address of the source
   */
  function getSourceOfAsset(address asset) external view override returns (address) {
    return _sources[asset];
  }
  function setAssetSources(address[] memory assets, address[] memory sources) external override {
    for (uint i = 0; i < assets.length; ++i) {
      _sources[assets[i]] = sources[i];
    }
  }

  function setFallbackOracle(address fallbackOracle) external override {
    _fallbackOracle = fallbackOracle;
  }

  function transferOwnership(address newOwner) external override {}
  function renounceOwnership() external override {}
  function owner() external view override returns (address) {
    return _owner;
  }

}
