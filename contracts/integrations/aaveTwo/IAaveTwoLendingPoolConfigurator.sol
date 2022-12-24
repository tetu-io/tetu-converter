// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice Restored from 0xf70a4d422e772926852ba9044026f169e6ad9492 (events were removed)
interface IAaveTwoLendingPoolConfigurator {
  function activateReserve(address asset) external;

  function batchInitReserve(
    ILendingPoolConfigurator.InitReserveInput[] memory input
  ) external;

  function configureReserveAsCollateral(
    address asset,
    uint256 ltv,
    uint256 liquidationThreshold,
    uint256 liquidationBonus
  ) external;

  function deactivateReserve(address asset) external;

  function disableBorrowingOnReserve(address asset) external;

  function disableReserveStableRate(address asset) external;

  function enableBorrowingOnReserve(
    address asset,
    bool stableBorrowRateEnabled
  ) external;

  function enableReserveStableRate(address asset) external;

  function freezeReserve(address asset) external;

  function initialize(address provider) external;

  function setPoolPause(bool val) external;

  function setReserveFactor(address asset, uint256 reserveFactor) external;

  function setReserveInterestRateStrategyAddress(
    address asset,
    address rateStrategyAddress
  ) external;

  function unfreezeReserve(address asset) external;

  function updateAToken(
    ILendingPoolConfigurator.UpdateATokenInput memory input
  ) external;

  function updateStableDebtToken(
    ILendingPoolConfigurator.UpdateDebtTokenInput memory input
  ) external;

  function updateVariableDebtToken(
    ILendingPoolConfigurator.UpdateDebtTokenInput memory input
  ) external;
}

interface ILendingPoolConfigurator {
  struct InitReserveInput {
    address aTokenImpl;
    address stableDebtTokenImpl;
    address variableDebtTokenImpl;
    uint8 underlyingAssetDecimals;
    address interestRateStrategyAddress;
    address underlyingAsset;
    address treasury;
    address incentivesController;
    string underlyingAssetName;
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
