import "../../interfaces/IPlatformAdapter2.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../integrations/aave/IAavePool.sol";
import "../../integrations/aave/IAaveAddressesProvider.sol";
import "../../integrations/aave/IAaveProtocolDataProvider.sol";
import "../../integrations/aave/ReserveConfiguration.sol";
import "hardhat/console.sol";

/// @notice Adapter to read current pools info from AAVE-protocol v3, see https://docs.aave.com/hub/
contract Aave3PlatformAdapter is IPlatformAdapter2 {
  using SafeERC20 for IERC20;
  using ReserveConfiguration for DataTypes.ReserveConfigurationMap;

  function getPoolInfo (
    address pool_,
    address collateralAsset_,
    address borrowAsset_
  ) external view override returns (
    BorrowRateKind borrowRateKind,
    uint borrowRate,
    uint ltvWAD,
    uint collateralFactorWAD,
    uint maxAmountToBorrowBT,
    uint maxAmountToSupplyCT
  ) {
    IAavePool pool = IAavePool(pool_);
    DataTypes.ReserveData memory rc = IAavePool(pool_).getReserveData(collateralAsset_);

    if (_isUsable(rc.configuration) &&  _isCollateralUsageAllowed(rc.configuration)) {
      DataTypes.ReserveData memory rb = IAavePool(pool_).getReserveData(borrowAsset_);

      if (_isUsable(rc.configuration) && rb.configuration.getBorrowingEnabled()) {

        { // get liquidation threshold (== collateral factor) and loan-to-value
          uint8 categoryCollateral = uint8(rc.configuration.getEModeCategory());
          if (categoryCollateral != 0 && categoryCollateral == rb.configuration.getEModeCategory()) {

            // if both assets belong to the same e-mode-category, we can use category's ltv (higher than default)
            // TODO: we assume here, that e-mode is always used if it's available
            DataTypes.EModeCategory memory categoryData = pool.getEModeCategoryData(categoryCollateral);

            // ltv: 8500 for 0.85, we need decimals 18.
            ltvWAD = categoryData.ltv * 10**(18-5);
            collateralFactorWAD = categoryData.liquidationThreshold * 10**(18-5);
          } else {
            ltvWAD = rb.configuration.getLtv() * 10**(18-5);
            collateralFactorWAD = rb.configuration.getLiquidationThreshold() * 10**(18-5);
          }
        }
        console.log("collateralFactorWAD %d ltvWAD=%d", collateralFactorWAD, ltvWAD);

       // assume here, that we always use variable borrow rate
        borrowRate = rb.currentVariableBorrowRate / 10**(27-18); // rays => decimals 18 (1 ray = 1e-27)
        borrowRateKind = BorrowRateKind.PER_SECOND_2;
        console.log("currentVariableBorrowRate %d", borrowRate);

        // we need to know available liquidity in the pool, so, we need an access to pool-data-provider
        // TODO: can we use static address of the PoolDataProvider - 0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654 ?
        // TODO: see https://docs.aave.com/developers/deployed-contracts/v3-mainnet/polygon
        IAaveProtocolDataProvider dp = IAaveProtocolDataProvider(
          (IAaveAddressesProvider(IAavePool(pool_).ADDRESSES_PROVIDER())).getPoolDataProvider()
        );

        { // by default, we can borrow all available cache
          (,,
          uint256 totalAToken,
          uint256 totalStableDebt,
          uint256 totalVariableDebt
          ,,,,,,,) = dp.getReserveData(borrowAsset_);
          maxAmountToBorrowBT = totalAToken - totalStableDebt - totalVariableDebt;
          console.log("maxAmountToBorrowBT = %d", maxAmountToBorrowBT);
        }

        { // take into account borrow cap and supply cap
          uint borrowCap = rb.configuration.getBorrowCap();
          if (borrowCap < maxAmountToSupplyCT) {
            maxAmountToSupplyCT = borrowCap;
          }
        }

        maxAmountToSupplyCT = rb.configuration.getSupplyCap();
      }
    }

    return (borrowRateKind, borrowRate, ltvWAD, collateralFactorWAD, maxAmountToBorrowBT, maxAmountToSupplyCT);
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
}