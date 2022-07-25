import "../../interfaces/IPlatformAdapter.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";

/// @notice Adapter to read current pools info from AAVE-protocol, see https://docs.aave.com/hub/
contract AavePlatformAdapter is IPlatformAdapter {
  using SafeERC20 for IERC20;

  /// @notice Get pool data required to select best lending pool
  /// @param pool = comptroller
  /// @return borrowRatePerBlock Normalized borrow rate can include borrow-rate-per-block + any additional fees
  /// @return collateralFactor Current collateral factor [0..1e18], where 1e18 is corresponded to CF=1
  /// @return availableCash Available underline in the pool. 0 if the market is unlisted
  function getPoolInfo(address pool, address underline)
  external
  view override returns (
    uint borrowRatePerBlock,
    uint collateralFactor,
    uint availableCash
  ) {
    //TODO
    return (borrowRatePerBlock, collateralFactor, availableCash);
  }
}