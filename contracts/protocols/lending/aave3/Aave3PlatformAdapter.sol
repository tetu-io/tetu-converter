// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../../openzeppelin/SafeERC20.sol";
import "../../../openzeppelin/IERC20.sol";
import "../../../core/AppDataTypes.sol";
import "../../../core/AppErrors.sol";
import "../../../interfaces/IPlatformAdapter.sol";
import "../../../interfaces/IPoolAdapterInitializer.sol";
import "../../../interfaces/IController.sol";
import "../../../integrations/aave3/IAavePool.sol";
import "../../../integrations/aave3/IAaveAddressesProvider.sol";
import "../../../integrations/aave3/IAaveProtocolDataProvider.sol";
import "../../../integrations/aave3/Aave3ReserveConfiguration.sol";
import "../../../integrations/aave3/IAavePriceOracle.sol";
import "../../../integrations/aave3/IAaveToken.sol";
import "../../../integrations/aave3/IAaveReserveInterestRateStrategy.sol";

/// @notice Adapter to read current pools info from AAVE-v3-protocol, see https://docs.aave.com/hub/
contract Aave3PlatformAdapter is IPlatformAdapter {
  using SafeERC20 for IERC20;
  using Aave3ReserveConfiguration for Aave3DataTypes.ReserveConfigurationMap;

  uint public COUNT_SECONDS_PER_YEAR = 31536000;

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
    return _priceOracle.getAssetsPrices(assets);
  }

  ///////////////////////////////////////////////////////
  ///             Get conversion plan
  ///////////////////////////////////////////////////////

  function _getConversionPlan (
    address collateralAsset_,
    address borrowAsset_,
    uint borrowAmountFactor18_
  ) internal view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    IAavePool poolLocal = pool;
    Aave3DataTypes.ReserveData memory rc = poolLocal.getReserveData(collateralAsset_);

    if (_isUsable(rc.configuration) &&  _isCollateralUsageAllowed(rc.configuration)) {
      Aave3DataTypes.ReserveData memory rb = poolLocal.getReserveData(borrowAsset_);

      if (_isUsable(rc.configuration) && rb.configuration.getBorrowingEnabled()) {

        bool isolationMode = _isIsolationModeEnabled(rc.configuration);
        if (!isolationMode || _isUsableInIsolationMode(rb.configuration)) {
          { // get liquidation threshold (== collateral factor) and loan-to-value
            uint8 categoryCollateral = uint8(rc.configuration.getEModeCategory());
            if (categoryCollateral != 0 && categoryCollateral == rb.configuration.getEModeCategory()) {

              // if both assets belong to the same e-mode-category, we can use category's ltv (higher than default)
              // we assume here, that e-mode is always used if it's available
              Aave3DataTypes.EModeCategory memory categoryData = poolLocal.getEModeCategoryData(categoryCollateral);
              // ltv: 8500 for 0.85, we need decimals 18.
              plan.ltv18 = uint(categoryData.ltv) * 10**(18-4);
              plan.liquidationThreshold18 = uint(categoryData.liquidationThreshold) * 10**(18-4);
              plan.converter = _converters[INDEX_E_MODE];
            } else {
              plan.ltv18 = uint(rb.configuration.getLtv()) * 10**(18-4);
              plan.liquidationThreshold18 = uint(rc.configuration.getLiquidationThreshold()) * 10**(18-4);
              plan.converter = _converters[INDEX_NORMAL_MODE];
            }
          }

          // by default, we can borrow all available cache
          (,,
          uint256 totalAToken,
          uint256 totalStableDebt,
          uint256 totalVariableDebt
          ,,,,,,,) = _dp(poolLocal).getReserveData(borrowAsset_);
          plan.maxAmountToBorrowBT = totalAToken - totalStableDebt - totalVariableDebt;

          // supply/borrow caps are given in "whole tokens" == without decimals
          // see AAVE3-code, ValidationLogic.sol, validateSupply

          { // take into account borrow cap, supply cap and debts ceiling
            uint borrowCap = rb.configuration.getBorrowCap();
            if (borrowCap != 0) {
              borrowCap *= (10**rb.configuration.getDecimals());
              uint totalDebt = totalStableDebt + totalVariableDebt;
              if (totalDebt > borrowCap) {
                plan.maxAmountToBorrowBT = 0;
              } else {
                if (totalDebt + plan.maxAmountToBorrowBT > borrowCap) {
                  plan.maxAmountToBorrowBT = borrowCap - totalDebt;
                }
              }
            }
            if (isolationMode) {
              // the total exposure cannot be bigger than the collateral debt ceiling, see aave-v3-core: validateBorrow()
              // Suppose, the collateral is an isolated asset with the debt ceiling $10M
              // The user will therefore be allowed to borrow up to $10M of stable coins
              // Debt ceiling does not include interest accrued over time, only the principal borrowed
              uint maxAmount = (rc.configuration.getDebtCeiling() - rc.isolationModeTotalDebt)
                  * (10 ** (rc.configuration.getDecimals() - Aave3ReserveConfiguration.DEBT_CEILING_DECIMALS));
              if (plan.maxAmountToBorrowBT > maxAmount) {
                plan.maxAmountToBorrowBT = maxAmount;
              }
            }
          }

          // see sources of AAVE3\ValidationLogic.sol\validateSupply
          uint supplyCap = rc.configuration.getSupplyCap();
          if (supplyCap == 0) {
            plan.maxAmountToSupplyCT = type(uint).max; // unlimited
          } else {
            supplyCap  *= (10**rc.configuration.getDecimals());
            uint totalSupply = (IAaveToken(rc.aTokenAddress).scaledTotalSupply() * rc.liquidityIndex + HALF_RAY) / RAY;
            plan.maxAmountToSupplyCT = supplyCap > totalSupply
              ? supplyCap - totalSupply
              : 0;
          }

          { // calculate borrow rate
            // get both current BR and predict BR-value after borrowing of the required amount, take max value
            // assume here, that we always use variable borrow rate
            uint br = rb.currentVariableBorrowRate;
            if (borrowAmountFactor18_ != 0) {
              uint brAfterBorrow = _br(borrowAsset_,
                rb,
                plan.liquidationThreshold18 * borrowAmountFactor18_ / 1e18,
                totalStableDebt,
                totalVariableDebt
              );
              if (brAfterBorrow > br) {
                br = brAfterBorrow;
              }
            }

            plan.brForPeriod18 = br
              / COUNT_SECONDS_PER_YEAR
              * IController(controller).blocksPerDay() * 365 / COUNT_SECONDS_PER_YEAR
              / 10**(27-18); // rays => decimals 18 (1 ray = 1e-27)
          }

        }
      }
    }

    return plan;
  }

  function getConversionPlan (
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint borrowAmountFactor18_,
    uint countBlocks_
  ) external view override returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    // there are no rewards in AAVE3; this value is required by other platforms to predict the rewards correctly
    collateralAmount_;

    plan = _getConversionPlan(
      collateralAsset_,
      borrowAsset_,
      borrowAmountFactor18_
    );

    // avoid Stack too deep, try removing local variables.
    plan.brForPeriod18 *= countBlocks_;
    return plan;
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

    return _br(borrowAsset_,
      rb,
      amountToBorrow_,
      totalStableDebt,
      totalVariableDebt
    );
  }


  function _br(
    address borrowAsset_,
    Aave3DataTypes.ReserveData memory rd_,
    uint amountToBorrow_,
    uint256 totalStableDebt_,
    uint256 totalVariableDebt_
  ) internal view returns (uint variableBorrowRate) {

    // see aave-v3-core, DefaultReserveInterestRateStrategy, calculateInterestRates impl
    // to calculate new BR, we need to reduce liquidity on borrowAmount and increase the debt on the same amount
    (,,variableBorrowRate) = IAaveReserveInterestRateStrategy(rd_.interestRateStrategyAddress).calculateInterestRates(
      Aave3DataTypes.CalculateInterestRatesParams({
        unbacked: 0, // this value is not used to calculate variable BR
        liquidityAdded: 0,
        liquidityTaken: amountToBorrow_,
        totalStableDebt: totalStableDebt_,
        totalVariableDebt: totalVariableDebt_ + amountToBorrow_,
        averageStableBorrowRate: rd_.currentStableBorrowRate, // this value is not used to calculate variable BR
        reserveFactor: rd_.configuration.getReserveFactor(),
        reserve: borrowAsset_,
        aToken: rd_.aTokenAddress
      })
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