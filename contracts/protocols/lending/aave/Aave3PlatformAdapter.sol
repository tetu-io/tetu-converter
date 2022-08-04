// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../../openzeppelin/SafeERC20.sol";
import "../../../openzeppelin/IERC20.sol";
import "../../../integrations/aave/IAavePool.sol";
import "../../../integrations/aave/IAaveAddressesProvider.sol";
import "../../../integrations/aave/IAaveProtocolDataProvider.sol";
import "../../../integrations/aave/ReserveConfiguration.sol";
import "../../../core/AppDataTypes.sol";
import "../../../core/AppErrors.sol";
import "../../../interfaces/IPlatformAdapter.sol";
import "../../../interfaces/IPoolAdapterInitializer.sol";
import "../../../interfaces/IController.sol";
import "hardhat/console.sol";
import "../../../integrations/aave/IAavePriceOracle.sol";

/// @notice Adapter to read current pools info from AAVE-protocol v3, see https://docs.aave.com/hub/
contract Aave3PlatformAdapter is IPlatformAdapter {
  using SafeERC20 for IERC20;
  using ReserveConfiguration for DataTypes.ReserveConfigurationMap;

  IController public controller;
  IAavePool public pool;
  IAavePriceOracle internal _priceOracle;

  /// @notice Full list of supported template-pool-adapters
  address[] private _converters;

  /// @notice Index of template pool adapter in {templatePoolAdapters} that should be used in normal borrowing mode
  uint constant public INDEX_NORMAL_MODE = 0;
  /// @notice Index of template pool adapter in {templatePoolAdapters} that should be used in E-mode of borrowing
  uint constant public INDEX_E_MODE = 1;

  ///////////////////////////////////////////////////////
  ///       Constructor and initialization
  ///////////////////////////////////////////////////////

  constructor (
    address controller_,
    address poolAave_,
    address templateAdapterNormal_,
    address templateAdapterEMode_
  ) {
    require(poolAave_ != address(0)
      && templateAdapterNormal_ != address(0)
      && templateAdapterEMode_ != address(0)
      && controller_ != address(0)
    , AppErrors.ZERO_ADDRESS);

    pool = IAavePool(poolAave_);
    _priceOracle = IAavePriceOracle(IAaveAddressesProvider(pool.ADDRESSES_PROVIDER()).getPriceOracle());

    controller = IController(controller_);

    _converters.push(templateAdapterNormal_); // add first, INDEX_NORMAL_MODE = 0
    _converters.push(templateAdapterEMode_); // add second, INDEX_E_MODE = 1
  }

  ///////////////////////////////////////////////////////
  ///       View
  ///////////////////////////////////////////////////////

  function converters() external view override returns (address[] memory) {
    return _converters;
  }

  /// @notice Returns the prices of the supported assets in BASE_CURRENCY of the market. Decimals 18
  /// @dev Different markets can have different BASE_CURRENCY
  function getAssetsPrices(address[] calldata assets) external view override returns (uint[] memory prices18) {
    return _priceOracle.getAssetsPrices(assets);
  }

  ///////////////////////////////////////////////////////
  ///       Get conversion plan
  ///////////////////////////////////////////////////////

  function getConversionPlan (
    address collateralAsset_,
    address borrowAsset_
  ) external view override returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    DataTypes.ReserveData memory rc = pool.getReserveData(collateralAsset_);

    if (_isUsable(rc.configuration) &&  _isCollateralUsageAllowed(rc.configuration)) {
      DataTypes.ReserveData memory rb = pool.getReserveData(borrowAsset_);

      if (_isUsable(rc.configuration) && rb.configuration.getBorrowingEnabled()) {

        if (!_isIsolationModeEnabled(rc.configuration) || _isUsableInIsolationMode(rb.configuration)) {
          { // get liquidation threshold (== collateral factor) and loan-to-value
            uint8 categoryCollateral = uint8(rc.configuration.getEModeCategory());
            if (categoryCollateral != 0 && categoryCollateral == rb.configuration.getEModeCategory()) {

              // if both assets belong to the same e-mode-category, we can use category's ltv (higher than default)
              // TODO: we assume here, that e-mode is always used if it's available
              DataTypes.EModeCategory memory categoryData = pool.getEModeCategoryData(categoryCollateral);
              // ltv: 8500 for 0.85, we need decimals 18.
              plan.ltv18 = uint(categoryData.ltv) * 10**(18-5);
              plan.liquidationThreshold18 = uint(categoryData.liquidationThreshold) * 10**(18-5);
              plan.converter = _converters[INDEX_E_MODE];
            } else {
              plan.ltv18 = uint(rb.configuration.getLtv()) * 10**(18-5);
              plan.liquidationThreshold18 = uint(rb.configuration.getLiquidationThreshold()) * 10**(18-5);
              plan.converter = _converters[INDEX_NORMAL_MODE];
            }
            console.log("plan.converter=%s", plan.converter);
          }

         // assume here, that we always use variable borrow rate
          plan.borrowRate = rb.currentVariableBorrowRate / 10**(27-18); // rays => decimals 18 (1 ray = 1e-27)
          plan.borrowRateKind = AppDataTypes.BorrowRateKind.PER_SECOND_2;

          { // by default, we can borrow all available cache

            // we need to know available liquidity in the pool, so, we need an access to pool-data-provider
            // TODO: can we use static address of the PoolDataProvider - 0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654 ?
            // TODO: see https://docs.aave.com/developers/deployed-contracts/v3-mainnet/polygon
            IAaveProtocolDataProvider dp = IAaveProtocolDataProvider(
              (IAaveAddressesProvider(IAavePool(pool).ADDRESSES_PROVIDER())).getPoolDataProvider()
            );

            (,,
            uint256 totalAToken,
            uint256 totalStableDebt,
            uint256 totalVariableDebt
            ,,,,,,,) = dp.getReserveData(borrowAsset_);
            plan.maxAmountToBorrowBT = totalAToken - totalStableDebt - totalVariableDebt;
          }

          // supply/borrow caps are given in "whole tokens" == without decimals
          // see AAVE3-code, ValidationLogic.sol, validateSupply

          { // take into account borrow cap, supply cap and debts ceiling
            uint borrowCap = rb.configuration.getBorrowCap() * (10**rb.configuration.getDecimals());
            if (borrowCap != 0 && borrowCap < plan.maxAmountToBorrowBT) {
              plan.maxAmountToBorrowBT = borrowCap; //TODO: is cap for all user together?
            }
            //TODO: take into account DebtCeiling in isolation mode
          }

          plan.maxAmountToSupplyCT = rc.configuration.getSupplyCap() * (10**rb.configuration.getDecimals());
        }
      }
    }

    return plan;
  }

  ///////////////////////////////////////////////////////
  ///         Initialization of pool adapters
  ///////////////////////////////////////////////////////

  function initializePoolAdapter(
    address /* converter_ */,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external override {
    // All AAVE-pool-adapters support IPoolAdapterInitializer
    IPoolAdapterInitializer(poolAdapter_).initialize(
      address(controller),
      address(pool),
      user_,
      collateralAsset_,
      borrowAsset_
    );
  }


  ///////////////////////////////////////////////////////
  ///                    Utils
  ///////////////////////////////////////////////////////

  /// @notice Check if the asset can be used as a collateral
  /// @dev Some assets cannot be used as collateral: https://docs.aave.com/risk/asset-risk/risk-parameters#collaterals
  /// @param data DataTypes.ReserveData.configuration.data
  function _isCollateralUsageAllowed(DataTypes.ReserveConfigurationMap memory data) internal pure returns (bool) {
    // see AaveProtocolDataProvider.getReserveConfigurationData impl
    return data.getLiquidationThreshold() != 0;
  }

  /// @notice Check if the asset active, not frozen, not paused
  /// @param data DataTypes.ReserveData.configuration.data
  function _isUsable(DataTypes.ReserveConfigurationMap memory data) internal pure returns (bool) {
    return data.getActive() && ! data.getFrozen() && ! data.getPaused();
  }

  /// @notice Some assets can be used as collateral in isolation mode only
  /// @dev // see comment to getDebtCeiling(): The debt ceiling (0 = isolation mode disabled)
  function _isIsolationModeEnabled(DataTypes.ReserveConfigurationMap memory collateralData_)
  internal pure returns (bool) {
    return collateralData_.getDebtCeiling() != 0;
  }

  /// @notice Only certain assets can be borrowed in isolation mode—specifically, approved stablecoins.
  /// @dev https://docs.aave.com/developers/whats-new/isolation-mode
  function _isUsableInIsolationMode(DataTypes.ReserveConfigurationMap memory borrowData) internal pure returns (bool) {
    return borrowData.getBorrowableInIsolation();
  }
}