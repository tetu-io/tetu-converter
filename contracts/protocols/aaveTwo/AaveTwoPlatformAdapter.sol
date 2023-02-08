// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../core/AppDataTypes.sol";
import "../../core/AppUtils.sol";
import "../../core/EntryKinds.sol";
import "../../interfaces/IPlatformAdapter.sol";
import "../../interfaces/IPoolAdapterInitializer.sol";
import "../../interfaces/IController.sol";
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

  ///////////////////////////////////////////////////////
  ///   Constants
  ///////////////////////////////////////////////////////

  /// @notice https://docs.aave.com/developers/v/2.0/the-core-protocol/protocol-data-provider
  ///        Each market has a separate Protocol Data Provider.
  ///        To get the address for a particular market, call getAddress() using the value 0x1.
  uint internal constant ID_DATA_PROVIDER = 0x1000000000000000000000000000000000000000000000000000000000000000;

  ///////////////////////////////////////////////////////
  ///   Data types
  ///////////////////////////////////////////////////////

  /// @notice Local vars inside getConversionPlan - to avoid stack too deep
  struct LocalsGetConversionPlan {
    IAaveTwoPool poolLocal;
    IAaveTwoLendingPoolAddressesProvider addressProvider;
    IAaveTwoProtocolDataProvider dataProvider;
    IAaveTwoPriceOracle priceOracle;
    uint availableLiquidity;
    uint totalStableDebt;
    uint totalVariableDebt;
    uint blocksPerDay;
    uint healthFactor18;
    IController controller;
  }

  ///////////////////////////////////////////////////////
  ///         Variables
  ///////////////////////////////////////////////////////

  IController immutable public controller;
  IAaveTwoPool immutable public pool;
  /// @notice template-pool-adapter
  address immutable public converter;
  /// @dev Same as controller.borrowManager(); we cache it for gas optimization
  address immutable public borrowManager;

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
    controller = IController(controller_);
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

  ///////////////////////////////////////////////////////
  ///              View
  ///////////////////////////////////////////////////////

  function converters() external view override returns (address[] memory) {
    address[] memory dest = new address[](1);
    dest[0] = converter;
    return dest;
  }

  ///////////////////////////////////////////////////////
  ///           Get conversion plan
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

      vars.addressProvider = IAaveTwoLendingPoolAddressesProvider(vars.poolLocal.getAddressesProvider());
      vars.dataProvider = IAaveTwoProtocolDataProvider(vars.addressProvider.getAddress(bytes32(ID_DATA_PROVIDER)));
      vars.priceOracle = IAaveTwoPriceOracle(vars.addressProvider.getPriceOracle());

      DataTypes.ReserveData memory rc = vars.poolLocal.getReserveData(params.collateralAsset);

      if (_isUsable(rc.configuration) &&  _isCollateralUsageAllowed(rc.configuration)) {
        DataTypes.ReserveData memory rb = vars.poolLocal.getReserveData(params.borrowAsset);
        if (_isUsable(rb.configuration) && rb.configuration.getBorrowingEnabled()) {
          pd.rc10powDec = 10**rc.configuration.getDecimals();
          pd.rb10powDec = 10**rb.configuration.getDecimals();

          // get liquidation threshold (== collateral factor) and loan-to-value (LTV)
          // we should use both LTV and liquidationThreshold of collateral asset (not borrow asset)
          // see test "Borrow: check LTV and liquidationThreshold"
          plan.ltv18 = uint(rc.configuration.getLtv()) * 10**(18-4);
          plan.liquidationThreshold18 = uint(rc.configuration.getLiquidationThreshold()) * 10**(18-4);
          plan.converter = converter;

          // prepare to calculate supply/borrow APR
          vars.blocksPerDay = vars.controller.blocksPerDay();
          pd.priceCollateral = vars.priceOracle.getAssetPrice(params.collateralAsset);
          pd.priceBorrow = vars.priceOracle.getAssetPrice(params.borrowAsset);

          // AAVE has min allowed health factor at the borrow moment: liquidationThreshold18/LTV, i.e. 0.85/0.8=1.06...
          // Target health factor can be smaller but it's not possible to make a borrow with such low health factor
          // see explanation of health factor value in IController.sol
          vars.healthFactor18 = plan.liquidationThreshold18 * 1e18 / plan.ltv18;
          if (vars.healthFactor18 < uint(healthFactor2_) * 10**(18 - 2)) {
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

          // availableLiquidity is IERC20(borrowToken).balanceOf(atoken)
          (vars.availableLiquidity, vars.totalStableDebt, vars.totalVariableDebt,,,,,,,) = vars.dataProvider.getReserveData(params.borrowAsset);

          plan.maxAmountToBorrow = vars.availableLiquidity;
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
          //predicted borrow ray after the borrow
            AaveTwoAprLib.getVariableBorrowRateRays(
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
          / pd.rb10powDec;
          (, vars.totalStableDebt, vars.totalVariableDebt,,,,,,,) = vars.dataProvider.getReserveData(params.collateralAsset);

          plan.maxAmountToSupply = type(uint).max; // unlimited
          // calculate supply-APR, see detailed explanation in Aave3AprLib
          plan.supplyIncomeInBorrowAsset36 = AaveSharedLib.getCostForPeriodBefore(
            AaveSharedLib.State({
              liquidityIndex: rc.liquidityIndex,
              lastUpdateTimestamp: uint(rc.lastUpdateTimestamp),
              rate: rc.currentLiquidityRate
            }),
            params.collateralAmount,
            AaveTwoAprLib.getLiquidityRateRays(
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
          // we need a value in terms of borrow tokens with decimals 18
          * 1e18 // we need decimals 36, but the result is already multiplied on 1e18 by multiplier above
          * pd.priceCollateral
          / pd.priceBorrow
          / pd.rc10powDec;
          plan.amountCollateralInBorrowAsset36 =
            params.collateralAmount
            * 1e18
            * pd.priceCollateral
            / pd.priceBorrow
            * 1e18
            / pd.rc10powDec;
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
    DataTypes.ReserveData memory rb = pool.getReserveData(borrowAsset_);
    (, uint totalStableDebt, uint totalVariableDebt,,,,,,,) = IAaveTwoProtocolDataProvider(
      IAaveTwoLendingPoolAddressesProvider(pool.getAddressesProvider()).getAddress(bytes32(ID_DATA_PROVIDER))
    ).getReserveData(borrowAsset_);

    return AaveTwoAprLib.getVariableBorrowRateRays(
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
}
