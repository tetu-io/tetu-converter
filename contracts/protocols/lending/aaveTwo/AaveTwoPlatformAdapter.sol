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

/// @notice Adapter to read current pools info from AAVE-v2-protocol, see https://docs.aave.com/hub/
contract AaveTwoPlatformAdapter is IPlatformAdapter {
  using SafeERC20 for IERC20;
  using AaveTwoReserveConfiguration for DataTypes.ReserveConfigurationMap;

  uint public COUNT_SECONDS_PER_YEAR = 31536000;

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
  ///       View
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
  ///       Get conversion plan
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
    // there are no rewards in AAVE3; this value is required by other platforms to predict the rewards correctly
    collateralAmount_;

    IAaveTwoPool poolLocal = pool;
    DataTypes.ReserveData memory rc = poolLocal.getReserveData(collateralAsset_);

    if (_isUsable(rc.configuration) &&  _isCollateralUsageAllowed(rc.configuration)) {
      DataTypes.ReserveData memory rb = poolLocal.getReserveData(borrowAsset_);

      if (_isUsable(rc.configuration) && rb.configuration.getBorrowingEnabled()) {
        // get liquidation threshold (== collateral factor) and loan-to-value
        plan.ltv18 = uint(rb.configuration.getLtv()) * 10**(18-4);
        plan.liquidationThreshold18 = uint(rc.configuration.getLiquidationThreshold()) * 10**(18-4);
        plan.converter = converter;

        // availableLiquidity is IERC20(borrowToken).balanceOf(atoken)
        (uint availableLiquidity, uint totalStableDebt, uint totalVariableDebt,,,,,,,) = IAaveTwoProtocolDataProvider(
          IAaveTwoLendingPoolAddressesProvider(poolLocal.getAddressesProvider()).getAddress(bytes32(ID_DATA_PROVIDER))
        ).getReserveData(borrowAsset_);

        plan.maxAmountToBorrowBT = availableLiquidity;
        plan.maxAmountToSupplyCT = type(uint).max; // unlimited

        { // calculate borrow rate
          // get both current BR and predict BR-value after borrowing of the required amount, take max value
          // assume here, that we always use variable borrow rate
          uint br = rb.currentVariableBorrowRate;
          if (borrowAmountFactor_ != 0) {
            uint brAfterBorrow = _br(borrowAsset_,
              rb,
            // calculate what amount will be borrowed
              borrowAmountFactor_ * plan.liquidationThreshold18 / 1e18,
              totalStableDebt,
              totalVariableDebt
            );
            if (brAfterBorrow > br) {
              br = brAfterBorrow;
            }
          }

          plan.brForPeriod18 = br
            * countBlocks_
            / COUNT_SECONDS_PER_YEAR
            * IController(controller).blocksPerDay() * 365 / COUNT_SECONDS_PER_YEAR
            / 10**(27-18); // rays => decimals 18 (1 ray = 1e-27)
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

    return _br(borrowAsset_, rb, amountToBorrow_, totalStableDebt, totalVariableDebt);
  }

  function _br(
    address borrowAsset_,
    DataTypes.ReserveData memory rd_,
    uint amountToBorrow_,
    uint256 totalStableDebt_,
    uint256 totalVariableDebt_
  ) internal view returns (uint variableBorrowRate) {
    // see aave-v2-core, DefaultReserveInterestRateStrategy, calculateInterestRates impl
    // to calculate new BR, we need to reduce liquidity on borrowAmount and increase the debt on the same amount
    (,,variableBorrowRate) = IAaveTwoReserveInterestRateStrategy(rd_.interestRateStrategyAddress)
      .calculateInterestRates(
        borrowAsset_,
        rd_.aTokenAddress,
        0,
        amountToBorrow_,
        totalStableDebt_,
        totalVariableDebt_ + amountToBorrow_,
        rd_.currentStableBorrowRate, // this value is not used to calculate variable BR
        rd_.configuration.getReserveFactor()
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