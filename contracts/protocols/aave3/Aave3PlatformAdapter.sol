// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./Aave3AprLib.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../core/AppUtils.sol";
import "../../core/AppDataTypes.sol";
import "../../core/AppErrors.sol";
import "../../core/EntryKinds.sol";
import "../../interfaces/IPlatformAdapter.sol";
import "../../interfaces/IPoolAdapterInitializer.sol";
import "../../interfaces/IController.sol";
import "../../integrations/aave3/IAavePool.sol";
import "../../integrations/aave3/IAaveAddressesProvider.sol";
import "../../integrations/aave3/IAaveProtocolDataProvider.sol";
import "../../integrations/aave3/Aave3ReserveConfiguration.sol";
import "../../integrations/aave3/IAavePriceOracle.sol";
import "../../integrations/aave3/IAaveToken.sol";

/// @notice Adapter to read current pools info from AAVE-v3-protocol, see https://docs.aave.com/hub/
contract Aave3PlatformAdapter is IPlatformAdapter {
  using SafeERC20 for IERC20;
  using AppUtils for uint;
  using Aave3ReserveConfiguration for Aave3DataTypes.ReserveConfigurationMap;

  ///////////////////////////////////////////////////////
  ///   Constants
  ///////////////////////////////////////////////////////
  uint256 internal constant RAY = 1e27;
  uint256 internal constant HALF_RAY = 0.5e27;

  /// @notice We allow to borrow only 90% of max allowed amount, see the code below for explanation
  uint public constant MAX_BORROW_AMOUNT_FACTOR = 90;
  uint constant public MAX_BORROW_AMOUNT_FACTOR_DENOMINATOR = 100;

  ///////////////////////////////////////////////////////
  ///   Data types
  ///////////////////////////////////////////////////////
  /// @notice Local vars inside _getConversionPlan - to avoid stack too deep
  struct LocalsGetConversionPlan {
    IAavePool poolLocal;
    IAaveAddressesProvider addressProvider;
    IAavePriceOracle priceOracle;
    IAaveProtocolDataProvider dataProvider;
    uint totalAToken;
    uint totalStableDebt;
    uint totalVariableDebt;
    uint blocksPerDay;
    /// @notice rc.configuration.getDebtCeiling(); rcDebtCeiling != 0 => isolation mode is used
    uint rcDebtCeiling;
    uint healthFactor18;
    IController controller;
  }

  ///////////////////////////////////////////////////////
  ///   Variables
  ///////////////////////////////////////////////////////
  IController immutable public controller;
  IAavePool immutable public pool;
  /// @dev Same as controller.borrowManager(); we cache it for gas optimization
  address immutable public borrowManager;

  address immutable public converterNormal;
  address immutable public converterEMode;

  /// @notice True if the platform is frozen and new borrowing is not possible (at this moment)
  bool public override frozen;

  ///////////////////////////////////////////////////////
  ///               Events
  ///////////////////////////////////////////////////////
  event OnPoolAdapterInitialized(
    address converter,
    address poolAdapter,
    address user,
    address collateralAsset,
    address borrowAsset
  );

  ///////////////////////////////////////////////////////
  ///       Constructor and initialization
  ///////////////////////////////////////////////////////

  constructor (
    address controller_,
    address borrowManager_,
    address poolAave_,
    address templateAdapterNormal_,
    address templateAdapterEMode_
  ) {
    require(
      poolAave_ != address(0)
      && borrowManager_ != address(0)
      && templateAdapterNormal_ != address(0)
      && templateAdapterEMode_ != address(0)
      && controller_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    pool = IAavePool(poolAave_);
    controller = IController(controller_);
    borrowManager = borrowManager_;

    converterNormal = templateAdapterNormal_;
    converterEMode = templateAdapterEMode_;
  }

  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external override {
    require(msg.sender == borrowManager, AppErrors.BORROW_MANAGER_ONLY);
    require(converterNormal == converter_ || converterEMode == converter_, AppErrors.CONVERTER_NOT_FOUND);

    // All AAVE-pool-adapters support IPoolAdapterInitializer
    IPoolAdapterInitializer(poolAdapter_).initialize(
      address(controller),
      address(pool),
      user_,
      collateralAsset_,
      borrowAsset_,
      converter_
    );

    emit OnPoolAdapterInitialized(converter_, poolAdapter_, user_, collateralAsset_, borrowAsset_);
  }

  /// @notice Set platform to frozen/unfrozen state. In frozen state any new borrowing is forbidden.
  function setFrozen(bool frozen_) external {
    require(msg.sender == controller.governance(), AppErrors.GOVERNANCE_ONLY);
    frozen = frozen_;
  }

  ///////////////////////////////////////////////////////
  ///                    View
  ///////////////////////////////////////////////////////

  function converters() external view override returns (address[] memory) {
    address[] memory dest = new address[](2);
    dest[0] = converterNormal;
    dest[1] = converterEMode;
    return dest;
  }

  ///////////////////////////////////////////////////////
  ///             Get conversion plan
  ///////////////////////////////////////////////////////
  function getConversionPlan (
    AppDataTypes.InputConversionParams memory params,
    uint16 healthFactor2_
  ) external view override returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    if (! frozen) {
      LocalsGetConversionPlan memory vars;
      AppDataTypes.PricesAndDecimals memory pd;
      vars.controller = controller;

      require(params.collateralAsset != address(0) && params.borrowAsset != address(0), AppErrors.ZERO_ADDRESS);
      require(params.collateralAmount != 0 && params.countBlocks != 0, AppErrors.INCORRECT_VALUE);
      require(healthFactor2_ >= vars.controller.minHealthFactor2(), AppErrors.WRONG_HEALTH_FACTOR);

      vars.poolLocal = pool;
      vars.addressProvider = IAaveAddressesProvider(vars.poolLocal.ADDRESSES_PROVIDER());
      vars.priceOracle = IAavePriceOracle(vars.addressProvider.getPriceOracle());
      vars.dataProvider = IAaveProtocolDataProvider(vars.addressProvider.getPoolDataProvider());

      Aave3DataTypes.ReserveData memory rc = vars.poolLocal.getReserveData(params.collateralAsset);

      if (_isUsable(rc.configuration) &&  _isCollateralUsageAllowed(rc.configuration)) {
        Aave3DataTypes.ReserveData memory rb = vars.poolLocal.getReserveData(params.borrowAsset);

        if (_isUsable(rb.configuration) && rb.configuration.getBorrowingEnabled()) {
          pd.rc10powDec = 10**rc.configuration.getDecimals();
          pd.rb10powDec = 10**rb.configuration.getDecimals();

          /// Some assets can be used as collateral in isolation mode only
          /// see comment to getDebtCeiling(): The debt ceiling (0 = isolation mode disabled)
          vars.rcDebtCeiling = rc.configuration.getDebtCeiling();
          if (vars.rcDebtCeiling == 0 || _isUsableInIsolationMode(rb.configuration)) {
            { // get liquidation threshold (== collateral factor) and loan-to-value
              uint8 categoryCollateral = uint8(rc.configuration.getEModeCategory());
              if (categoryCollateral != 0 && categoryCollateral == rb.configuration.getEModeCategory()) {

                // if both assets belong to the same e-mode-category, we can use category's ltv (higher than default)
                // we assume here, that e-mode is always used if it's available
                Aave3DataTypes.EModeCategory memory categoryData = vars.poolLocal.getEModeCategoryData(categoryCollateral);
                // ltv: 8500 for 0.85, we need decimals 18.
                plan.ltv18 = uint(categoryData.ltv) * 10**(18-4);
                plan.liquidationThreshold18 = uint(categoryData.liquidationThreshold) * 10**(18-4);
                plan.converter = converterEMode;
              } else {
                // we should use both LTV and liquidationThreshold of collateral asset (not borrow asset)
                // see test "Borrow: check LTV and liquidationThreshold"
                plan.ltv18 = uint(rc.configuration.getLtv()) * 10**(18-4);
                plan.liquidationThreshold18 = uint(rc.configuration.getLiquidationThreshold()) * 10**(18-4);
                plan.converter = converterNormal;
              }
            }

            // by default, we can borrow all available cache
            (,,
            vars.totalAToken,
            vars.totalStableDebt,
            vars.totalVariableDebt
            ,,,,,,,) = vars.dataProvider.getReserveData(params.borrowAsset);
            plan.maxAmountToBorrow = vars.totalAToken - vars.totalStableDebt - vars.totalVariableDebt;

            // supply/borrow caps are given in "whole tokens" == without decimals
            // see AAVE3-code, ValidationLogic.sol, validateBorrow
            { // take into account borrow cap, supply cap and debts ceiling
              uint borrowCap = rb.configuration.getBorrowCap();
              if (borrowCap != 0) {
                borrowCap *= pd.rb10powDec;
                uint totalDebt = vars.totalStableDebt + vars.totalVariableDebt;
                if (totalDebt > borrowCap) {
                  plan.maxAmountToBorrow = 0;
                } else {
                  if (totalDebt + plan.maxAmountToBorrow > borrowCap) {
                    // we should use actual values of totalStableDebt and totalVariableDebt
                    // they can be a bit different from stored values
                    // as result, it's not possible to borrow exact max amount
                    // it's necessary to borrow a bit less amount
                    // so, we allow to borrow only 90% of max amount
                    plan.maxAmountToBorrow = (borrowCap - totalDebt)
                      * MAX_BORROW_AMOUNT_FACTOR
                      / MAX_BORROW_AMOUNT_FACTOR_DENOMINATOR;
                  }
                }
              }
              if (vars.rcDebtCeiling != 0) {
                // The isolation mode is enabled.
                // The total exposure cannot be bigger than the collateral debt ceiling, see aave-v3-core: validateBorrow()
                // Suppose, the collateral is an isolated asset with the debt ceiling $10M
                // The user will therefore be allowed to borrow up to $10M of stable coins
                // Debt ceiling does not include interest accrued over time, only the principal borrowed
                uint maxAmount = (vars.rcDebtCeiling - rc.isolationModeTotalDebt)
                    * pd.rb10powDec
                    / 10 ** Aave3ReserveConfiguration.DEBT_CEILING_DECIMALS;

                if (plan.maxAmountToBorrow > maxAmount) {
                  plan.maxAmountToBorrow = maxAmount;
                }
              }
            }

            {
              // see sources of AAVE3\ValidationLogic.sol\validateSupply
              uint supplyCap = rc.configuration.getSupplyCap();
              if (supplyCap == 0) {
                plan.maxAmountToSupply = type(uint).max; // unlimited
              } else {
                supplyCap  *= pd.rc10powDec;
                uint totalSupply = (
                  IAaveToken(rc.aTokenAddress).scaledTotalSupply() * rc.liquidityIndex + HALF_RAY
                ) / RAY;
                plan.maxAmountToSupply = supplyCap > totalSupply
                  ? supplyCap - totalSupply
                  : 0;
              }
            }

            // calculate borrow-APR, see detailed explanation in Aave3AprLib
            vars.blocksPerDay = vars.controller.blocksPerDay();
            pd.priceCollateral = vars.priceOracle.getAssetPrice(params.collateralAsset);
            pd.priceBorrow = vars.priceOracle.getAssetPrice(params.borrowAsset);

            // AAVE has min allowed health factor at the borrow moment: liquidationThreshold18/LTV, i.e. 0.85/0.8=1.06...
            // Target health factor can be smaller but it's not possible to make a borrow with such low health factor
            // see explanation of health factor value in IController.sol
            vars.healthFactor18 = plan.liquidationThreshold18 * 1e18 / plan.ltv18;
            if (vars.healthFactor18 < uint(healthFactor2_)* 10**(18 - 2)) {
              vars.healthFactor18 = uint(healthFactor2_) * 10**(18 - 2);
            }

            if (params.entryKind == EntryKinds.ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0) {
              plan.collateralAmount = p_.collateralAmount;
              plan.amountToBorrow = EntryKinds.exactCollateralInForMaxBorrowOut(
                params.collateralAmount,
                vars.healthFactor18,
                plan.liquidationThreshold18,
                pd,
                false // prices have decimals 18, not 36
              );
            } else if (params.entryKind == EntryKinds.ENTRY_KIND_EQUAL_COLLATERAL_AND_BORROW_OUT_1) {
              (plan.collateralAmount, plan.amountToBorrow) = EntryKinds.equalCollateralAndBorrow(
                params.collateralAmount,
                vars.healthFactor18,
                plan.liquidationThreshold18,
                pd,
                params.entryData,
                false // prices have decimals 18, not 36
              );
            }

            if (plan.amountToBorrow > plan.maxAmountToBorrow) {
              plan.amountToBorrow = plan.maxAmountToBorrow;
            }

            plan.borrowCost36 = AaveSharedLib.getCostForPeriodBefore(
              AaveSharedLib.State({
                liquidityIndex: rb.variableBorrowIndex,
                lastUpdateTimestamp: uint(rb.lastUpdateTimestamp),
                rate: rb.currentVariableBorrowRate
              }),
              plan.amountToBorrow,
          //predicted borrow rate after the borrow
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
            * 1e18 // we need decimals 36, but the result is already multiplied on 1e18 by multiplier above
            / pd.rb10powDec;

            // calculate supply-APR, see detailed explanation in Aave3AprLib
            (,,
            vars.totalAToken,
            vars.totalStableDebt,
            vars.totalVariableDebt
            ,,,,,,,) = vars.dataProvider.getReserveData(params.collateralAsset);

            plan.supplyIncomeInBorrowAsset36 = AaveSharedLib.getCostForPeriodBefore(
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
            * 1e18 // we need decimals 36, but the result is already multiplied on 1e18 by multiplier above
            * pd.priceCollateral / pd.priceBorrow
            / pd.rc10powDec;

            plan.amountCollateralInBorrowAsset36 = params.collateralAmount
              * (1e36 * pd.priceCollateral / pd.priceBorrow)
              / pd.rc10powDec;
          }
        }
      }
    }

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
    ,,,,,,,) = IAaveProtocolDataProvider(
      (IAaveAddressesProvider(poolLocal.ADDRESSES_PROVIDER())).getPoolDataProvider()
    ).getReserveData(borrowAsset_);

    return Aave3AprLib.getVariableBorrowRateRays(
      rb,
      borrowAsset_,
      amountToBorrow_,
      totalStableDebt,
      totalVariableDebt
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

  /// @notice Only certain assets can be borrowed in isolation mode—specifically, approved stablecoins.
  /// @dev https://docs.aave.com/developers/whats-new/isolation-mode
  function _isUsableInIsolationMode(Aave3DataTypes.ReserveConfigurationMap memory borrowData) internal pure returns (bool) {
    return borrowData.getBorrowableInIsolation();
  }
}
