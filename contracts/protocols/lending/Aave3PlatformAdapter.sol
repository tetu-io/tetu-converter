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
    uint borrowRatePerBlockWAD,
    uint16 collateralFactorWAD,
    uint maxAmountToBorrowBT
  ) {
    IAavePool pool = IAavePool(pool_);
    if (_isCollateralEnabled(pool, collateralAsset_)) {

    }

//    DataTypes.ReserveData memory rb = IAavePool(pool_).getReserveData(borrowAsset_);
//    //if (rc.configuration.getActive() && ! rc.configuration.getPaused() )
//
//    // Check if collateral asset is allowed to be used as collateral
//
//    // Isolation mode
//
//    // High efficiency mode
//
//
//    // The liquidation threshold is the percentage at which a loan is defined as undercollateralised.
//    uint liquidationThreshold =  // percentage, i.e. 8500 for 85%
//      rd.configuration.data & ~LIQUIDATION_THRESHOLD_MASK >> LIQUIDATION_THRESHOLD_START_BIT_POSITION;
//    console.log("liquidationThreshold %d data=%d", liquidationThreshold, rd.configuration.data);
//
//    // assume here, that we always use variable borrow rate
//    uint br = rd.currentVariableBorrowRate; // [rays]
//    console.log("currentVariableBorrowRate %d", rd.currentVariableBorrowRate);
//
//    // we need to know available liquidity of {underline_} in the pool
//    // so, we need an access to pool-data-provider
//    // TODO: can we use static address of the PoolDataProvider - 0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654 ?
//    // TODO: see https://docs.aave.com/developers/deployed-contracts/v3-mainnet/polygon
//    IAaveAddressesProvider aap = IAaveAddressesProvider(IAavePool(pool_).ADDRESSES_PROVIDER());
//    IAaveProtocolDataProvider dp = IAaveProtocolDataProvider(aap.getPoolDataProvider());
//
//    console.log("aTokenTotalSupply.1");
//    // TODO: how to get total available liquidity correctly?
//    uint aTokenTotalSupply = dp.getATokenTotalSupply(underline_);
//    console.log("aTokenTotalSupply = %d", aTokenTotalSupply);
//    console.log("br = %d", br * 10**18 );
//    console.log("br = %d", br * 10**18 / 10**27);
//    console.log("collateralFactor = %d", liquidationThreshold * 10**14);
//
////    return (
////      br * 10**18 / 10**27, // rays => decimals 18 (1 ray = 1e-27)
////    liquidationThreshold * 10**14, // 8500 => 0.85 with decimals 18
////      aTokenTotalSupply
////    );

    return (borrowRateKind, borrowRatePerBlockWAD, collateralFactorWAD, maxAmountToBorrowBT);
  }

  /// @notice Check if the collateral 1) active 2) not frozen 3) can be used as collateral 4) not paused
  /// @dev Some assets cannot be used as collateral: https://docs.aave.com/risk/asset-risk/risk-parameters#collaterals
  function _isCollateralEnabled(IAavePool pool_, address collateralAsset_) public view returns (bool) {
    DataTypes.ReserveData memory rc = IAavePool(pool_).getReserveData(collateralAsset_);
    return rc.configuration.getActive()
      && ! rc.configuration.getFrozen()
      // can be used as collateral, see AaveProtocolDataProvider.getReserveConfigurationData impl
      && rc.configuration.getLiquidationThreshold() != 0
      && ! rc.configuration.getPaused();
  }
}