// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../libs/AppDataTypes.sol";
import "../../libs/AppUtils.sol";
import "../../libs/EntryKinds.sol";
import "../../interfaces/IPlatformAdapter.sol";
import "../../interfaces/IPoolAdapterInitializer.sol";
import "../../interfaces/IConverterController.sol";
import "../../integrations/aaveTwo/IAaveTwoPool.sol";
import "../../integrations/aaveTwo/IAaveTwoLendingPoolAddressesProvider.sol";
import "../../integrations/aaveTwo/IAaveTwoPriceOracle.sol";
import "../../integrations/aaveTwo/IAaveTwoProtocolDataProvider.sol";
import "../../integrations/aaveTwo/IAaveTwoAToken.sol";
import "../../integrations/aaveTwo/AaveTwoReserveConfiguration.sol";
import "../../integrations/aaveTwo/IAaveTwoReserveInterestRateStrategy.sol";
import "./AaveTwoAprLib.sol";

/// @notice Adapter to read current pools info from AAVE-v2-protocol, see https://docs.aave.com/hub/
contract AaveTwoPlatformAdapter is IPlatformAdapter {
  using SafeERC20 for IERC20;
  using AaveTwoReserveConfiguration for DataTypes.ReserveConfigurationMap;

  //-----------------------------------------------------
  //region Constants
  //-----------------------------------------------------
  string public constant override PLATFORM_ADAPTER_VERSION = "1.0.1";
  //endregion Constants

  //-----------------------------------------------------
  //region Data types
  //-----------------------------------------------------

  /// @notice Local vars inside getConversionPlan - to avoid stack too deep
  struct LocalsGetConversionPlan {
    IAaveTwoPool pool;
    IAaveTwoLendingPoolAddressesProvider addressProvider;
    IAaveTwoProtocolDataProvider dataProvider;
    IAaveTwoPriceOracle priceOracle;
    IConverterController controller;
    DataTypes.ReserveData rc;
    DataTypes.ReserveData rb;
    uint availableLiquidity;
    uint totalStableDebt;
    uint totalVariableDebt;
    uint blocksPerDay;
    uint healthFactor18;
    uint entryKind;
  }
  //endregion Data types

  //-----------------------------------------------------
  //region Variables
  //-----------------------------------------------------

  IConverterController immutable public controller;
  IAaveTwoPool immutable public pool;
  /// @notice template-pool-adapter
  address immutable public converter;
  /// @dev Same as controller.borrowManager(); we cache it for gas optimization
  address immutable public borrowManager;

  /// @notice True if the platform is frozen and new borrowing is not possible (at this moment)
  bool public override frozen;
  //endregion Variables

  //-----------------------------------------------------
  //region Events
  //-----------------------------------------------------
  event OnPoolAdapterInitialized(
    address converter,
    address poolAdapter,
    address user,
    address collateralAsset,
    address borrowAsset
  );
  //endregion Events

  //-----------------------------------------------------
  //region Constructor and initialization
  //-----------------------------------------------------

  constructor (
    address controller_,
    address borrowManager_,
    address poolAave_,
    address templateAdapterNormal_
  ) {
    require(
      poolAave_ != address(0)
      && borrowManager_ != address(0)
      && templateAdapterNormal_ != address(0)
      && controller_ != address(0),
      AppErrors.ZERO_ADDRESS
    );
    pool = IAaveTwoPool(poolAave_);
    controller = IConverterController(controller_);
    converter = templateAdapterNormal_;
    borrowManager = borrowManager_;
  }

  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external override {
    require(msg.sender == borrowManager, AppErrors.BORROW_MANAGER_ONLY);
    require(converter == converter_, AppErrors.CONVERTER_NOT_FOUND);

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
  //endregion Constructor and initialization

  //-----------------------------------------------------
  //region View
  //-----------------------------------------------------

  function converters() external view override returns (address[] memory) {
    address[] memory dest = new address[](1);
    dest[0] = converter;
    return dest;
  }
  //endregion View

  //-----------------------------------------------------
  //region Get conversion plan
  //-----------------------------------------------------

  function getConversionPlan (
    AppDataTypes.InputConversionParams memory params,
    uint16 healthFactor2_
  ) external view override returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    if (! frozen) {
      AppDataTypes.PricesAndDecimals memory pd;
      LocalsGetConversionPlan memory vars;
      vars.controller = controller;

      require(params.collateralAsset != address(0) && params.borrowAsset != address(0), AppErrors.ZERO_ADDRESS);
      require(params.amountIn != 0 && params.countBlocks != 0, AppErrors.INCORRECT_VALUE);
      require(healthFactor2_ >= vars.controller.minHealthFactor2(), AppErrors.WRONG_HEALTH_FACTOR);

      vars.pool = pool;

      vars.addressProvider = IAaveTwoLendingPoolAddressesProvider(vars.pool.getAddressesProvider());
      vars.dataProvider = IAaveTwoProtocolDataProvider(vars.addressProvider.getAddress(bytes32(AaveTwoAprLib.ID_DATA_PROVIDER)));
      vars.priceOracle = IAaveTwoPriceOracle(vars.addressProvider.getPriceOracle());

      vars.rc = vars.pool.getReserveData(params.collateralAsset);

      if (_isUsable(vars.rc.configuration) &&  _isCollateralUsageAllowed(vars.rc.configuration)) {
        vars.rb = vars.pool.getReserveData(params.borrowAsset);
        if (_isUsable(vars.rb.configuration) && vars.rb.configuration.getBorrowingEnabled()) {
          //------------------------------- Calculate maxAmountToSupply and maxAmountToBorrow
          // availableLiquidity is IERC20(borrowToken).balanceOf(atoken)
          (vars.availableLiquidity, vars.totalStableDebt, vars.totalVariableDebt,,,,,,,) = vars.dataProvider.getReserveData(params.borrowAsset);

          plan.maxAmountToSupply = type(uint).max; // unlimited; fix validation below after changing this value
          plan.maxAmountToBorrow = vars.availableLiquidity;
          if (plan.amountToBorrow > plan.maxAmountToBorrow) {
            plan.amountToBorrow = plan.maxAmountToBorrow;
          }

          if (/* plan.maxAmountToSupply != 0 &&*/ plan.maxAmountToBorrow != 0) {
            pd.rc10powDec = 10**vars.rc.configuration.getDecimals();
            pd.rb10powDec = 10**vars.rb.configuration.getDecimals();

            //-------------------------------- converter, LTV and liquidation threshold
            // get liquidation threshold (== collateral factor) and loan-to-value (LTV)
            // we should use both LTV and liquidationThreshold of collateral asset (not borrow asset)
            // see test "Borrow: check LTV and liquidationThreshold"
            plan.ltv18 = uint(vars.rc.configuration.getLtv()) * 10**(18-4);
            plan.liquidationThreshold18 = uint(vars.rc.configuration.getLiquidationThreshold()) * 10**(18-4);
            plan.converter = converter; // can be changed later

            //-------------------------------- Prices and health factor
            vars.blocksPerDay = vars.controller.blocksPerDay();
            pd.priceCollateral = vars.priceOracle.getAssetPrice(params.collateralAsset);
            pd.priceBorrow = vars.priceOracle.getAssetPrice(params.borrowAsset);

            // AAVE has min allowed health factor at the borrow moment: liquidationThreshold18/LTV, i.e. 0.85/0.8=1.06...
            // Target health factor can be smaller but it's not possible to make a borrow with such low health factor
            // see explanation of health factor value in IConverterController.sol
            vars.healthFactor18 = plan.liquidationThreshold18 * 1e18 / plan.ltv18;
            if (vars.healthFactor18 < uint(healthFactor2_) * 10**(18 - 2)) {
              vars.healthFactor18 = uint(healthFactor2_) * 10**(18 - 2);
            }

            //------------------------------- Calculate collateralAmount and amountToBorrow
            // calculate amount that can be borrowed and amount that should be provided as the collateral
            vars.entryKind = EntryKinds.getEntryKind(params.entryData);
            if (vars.entryKind == EntryKinds.ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0) {
              plan.collateralAmount = params.amountIn;
              plan.amountToBorrow = EntryKinds.exactCollateralInForMaxBorrowOut(
                params.amountIn,
                vars.healthFactor18,
                plan.liquidationThreshold18,
                pd,
                false // prices have decimals 18, not 36
              );
            } else if (vars.entryKind == EntryKinds.ENTRY_KIND_EXACT_PROPORTION_1) {
              (plan.collateralAmount, plan.amountToBorrow) = EntryKinds.exactProportion(
                params.amountIn,
                vars.healthFactor18,
                plan.liquidationThreshold18,
                pd,
                params.entryData,
                false // prices have decimals 18, not 36
              );
            } else if (vars.entryKind == EntryKinds.ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2) {
              plan.amountToBorrow = params.amountIn;
              plan.collateralAmount = EntryKinds.exactBorrowOutForMinCollateralIn(
                params.amountIn,
                vars.healthFactor18,
                plan.liquidationThreshold18,
                pd,
                false // prices have decimals 18, not 36
              );
            }

            //------------------------------- Validate the borrow
            if (plan.amountToBorrow == 0 || plan.collateralAmount == 0) {
              plan.converter = address(0);
            } else {
              // reduce collateral amount and borrow amount proportionally to fit available limits
              // we don't need to check "plan.collateralAmount > plan.maxAmountToSupply" as in AAVE3
              // because maxAmountToSupply is always equal to type(uint).max
              if (plan.amountToBorrow > plan.maxAmountToBorrow) {
                plan.collateralAmount = plan.collateralAmount * plan.maxAmountToBorrow / plan.amountToBorrow;
                plan.amountToBorrow = plan.maxAmountToBorrow;
              }

              //------------------------------- values for APR
              plan.borrowCost36 = AaveSharedLib.getCostForPeriodBefore(
                AaveSharedLib.State({
                  liquidityIndex: vars.rb.variableBorrowIndex,
                  lastUpdateTimestamp: uint(vars.rb.lastUpdateTimestamp),
                  rate: vars.rb.currentVariableBorrowRate
                }),
                plan.amountToBorrow,
              //predicted borrow ray after the borrow
                AaveTwoAprLib.getVariableBorrowRateRays(
                  vars.rb,
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
              / pd.rb10powDec;
              (, vars.totalStableDebt, vars.totalVariableDebt,,,,,,,) = vars.dataProvider.getReserveData(params.collateralAsset);

              // calculate supply-APR, see detailed explanation in Aave3AprLib
              plan.supplyIncomeInBorrowAsset36 = AaveSharedLib.getCostForPeriodBefore(
                AaveSharedLib.State({
                  liquidityIndex: vars.rc.liquidityIndex,
                  lastUpdateTimestamp: uint(vars.rc.lastUpdateTimestamp),
                  rate: vars.rc.currentLiquidityRate
                }),
                plan.collateralAmount,
                AaveTwoAprLib.getLiquidityRateRays(
                  vars.rc,
                  params.collateralAsset,
                  plan.collateralAmount,
                  vars.totalStableDebt,
                  vars.totalVariableDebt
                ),
                params.countBlocks,
                vars.blocksPerDay,
                block.timestamp, // assume, that we supply collateral in the current block
                1e18 // multiplier to increase result precision
              )
              // we need a value in terms of borrow tokens with decimals 18
              * 1e18 // we need decimals 36, but the result is already multiplied on 1e18 by multiplier above
              * pd.priceCollateral
              / pd.priceBorrow
              / pd.rc10powDec;

              plan.amountCollateralInBorrowAsset36 =
                plan.collateralAmount
                * 1e18
                * pd.priceCollateral
                / pd.priceBorrow
                * 1e18
                / pd.rc10powDec;
            }
          } // else either max borrow or max supply amount is zero
        } // else the borrowing is not enabled
      } // else the collateral is not allowed
    }

    if (plan.converter == address(0)) {
      AppDataTypes.ConversionPlan memory planNotFound;
      return planNotFound;
    } else {
      return plan;
    }
  }
  //endregion Get conversion plan

  //-----------------------------------------------------
  //region Utils
  //-----------------------------------------------------

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
    return data.getActive() && ! data.getFrozen();
  }
  //endregion Utils
}
