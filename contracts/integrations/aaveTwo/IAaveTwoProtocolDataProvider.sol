// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from 0x7551b5D2763519d4e37e8B81929D336De671d46d (TokenData was moved inside interface)
interface IAaveTwoProtocolDataProvider {
  struct TokenData {
    string symbol;
    address tokenAddress;
  }

  function ADDRESSES_PROVIDER() external view returns (address);

  function getAllATokens() external view returns (TokenData[] memory);
  function getAllReservesTokens() external view returns (TokenData[] memory);

  function getReserveConfigurationData(address asset)
  external
  view
  returns (
    uint256 decimals,
    uint256 ltv,
    uint256 liquidationThreshold,
    uint256 liquidationBonus,
    uint256 reserveFactor,
    bool usageAsCollateralEnabled,
    bool borrowingEnabled,
    bool stableBorrowRateEnabled,
    bool isActive,
    bool isFrozen
  );

  function getReserveData(address asset)
  external
  view
  returns (
    uint256 availableLiquidity,
    uint256 totalStableDebt,
    uint256 totalVariableDebt,
    uint256 liquidityRate,
    uint256 variableBorrowRate,
    uint256 stableBorrowRate,
    uint256 averageStableBorrowRate,
    uint256 liquidityIndex,
    uint256 variableBorrowIndex,
    uint40 lastUpdateTimestamp
  );

  function getReserveTokensAddresses(address asset)
  external
  view
  returns (
    address aTokenAddress,
    address stableDebtTokenAddress,
    address variableDebtTokenAddress
  );

  function getUserReserveData(address asset, address user)
  external
  view
  returns (
    uint256 currentATokenBalance,
    uint256 currentStableDebt,
    uint256 currentVariableDebt,
    uint256 principalStableDebt,
    uint256 scaledVariableDebt,
    uint256 stableBorrowRate,
    uint256 liquidityRate,
    uint40 stableRateLastUpdated,
    bool usageAsCollateralEnabled
  );
}
