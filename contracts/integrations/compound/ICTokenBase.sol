// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./ICTokenCurrent.sol";

/// @notice Min common set of functions of Compound cTokens
/// required to implement platform and pool adapters
interface ICTokenBase is ICTokenCurrent {
  /// @notice Get cash balance of this mToken in the underlying asset
  /// @return The quantity of underlying asset owned by this contract
  function getCash() external view returns (uint256);

  /// @notice Total amount of outstanding borrows of the underlying in this market
  function totalBorrows() external view returns (uint256);

  function totalReserves() external view returns (uint256);

  /// @notice Model which tells what the current interest rate should be
  function interestRateModel() external view returns (address);

  /// @notice Fraction of interest currently set aside for reserves
  function reserveFactorMantissa() external view returns (uint256);

  function underlying() external view returns (address);

/// @notice Sender borrows assets from the protocol to their own address
  /// @param borrowAmount The amount of the underlying asset to borrow
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function borrow(uint256 borrowAmount) external returns (uint256);

  /// @notice Sender supplies assets into the market and receives mTokens in exchange
  /// @dev Accrues interest whether or not the operation succeeds, unless reverted
  /// @param mintAmount The amount of the underlying asset to supply
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function mint(uint256 mintAmount) external returns (uint256);

  /// @notice Sender repays their own borrow
  /// @param repayAmount The amount to repay
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function repayBorrow(uint256 repayAmount) external returns (uint256);

  /// @notice Sender redeems mTokens in exchange for the underlying asset
  /// @dev Accrues interest whether or not the operation succeeds, unless reverted
  /// @param redeemTokens The number of mTokens to redeem into underlying
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function redeem(uint256 redeemTokens) external returns (uint256);
}
