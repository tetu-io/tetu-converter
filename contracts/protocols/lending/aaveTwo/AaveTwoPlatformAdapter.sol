// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../../openzeppelin/SafeERC20.sol";
import "../../../openzeppelin/IERC20.sol";
import "../../../core/AppDataTypes.sol";
import "../../../core/AppErrors.sol";
import "../../../interfaces/IPlatformAdapter.sol";
import "../../../interfaces/IPoolAdapterInitializer.sol";
import "../../../interfaces/IController.sol";
import "../../../integrations/aaveTwo/IAaveTwoPool.sol";
import "../../../integrations/aaveTwo/IAaveTwoLendingPoolAddressesProvider.sol";
import "../../../integrations/aaveTwo/IAaveTwoPriceOracle.sol";
import "../../../integrations/aaveTwo/IAaveTwoProtocolDataProvider.sol";
import "../../../integrations/aaveTwo/IAaveTwoAToken.sol";
import "../../../integrations/aaveTwo/AaveTwoReserveConfiguration.sol";
import "../../../integrations/aaveTwo/IAaveTwoReserveInterestRateStrategy.sol";
import "./AaveTwoAprLib.sol";

/// @notice Adapter to read current pools info from AAVE-v2-protocol, see https://docs.aave.com/hub/
contract AaveTwoPlatformAdapter is IPlatformAdapter {
  using SafeERC20 for IERC20;
  using AaveTwoReserveConfiguration for DataTypes.ReserveConfigurationMap;

  IController public controller;
  IAaveTwoPool public pool;
  IAaveTwoPriceOracle internal _priceOracle;

  /// @notice template-pool-adapter
  address public converter;

  /// @notice https://docs.aave.com/developers/v/2.0/the-core-protocol/protocol-data-provider
  ///        Each market has a separate Protocol Data Provider.
  ///        To get the address for a particular market, call getAddress() using the value 0x1.
  uint internal constant ID_DATA_PROVIDER = 0x1000000000000000000000000000000000000000000000000000000000000000;

  ///////////////////////////////////////////////////////
  ///       Data types
  ///////////////////////////////////////////////////////
  /// @notice Local vars inside _getConversionPlan - to avoid stack too deep
  struct LocalsGetConversionPlan {
    IAaveTwoPool poolLocal;
    uint availableLiquidity;
    uint totalStableDebt;
    uint totalVariableDebt;
    uint amountToBorrow;
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
    address templateAdapterNormal_
  ) {
    require(poolAave_ != address(0)
      && templateAdapterNormal_ != address(0)
      && controller_ != address(0)
    , AppErrors.ZERO_ADDRESS);

    pool = IAaveTwoPool(poolAave_);
    _priceOracle = IAaveTwoPriceOracle(IAaveTwoLendingPoolAddressesProvider(pool.getAddressesProvider()).getPriceOracle());

    controller = IController(controller_);
    converter = templateAdapterNormal_;
  }

  ///////////////////////////////////////////////////////
  ///              View
  ///////////////////////////////////////////////////////

  function converters() external view override returns (address[] memory) {
    address[] memory dest = new address[](1);
    dest[0] = converter;
    return dest;
  }

  /// @notice Returns the prices of the supported assets in BASE_CURRENCY of the market. Decimals 18
  /// @dev Different markets can have different BASE_CURRENCY
  function getAssetsPrices(address[] calldata assets) external view override returns (uint[] memory prices18) {
    return _priceOracle.getAssetsPrices(assets);
  }

  ///////////////////////////////////////////////////////
  ///           Get conversion plan
  ///////////////////////////////////////////////////////

  function getConversionPlan (
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint borrowAmountFactor_,
    uint countBlocks_
  ) external view override returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    LocalsGetConversionPlan memory vars;
    vars.poolLocal = pool;

    DataTypes.ReserveData memory rc = vars.poolLocal.getReserveData(collateralAsset_);

    if (_isUsable(rc.configuration) &&  _isCollateralUsageAllowed(rc.configuration)) {
      DataTypes.ReserveData memory rb = vars.poolLocal.getReserveData(borrowAsset_);

      if (_isUsable(rc.configuration) && rb.configuration.getBorrowingEnabled()) {
        // get liquidation threshold (== collateral factor) and loan-to-value
        plan.ltv18 = uint(rb.configuration.getLtv()) * 10**(18-4);
        plan.liquidationThreshold18 = uint(rc.configuration.getLiquidationThreshold()) * 10**(18-4);
        plan.converter = converter;

        // prepare to calculate supply/borrow APR
        vars.amountToBorrow = plan.liquidationThreshold18 * borrowAmountFactor_ / 1e18;
        vars.blocksPerDay = IController(controller).blocksPerDay();
        vars.assets = new address[](2);
        vars.assets[0] = collateralAsset_;
        vars.assets[1] = borrowAsset_;
        vars.prices = _priceOracle.getAssetsPrices(vars.assets);

        // availableLiquidity is IERC20(borrowToken).balanceOf(atoken)
        (vars.availableLiquidity, vars.totalStableDebt, vars.totalVariableDebt,,,,,,,) = IAaveTwoProtocolDataProvider(
          IAaveTwoLendingPoolAddressesProvider(vars.poolLocal.getAddressesProvider())
            .getAddress(bytes32(ID_DATA_PROVIDER))
        ).getReserveData(borrowAsset_);

        plan.maxAmountToBorrowBT = vars.availableLiquidity;

        plan.borrowApr18 = AaveSharedLib.getAprForPeriodBefore(
          AaveSharedLib.State({
            liquidityIndex: rb.variableBorrowIndex,
            lastUpdateTimestamp: uint(rb.lastUpdateTimestamp),
            rate: rb.currentVariableBorrowRate
          }),
          vars.amountToBorrow,
        //predicted borrow ray after the borrow
          AaveTwoAprLib.getVariableBorrowRateRays(
            rb,
            borrowAsset_,
            vars.amountToBorrow,
            vars.totalStableDebt,
            vars.totalVariableDebt
          ),
          countBlocks_,
          vars.blocksPerDay,
          vars.prices[1], // borrow price
          block.timestamp // assume, that we make borrow in the current block
        );


        (, vars.totalStableDebt, vars.totalVariableDebt,,,,,,,) = IAaveTwoProtocolDataProvider(
          IAaveTwoLendingPoolAddressesProvider(vars.poolLocal.getAddressesProvider())
            .getAddress(bytes32(ID_DATA_PROVIDER))
        ).getReserveData(collateralAsset_);

        plan.maxAmountToSupplyCT = type(uint).max; // unlimited

        // calculate supply-APR, see detailed explanation in Aave3AprLib
        plan.supplyApr18 = AaveSharedLib.getAprForPeriodBefore(
          AaveSharedLib.State({
            liquidityIndex: rc.liquidityIndex,
            lastUpdateTimestamp: uint(rc.lastUpdateTimestamp),
            rate: rc.currentLiquidityRate
          }),
          collateralAmount_,
          AaveTwoAprLib.getLiquidityRateRays(
            rc,
            collateralAsset_,
            collateralAmount_,
            vars.totalStableDebt,
            vars.totalVariableDebt
          ),
          countBlocks_,
          vars.blocksPerDay,
          vars.prices[0], // collateral price
          block.timestamp // assume, that we supply collateral in the current block
        )
        // we need a value in terms of borrow tokens,
        * vars.prices[0] / vars.prices[1];
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