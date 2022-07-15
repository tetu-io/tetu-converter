// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/DataTypes.sol";

/// @notice A lending platform. Allow to borrow a loan and repay it back.
interface ILendingPlatform {

  /// @notice Transfer {amount_} of {underlineToken_} from sender to pool, transfer cTokens to sender
  function supply(address pool_, address underlineToken_, uint amount_) external;

  function borrow(
    address pool,
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount
  ) external;

  /// @notice get data of the pool
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
