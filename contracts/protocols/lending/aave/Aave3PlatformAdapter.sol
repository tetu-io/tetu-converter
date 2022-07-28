import "../../../interfaces/IPlatformAdapter2.sol";
import "../../../openzeppelin/SafeERC20.sol";
import "../../../openzeppelin/IERC20.sol";
import "../../../integrations/aave/IAavePool.sol";
import "../../../integrations/aave/IAaveAddressesProvider.sol";
import "../../../integrations/aave/IAaveProtocolDataProvider.sol";
import "../../../integrations/aave/ReserveConfiguration.sol";
import "hardhat/console.sol";

/// @notice Adapter to read current pools info from AAVE-protocol v3, see https://docs.aave.com/hub/
contract Aave3PlatformAdapter is IPlatformAdapter2 {
  using SafeERC20 for IERC20;
  using ReserveConfiguration for DataTypes.ReserveConfigurationMap;

  IAavePool public pool;
  address public templateAdapterNormal;
  address public templateAdapterEMode;

  constructor (
    address poolAave_,
    address templateAdapterNormal_,
    address templateAdapterEMode_
  ) {
    require(poolAave_ != address(0), "zero address");
    require(templateAdapterNormal_ != address(0), "zero address");
    require(templateAdapterEMode_ != address(0), "zero address");

    pool = IAavePool(poolAave_);
    templateAdapterNormal = templateAdapterNormal_;
    templateAdapterEMode = templateAdapterEMode_;
  }

  function getPoolInfo (
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
              plan.ltvWAD = uint(categoryData.ltv) * 10**(18-5);
              plan.collateralFactorWAD = uint(categoryData.liquidationThreshold) * 10**(18-5);
              plan.poolAdapterTemplate = templateAdapterEMode;
            } else {
              plan.ltvWAD = rb.configuration.getLtv() * 10**(18-5);
              plan.collateralFactorWAD = rb.configuration.getLiquidationThreshold() * 10**(18-5);
              plan.poolAdapterTemplate = templateAdapterNormal;
            }
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

          { // take into account borrow cap, supply cap and debts ceiling
            uint borrowCap = rb.configuration.getBorrowCap();
            if (borrowCap != 0 && borrowCap < plan.maxAmountToBorrowBT) {
              plan.maxAmountToBorrowBT = borrowCap;
            }
          }

          plan.maxAmountToSupplyCT = rc.configuration.getSupplyCap();
        }
      }
    }

    return plan;
  }

  /// @notice Check if the asset can be used as a collateral
  /// @dev Some assets cannot be used as collateral: https://docs.aave.com/risk/asset-risk/risk-parameters#collaterals
  /// @param data DataTypes.ReserveData.configuration.data
  function _isCollateralUsageAllowed(DataTypes.ReserveConfigurationMap memory data) internal view returns (bool) {
    // see AaveProtocolDataProvider.getReserveConfigurationData impl
    return data.getLiquidationThreshold() != 0;
  }

  /// @notice Check if the asset active, not frozen, not paused
  /// @param data DataTypes.ReserveData.configuration.data
  function _isUsable(DataTypes.ReserveConfigurationMap memory data) internal view returns (bool) {
    return data.getActive() && ! data.getFrozen() && ! data.getPaused();
  }

  /// @notice Some assets can be used as collateral in isolation mode only
  /// @dev // see comment to getDebtCeiling(): The debt ceiling (0 = isolation mode disabled)
  function _isIsolationModeEnabled(DataTypes.ReserveConfigurationMap memory collateralData_)
  internal view returns (bool) {
    return collateralData_.getDebtCeiling() != 0;
  }

  /// @notice Only certain assets can be borrowed in isolation mode—specifically, approved stablecoins.
  /// @dev https://docs.aave.com/developers/whats-new/isolation-mode
  function _isUsableInIsolationMode(DataTypes.ReserveConfigurationMap memory borrowData) internal view returns (bool) {
    return borrowData.getBorrowableInIsolation();
  }
}