import "../../interfaces/IPlatformAdapter.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../integrations/aave/IAavePool.sol";
import "../../integrations/aave/IAaveAddressesProvider.sol";
import "../../integrations/aave/IAaveProtocolDataProvider.sol";
import "hardhat/console.sol";

/// @notice Adapter to read current pools info from AAVE-protocol, see https://docs.aave.com/hub/
contract AavePlatformAdapter is IPlatformAdapter {
  using SafeERC20 for IERC20;

  /// @dev See aave-v3-core ReserveConfiguration.sol for other ready masks
  uint256 internal immutable LIQUIDATION_THRESHOLD_MASK =    0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000FFFF;
  uint256 internal constant ACTIVE_MASK =                    0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFF;
  uint256 internal constant FROZEN_MASK =                    0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFDFFFFFFFFFFFFFF;
  uint256 internal constant BORROWING_MASK =                 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFBFFFFFFFFFFFFFF;

  uint256 internal immutable LIQUIDATION_THRESHOLD_START_BIT_POSITION = 16;


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
    console.log("getPoolInfo %s %s", pool_, underline_);
    // TODO is paused? is borrow enabled?

    // https://docs.aave.com/risk/asset-risk/risk-parameters#collaterals
    DataTypes.ReserveData memory rd = IAavePool(pool_).getReserveData(underline_);

    // The liquidation threshold is the percentage at which a loan is defined as undercollateralised.
    uint liquidationThreshold =  // percentage, i.e. 8500 for 85%
      rd.configuration.data & ~LIQUIDATION_THRESHOLD_MASK >> LIQUIDATION_THRESHOLD_START_BIT_POSITION;
    console.log("liquidationThreshold %d data=%d", liquidationThreshold, rd.configuration.data);

    // assume here, that we always use variable borrow rate
    uint br = rd.currentVariableBorrowRate; // [rays]
    console.log("currentVariableBorrowRate %d", rd.currentVariableBorrowRate);

    // we need to know available liquidity of {underline_} in the pool
    // so, we need an access to pool-data-provider
    // TODO: can we use static address of the PoolDataProvider - 0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654 ?
    // TODO: see https://docs.aave.com/developers/deployed-contracts/v3-mainnet/polygon
    IAaveAddressesProvider aap = IAaveAddressesProvider(IAavePool(pool_).ADDRESSES_PROVIDER());
    IAaveProtocolDataProvider dp = IAaveProtocolDataProvider(aap.getPoolDataProvider());

    console.log("aTokenTotalSupply.1");
    // TODO: how to get total available liquidity correctly?
    uint aTokenTotalSupply = dp.getATokenTotalSupply(underline_);
    console.log("aTokenTotalSupply = %d", aTokenTotalSupply);
    console.log("br = %d", br * 10**18 );
    console.log("br = %d", br * 10**18 / 10**27);
    console.log("collateralFactor = %d", liquidationThreshold * 10**14);

    return (
      br * 10**18 / 10**27, // rays => decimals 18 (1 ray = 1e-27)
    liquidationThreshold * 10**14, // 8500 => 0.85 with decimals 18
      aTokenTotalSupply
    );
  }
}