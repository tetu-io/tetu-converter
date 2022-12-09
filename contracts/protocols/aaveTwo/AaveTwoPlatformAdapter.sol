// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../core/AppDataTypes.sol";
import "../../core/AppUtils.sol";
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

  /// @notice Local vars inside _getConversionPlan - to avoid stack too deep
  struct LocalsGetConversionPlan {
    IAaveTwoPool poolLocal;
    IAaveTwoLendingPoolAddressesProvider addressProvider;
    IAaveTwoProtocolDataProvider dataProvider;
    IAaveTwoPriceOracle priceOracle;
    uint availableLiquidity;
    uint totalStableDebt;
    uint totalVariableDebt;
    uint blocksPerDay;
    uint priceCollateral;
    uint priceBorrow;
    /// @notice 10**rc.configuration.getDecimals()
    uint rc10powDec;
    /// @notice 10**rb.configuration.getDecimals()
    uint rb10powDec;
  }

  ///////////////////////////////////////////////////////
  ///         Variables
  ///////////////////////////////////////////////////////

  IController immutable public controller;
  IAaveTwoPool immutable public pool;
  /// @notice template-pool-adapter
  address immutable public converter;

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
    address poolAave_,
    address templateAdapterNormal_
  ) {
    require(
      poolAave_ != address(0)
      && templateAdapterNormal_ != address(0)
      && controller_ != address(0),
      AppErrors.ZERO_ADDRESS
    );
    pool = IAaveTwoPool(poolAave_);
    controller = IController(controller_);
    converter = templateAdapterNormal_;
  }

  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external override {
    require(msg.sender == controller.borrowManager(), AppErrors.BORROW_MANAGER_ONLY);
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
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint16 healthFactor2_,
    uint countBlocks_
  ) external view override returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    require(collateralAsset_ != address(0) && borrowAsset_ != address(0), AppErrors.ZERO_ADDRESS);
    require(collateralAmount_ != 0 && countBlocks_ != 0, AppErrors.INCORRECT_VALUE);
    require(healthFactor2_ >= controller.minHealthFactor2(), AppErrors.WRONG_HEALTH_FACTOR);

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

  function _getConversionPlan (
    AppDataTypes.ParamsGetConversionPlan memory params
  ) internal view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    LocalsGetConversionPlan memory vars;
    vars.poolLocal = pool;

    vars.addressProvider = IAaveTwoLendingPoolAddressesProvider(vars.poolLocal.getAddressesProvider());
    vars.dataProvider = IAaveTwoProtocolDataProvider(vars.addressProvider.getAddress(bytes32(ID_DATA_PROVIDER)));
    vars.priceOracle = IAaveTwoPriceOracle(vars.addressProvider.getPriceOracle());

    DataTypes.ReserveData memory rc = vars.poolLocal.getReserveData(params.collateralAsset);

    if (_isUsable(rc.configuration) &&  _isCollateralUsageAllowed(rc.configuration)) {
      DataTypes.ReserveData memory rb = vars.poolLocal.getReserveData(params.borrowAsset);
      if (_isUsable(rb.configuration) && rb.configuration.getBorrowingEnabled()) {
        vars.rc10powDec = 10**rc.configuration.getDecimals();
        vars.rb10powDec = 10**rb.configuration.getDecimals();

        // get liquidation threshold (== collateral factor) and loan-to-value (LTV)
        // we should use both LTV and liquidationThreshold of collateral asset (not borrow asset)
        // see test "Borrow: check LTV and liquidationThreshold"
        plan.ltv18 = uint(rc.configuration.getLtv()) * 10**(18-4);
        plan.liquidationThreshold18 = uint(rc.configuration.getLiquidationThreshold()) * 10**(18-4);
        plan.converter = converter;

        // prepare to calculate supply/borrow APR
        vars.blocksPerDay = controller.blocksPerDay();
        vars.priceCollateral = vars.priceOracle.getAssetPrice(params.collateralAsset);
        vars.priceBorrow = vars.priceOracle.getAssetPrice(params.borrowAsset);

        // we assume here, that required health factor is configured correctly
        // and it's greater than h = liquidation-threshold (LT) / loan-to-value (LTV)
        // otherwise AAVE-pool will revert the borrow
        // see comment to IBorrowManager.setHealthFactor
        plan.amountToBorrow =
            100 * params.collateralAmount / uint(params.healthFactor2)
            * plan.liquidationThreshold18
            * vars.priceCollateral
            / vars.priceBorrow
            * vars.rb10powDec
            / 1e18
            / vars.rc10powDec;
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
        / vars.rb10powDec;
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
        * vars.priceCollateral
        / vars.priceBorrow
        / vars.rc10powDec;
        plan.amountCollateralInBorrowAsset36 =
          params.collateralAmount
          * 1e18
          * vars.priceCollateral
          / vars.priceBorrow
          * 1e18
          / vars.rc10powDec;
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
