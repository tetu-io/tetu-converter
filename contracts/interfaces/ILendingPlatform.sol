// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/DataTypes.sol";

/// @notice A lending platform. Allow to borrow a loan and repay it back.
interface ILendingPlatform {

  /// @notice Get normalized borrow rate per block, scaled by 1e18
  /// @dev Normalized borrow rate can include borrow-rate-per-block + any additional fees
  function getBorrowRate(
    address pool,
    address sourceToken,
    address targetToken
  ) external view returns (uint);

  function borrow(
    address pool,
    DataTypes.BorrowParams calldata params
  ) external;

  /// @notice get data of the pool
  /// @param pool = comptroller
  /// @return outCollateralFactor Current collateral factor [0..1e18], where 1e18 is corresponded to CF=1
  function getPoolInfo(address pool, address underline) external view returns (uint outCollateralFactor);

  /// @notice get data of the underline of the pool
  /// @param pool = comptroller
  /// @return outLiquidity Amount of the underlying token that is unborrowed in the pool
  function getAssetInfo(address pool, address underline) external view returns (uint outLiquidity);
}
