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
}
