// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice Restored from 0x0229f777b0fab107f9591a41d5f02e4e98db6f2d (events were removed)
interface IAaveTwoPriceOracle {
  function WETH() external view returns (address);

  /// @notice Gets an asset price by address
  /// @param asset The asset address
  function getAssetPrice(address asset) external view returns (uint256);

  /// @notice Gets a list of prices from a list of assets addresses
  /// @param assets The list of assets addresses
  function getAssetsPrices(address[] memory assets) external view returns (uint256[] memory);

  /// @notice Gets the address of the fallback oracle
  /// @return address The addres of the fallback oracle
  function getFallbackOracle() external view returns (address);
  function setFallbackOracle(address fallbackOracle) external;

  function getSourceOfAsset(address asset) external view returns (address);
  function setAssetSources(address[] memory assets, address[] memory sources) external;

  function transferOwnership(address newOwner) external;
  function owner() external view returns (address);
  function renounceOwnership() external;
}
