import "../../interfaces/IPlatformAdapter.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../integrations/aave/IAavePool.sol";
import "../../integrations/aave/IAaveAddressesProvider.sol";
import "../../integrations/aave/IAaveProtocolDataProvider.sol";

/// @notice Adapter to read current pools info from AAVE-protocol, see https://docs.aave.com/hub/
contract AavePlatformAdapter is IPlatformAdapter {
  using SafeERC20 for IERC20;

  /// @dev See aave-v3-core ReserveConfiguration.sol for other ready masks
  uint256 internal immutable LIQUIDATION_THRESHOLD_MASK = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000FFFF;

  /// @notice Get pool data required to select best lending pool
  /// @param pool_ = comptroller
  /// @return borrowRatePerBlock Normalized borrow rate can include borrow-rate-per-block + any additional fees
  /// @return collateralFactor Current collateral factor [0..1e18], where 1e18 is corresponded to CF=1
  /// @return availableCash Available underline in the pool. 0 if the market is unlisted
  function getPoolInfo(address pool_, address underline_)
  external
  view override returns (
    uint borrowRatePerBlock,
    uint collateralFactor,
    uint availableCash
  ) {

    // https://docs.aave.com/risk/asset-risk/risk-parameters#collaterals
    DataTypes.ReserveData memory rd = IAavePool(pool_).getReserveData(underline_);

    // The liquidation threshold is the percentage at which a loan is defined as undercollateralised.
    uint liquidationThreshold = rd.configuration.data & ~LIQUIDATION_THRESHOLD_MASK; // percentage, i.e. 8500 for 85%

    // assume here, that we always use variable borrow rate
    uint128 br = rd.currentVariableBorrowRate; // [rays]

    // we need to know available liquidity of {underline_} in the pool
    // so, we need an access to pool-data-provider
    IAaveAddressesProvider aap = IAaveAddressesProvider(IAavePool(pool_).ADDRESSES_PROVIDER());
    IAaveProtocolDataProvider dp = IAaveProtocolDataProvider(aap.getPoolDataProvider());
    (uint256 borrowCap, ) = dp.getReserveCaps(underline_);

    return (
      br * 1e18 / 1e24, // rays => decimals 18
      collateralFactor * 1e14, // 8500 => 0.85 with decimals 18
      borrowCap
    );
  }
}