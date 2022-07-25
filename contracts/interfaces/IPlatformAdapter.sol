// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice A lending platform (AAVE, HF, etc). Allow to work with comptroller and any pool of the platform.
interface IPlatformAdapter {

  /// @notice Get pool data required to select best lending pool
  /// @param pool = comptroller
  /// @return borrowRatePerBlock Normalized borrow rate can include borrow-rate-per-block + any additional fees
  /// @return collateralFactor Current collateral factor [0..1e18], where 1e18 is corresponded to CF=1
  /// @return availableCash Available underline in the pool. 0 if the market is unlisted
  function getPoolInfo(address pool, address underline)
  external
  view
  returns (
    uint borrowRatePerBlock,
    uint collateralFactor,
    uint availableCash
  );
}
