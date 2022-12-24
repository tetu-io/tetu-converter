// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice Restored from 0xd6fa681e22306b0f4e605b979b7c9a1dfa865ade (events were removed)
interface IAavePoolConigurator {
  function CONFIGURATOR_REVISION() external view returns (uint256);

  function configureReserveAsCollateral(
    address asset,
    uint256 ltv,
    uint256 liquidationThreshold,
    uint256 liquidationBonus
  ) external;

  function dropReserve(address asset) external;

  function initReserves(
    ConfiguratorInputTypes.InitReserveInput[] memory input
  ) external;

  function initialize(address provider) external;

  function setAssetEModeCategory(address asset, uint8 newCategoryId) external;

  function setBorrowCap(address asset, uint256 newBorrowCap) external;

  function setBorrowableInIsolation(address asset, bool borrowable) external;

  function setDebtCeiling(address asset, uint256 newDebtCeiling) external;

  function setEModeCategory(
    uint8 categoryId,
    uint16 ltv,
    uint16 liquidationThreshold,
    uint16 liquidationBonus,
    address oracle,
    string memory label
  ) external;

  function setLiquidationProtocolFee(address asset, uint256 newFee) external;

  function setPoolPause(bool paused) external;

  function setReserveActive(address asset, bool active) external;

  function setReserveBorrowing(address asset, bool enabled) external;

  function setReserveFactor(address asset, uint256 newReserveFactor) external;

  function setReserveFreeze(address asset, bool freeze) external;

  function setReserveInterestRateStrategyAddress(
    address asset,
    address newRateStrategyAddress
  ) external;

  function setReservePause(address asset, bool paused) external;

  function setReserveStableRateBorrowing(address asset, bool enabled)
  external;

  function setSiloedBorrowing(address asset, bool newSiloed) external;

  function setSupplyCap(address asset, uint256 newSupplyCap) external;

  function setUnbackedMintCap(address asset, uint256 newUnbackedMintCap)
  external;

  function updateAToken(ConfiguratorInputTypes.UpdateATokenInput memory input)
  external;

  function updateBridgeProtocolFee(uint256 newBridgeProtocolFee) external;

  function updateFlashloanPremiumToProtocol(
    uint128 newFlashloanPremiumToProtocol
  ) external;

  function updateFlashloanPremiumTotal(uint128 newFlashloanPremiumTotal)
  external;

  function updateStableDebtToken(
    ConfiguratorInputTypes.UpdateDebtTokenInput memory input
  ) external;

  function updateVariableDebtToken(
    ConfiguratorInputTypes.UpdateDebtTokenInput memory input
  ) external;
}

interface ConfiguratorInputTypes {
  struct InitReserveInput {
    address aTokenImpl;
    address stableDebtTokenImpl;
    address variableDebtTokenImpl;
    uint8 underlyingAssetDecimals;
    address interestRateStrategyAddress;
    address underlyingAsset;
    address treasury;
    address incentivesController;
    string aTokenName;
    string aTokenSymbol;
    string variableDebtTokenName;
    string variableDebtTokenSymbol;
    string stableDebtTokenName;
    string stableDebtTokenSymbol;
    bytes params;
  }

  struct UpdateATokenInput {
    address asset;
    address treasury;
    address incentivesController;
    string name;
    string symbol;
    address implementation;
    bytes params;
  }

  struct UpdateDebtTokenInput {
    address asset;
    address incentivesController;
    string name;
    string symbol;
    address implementation;
    bytes params;
  }
}
