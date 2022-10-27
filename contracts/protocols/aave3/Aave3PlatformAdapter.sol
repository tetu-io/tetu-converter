// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "./Aave3AprLib.sol";
import "../../core/AppUtils.sol";
import "../../core/AppDataTypes.sol";
import "../../core/AppErrors.sol";
import "../../interfaces/IPlatformAdapter.sol";
import "../../interfaces/IPoolAdapterInitializer.sol";
import "../../interfaces/IController.sol";
import "../../integrations/aave3/IAavePool.sol";
import "../../integrations/aave3/IAaveAddressesProvider.sol";
import "../../integrations/aave3/IAaveProtocolDataProvider.sol";
import "../../integrations/aave3/Aave3ReserveConfiguration.sol";
import "../../integrations/aave3/IAavePriceOracle.sol";
import "../../integrations/aave3/IAaveToken.sol";
import "hardhat/console.sol";

/// @notice Adapter to read current pools info from AAVE-v3-protocol, see https://docs.aave.com/hub/
contract Aave3PlatformAdapter is IPlatformAdapter {
  using SafeERC20 for IERC20;
  using Aave3ReserveConfiguration for Aave3DataTypes.ReserveConfigurationMap;

  IController public controller;
  IAavePool public pool;
  IAavePriceOracle internal _priceOracle;

  /// @notice Full list of supported template-pool-adapters
  address[] private _converters;

  /// @notice Index of template pool adapter in {templatePoolAdapters} that should be used in normal borrowing mode
  uint constant public INDEX_NORMAL_MODE = 0;
  /// @notice Index of template pool adapter in {templatePoolAdapters} that should be used in E-mode of borrowing
  uint constant public INDEX_E_MODE = 1;

  uint256 internal constant RAY = 1e27;
  uint256 internal constant HALF_RAY = 0.5e27;


  ///////////////////////////////////////////////////////
  ///       Data types
  ///////////////////////////////////////////////////////
  /// @notice Local vars inside _getConversionPlan - to avoid stack too deep
  struct LocalsGetConversionPlan {
    IAavePool poolLocal;
    bool isolationMode;
    uint totalAToken;
    uint totalStableDebt;
    uint totalVariableDebt;
    uint blocksPerDay;
    address[] assets;
    uint[] prices;
  }

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
  ///                    View
  ///////////////////////////////////////////////////////

  function converters() external view override returns (address[] memory) {
    return _converters;
  }

  /// @notice Returns the prices of the supported assets in BASE_CURRENCY of the market. Decimals 18
  /// @dev Different markets can have different BASE_CURRENCY
  function getAssetsPrices(address[] calldata assets) external view override returns (uint[] memory prices18) {
    //TODO: the prices are in BASE_CURRENCY_UNIT = 100000000, we need to recalculate them to 1e18
    return _priceOracle.getAssetsPrices(assets);
  }

  ///////////////////////////////////////////////////////
  ///             Get conversion plan
  ///////////////////////////////////////////////////////
  function _getConversionPlan (
    AppDataTypes.ParamsGetConversionPlan memory params
  ) internal view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    LocalsGetConversionPlan memory vars;

    vars.poolLocal = pool;
    Aave3DataTypes.ReserveData memory rc = vars.poolLocal.getReserveData(params.collateralAsset);

    if (_isUsable(rc.configuration) &&  _isCollateralUsageAllowed(rc.configuration)) {
      Aave3DataTypes.ReserveData memory rb = vars.poolLocal.getReserveData(params.borrowAsset);

      if (_isUsable(rc.configuration) && rb.configuration.getBorrowingEnabled()) {

        vars.isolationMode = _isIsolationModeEnabled(rc.configuration);
        if (!vars.isolationMode || _isUsableInIsolationMode(rb.configuration)) {
          { // get liquidation threshold (== collateral factor) and loan-to-value
            uint8 categoryCollateral = uint8(rc.configuration.getEModeCategory());
            if (categoryCollateral != 0 && categoryCollateral == rb.configuration.getEModeCategory()) {

              // if both assets belong to the same e-mode-category, we can use category's ltv (higher than default)
              // we assume here, that e-mode is always used if it's available
              Aave3DataTypes.EModeCategory memory categoryData = vars.poolLocal.getEModeCategoryData(categoryCollateral);
              // ltv: 8500 for 0.85, we need decimals 18.
              plan.ltv18 = uint(categoryData.ltv) * 10**(18-4);
              plan.liquidationThreshold18 = uint(categoryData.liquidationThreshold) * 10**(18-4);
              plan.converter = _converters[INDEX_E_MODE];
            } else {
              // we should use both LTV and liquidationThreshold of collateral asset (not borrow asset)
              // see test "Borrow: check LTV and liquidationThreshold"
              plan.ltv18 = uint(rc.configuration.getLtv()) * 10**(18-4);
              plan.liquidationThreshold18 = uint(rc.configuration.getLiquidationThreshold()) * 10**(18-4);
              plan.converter = _converters[INDEX_NORMAL_MODE];
            }
          }

          // by default, we can borrow all available cache
          (,,
          vars.totalAToken,
          vars.totalStableDebt,
          vars.totalVariableDebt
          ,,,,,,,) = _dp(vars.poolLocal).getReserveData(params.borrowAsset);
          plan.maxAmountToBorrow = vars.totalAToken - vars.totalStableDebt - vars.totalVariableDebt;
          console.log("maxAmountToBorrowBT", plan.maxAmountToBorrow, params.borrowAsset);
          console.log("totalAToken", vars.totalAToken);
          console.log("totalStableDebt", vars.totalStableDebt);
          console.log("totalVariableDebt", vars.totalVariableDebt);

          // supply/borrow caps are given in "whole tokens" == without decimals
          // see AAVE3-code, ValidationLogic.sol, validateSupply
          { // take into account borrow cap, supply cap and debts ceiling
            uint borrowCap = rb.configuration.getBorrowCap();
            if (borrowCap != 0) {
              borrowCap *= (10**rb.configuration.getDecimals());
              uint totalDebt = vars.totalStableDebt + vars.totalVariableDebt;
              if (totalDebt > borrowCap) {
                plan.maxAmountToBorrow = 0;
              } else {
                if (totalDebt + plan.maxAmountToBorrow > borrowCap) {
                  console.log("maxAmountToBorrowBT.1", plan.maxAmountToBorrow, borrowCap, totalDebt);
                  plan.maxAmountToBorrow = borrowCap - totalDebt;
                }
              }
            }
            if (vars.isolationMode) {
              // the total exposure cannot be bigger than the collateral debt ceiling, see aave-v3-core: validateBorrow()
              // Suppose, the collateral is an isolated asset with the debt ceiling $10M
              // The user will therefore be allowed to borrow up to $10M of stable coins
              // Debt ceiling does not include interest accrued over time, only the principal borrowed
              uint maxAmount = (rc.configuration.getDebtCeiling() - rc.isolationModeTotalDebt)
                  * (10 ** (rb.configuration.getDecimals() - Aave3ReserveConfiguration.DEBT_CEILING_DECIMALS));

              if (plan.maxAmountToBorrow > maxAmount) {
                plan.maxAmountToBorrow = maxAmount;
                console.log("maxAmountToBorrowBT.2", maxAmount, rc.configuration.getDebtCeiling(), rc.isolationModeTotalDebt);
              }
            }
          }

          {
            // see sources of AAVE3\ValidationLogic.sol\validateSupply
            uint supplyCap = rc.configuration.getSupplyCap();
            if (supplyCap == 0) {
              plan.maxAmountToSupply = type(uint).max; // unlimited
            } else {
              supplyCap  *= (10**rc.configuration.getDecimals());
              uint totalSupply = (
                IAaveToken(rc.aTokenAddress).scaledTotalSupply() * rc.liquidityIndex + HALF_RAY
              ) / RAY;
              plan.maxAmountToSupply = supplyCap > totalSupply
                ? supplyCap - totalSupply
                : 0;
            }
          }

          // calculate borrow-APR, see detailed explanation in Aave3AprLib
          vars.blocksPerDay = IController(controller).blocksPerDay();
          vars.assets = new address[](2);
          vars.assets[0] = params.collateralAsset;
          vars.assets[1] = params.borrowAsset;
          vars.prices = _priceOracle.getAssetsPrices(vars.assets);

          // we assume here, that required health factor is configured correctly
          // and it's greater than h = liquidation-threshold (LT) / loan-to-value (LTV)
          // otherwise AAVE-pool will revert the borrow
          // see comment to IBorrowManager.setHealthFactor
          plan.amountToBorrow = AppUtils.toMantissa(
              100 * params.collateralAmount / uint(params.healthFactor2)
              * vars.prices[0]
              * plan.liquidationThreshold18
              / vars.prices[1]
              / 1e18,
            uint8(rc.configuration.getDecimals()),
            uint8(rb.configuration.getDecimals())
          );
          if (plan.amountToBorrow > plan.maxAmountToBorrow) {
            plan.amountToBorrow = plan.maxAmountToBorrow;
          }

          plan.borrowApr36 = AaveSharedLib.getAprForPeriodBefore(
            AaveSharedLib.State({
              liquidityIndex: rb.variableBorrowIndex,
              lastUpdateTimestamp: uint(rb.lastUpdateTimestamp),
              rate: rb.currentVariableBorrowRate
            }),
              plan.amountToBorrow,
        //predicted borrow ray after the borrow
            Aave3AprLib.getVariableBorrowRateRays(
              rb,
              params.borrowAsset,
              plan.amountToBorrow,
              vars.totalStableDebt,
              vars.totalVariableDebt
            ),
            params.countBlocks,
            vars.blocksPerDay,
            block.timestamp, // assume, that we make borrow in the current block
            1e18 // multiplier to increase result precision
          )
          * 10**18 // we need decimals 36, but the result is already multiplied on 1e18 by multiplier above
          / 10**rb.configuration.getDecimals();

          // calculate supply-APR, see detailed explanation in Aave3AprLib
          (,,
          vars.totalAToken,
          vars.totalStableDebt,
          vars.totalVariableDebt
          ,,,,,,,) = _dp(vars.poolLocal).getReserveData(params.collateralAsset);

          plan.supplyAprBt36 = AaveSharedLib.getAprForPeriodBefore(
            AaveSharedLib.State({
              liquidityIndex: rc.liquidityIndex,
              lastUpdateTimestamp: uint(rc.lastUpdateTimestamp),
              rate: rc.currentLiquidityRate
            }),
            params.collateralAmount,
            Aave3AprLib.getLiquidityRateRays(
              rc,
              params.collateralAsset,
              params.collateralAmount,
              vars.totalStableDebt,
              vars.totalVariableDebt
            ),
            params.countBlocks,
            vars.blocksPerDay,
            block.timestamp, // assume, that we supply collateral in the current block
            1e18 // multiplier to increase result precision
          )
          // we need a value in terms of borrow tokens but with decimals 18
          * vars.prices[0] // collateral price
          * 10**18 // we need decimals 36, but the result is already multiplied on 1e18 by multiplier above
          / vars.prices[1] // borrow price
          / 10**rc.configuration.getDecimals();
        }
      }
    }

    return plan;
  }

  function getConversionPlan (
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint16 healthFactor2_,
    uint countBlocks_
  ) external view override returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    return _getConversionPlan(
      AppDataTypes.ParamsGetConversionPlan({
        collateralAsset: collateralAsset_,
        collateralAmount: collateralAmount_,
        borrowAsset: borrowAsset_,
        healthFactor2: healthFactor2_,
        countBlocks: countBlocks_
      })
    );
  }

  ///////////////////////////////////////////////////////
  ///  Calculate borrow rate after borrowing in advance
  ///////////////////////////////////////////////////////

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  function getBorrowRateAfterBorrow(address borrowAsset_, uint amountToBorrow_) external view override returns (uint) {
    IAavePool poolLocal = pool;
    Aave3DataTypes.ReserveData memory rb = poolLocal.getReserveData(borrowAsset_);

    (,,,
    uint256 totalStableDebt,
    uint256 totalVariableDebt
    ,,,,,,,) = _dp(poolLocal).getReserveData(borrowAsset_);

    return Aave3AprLib.getVariableBorrowRateRays(
      rb,
      borrowAsset_,
      amountToBorrow_,
      totalStableDebt,
      totalVariableDebt
    );
  }

  ///////////////////////////////////////////////////////
  ///         Initialization of pool adapters
  ///////////////////////////////////////////////////////

  function initializePoolAdapter(
    address converter_,
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
      borrowAsset_,
      converter_
    );
  }


  ///////////////////////////////////////////////////////
  ///                    Utils
  ///////////////////////////////////////////////////////

  /// @notice Check if the asset can be used as a collateral
  /// @dev Some assets cannot be used as collateral: https://docs.aave.com/risk/asset-risk/risk-parameters#collaterals
  /// @param data Aave3DataTypes.ReserveData.configuration.data
  function _isCollateralUsageAllowed(Aave3DataTypes.ReserveConfigurationMap memory data) internal pure returns (bool) {
    // see AaveProtocolDataProvider.getReserveConfigurationData impl
    return data.getLiquidationThreshold() != 0;
  }

  /// @notice Check if the asset active, not frozen, not paused
  /// @param data Aave3DataTypes.ReserveData.configuration.data
  function _isUsable(Aave3DataTypes.ReserveConfigurationMap memory data) internal pure returns (bool) {
    return data.getActive() && ! data.getFrozen() && ! data.getPaused();
  }

  /// @notice Some assets can be used as collateral in isolation mode only
  /// @dev // see comment to getDebtCeiling(): The debt ceiling (0 = isolation mode disabled)
  function _isIsolationModeEnabled(Aave3DataTypes.ReserveConfigurationMap memory collateralData_)
  internal pure returns (bool) {
    return collateralData_.getDebtCeiling() != 0;
  }

  /// @notice Only certain assets can be borrowed in isolation mode—specifically, approved stablecoins.
  /// @dev https://docs.aave.com/developers/whats-new/isolation-mode
  function _isUsableInIsolationMode(Aave3DataTypes.ReserveConfigurationMap memory borrowData) internal pure returns (bool) {
    return borrowData.getBorrowableInIsolation();
  }

  function _dp(IAavePool pool_) internal view returns (IAaveProtocolDataProvider) {
    return IAaveProtocolDataProvider(
      (IAaveAddressesProvider(pool_.ADDRESSES_PROVIDER())).getPoolDataProvider()
    );
  }
}