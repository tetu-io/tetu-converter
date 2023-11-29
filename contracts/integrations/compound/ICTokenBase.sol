// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Min common set of functions of Compound cTokens
/// required to implement platform and pool adapters
interface ICTokenBase {
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

  /// @notice Accrue interest to updated borrowIndex and then calculate account's borrow balance using the updated borrowIndex
  /// @param account The address whose balance should be calculated after updating borrowIndex
  /// @return The calculated balance
  function borrowBalanceCurrent(address account) external returns (uint256);

  /// @notice Accrue interest then return the up-to-date exchange rate
  /// @return Calculated exchange rate scaled by 1e18
  function exchangeRateCurrent() external returns (uint256);

  /// @notice Get a snapshot of the account's balances, and the cached exchange rate
  /// @dev This is used by comptroller to more efficiently perform liquidity checks.
  /// @param account Address of the account to snapshot
  function getAccountSnapshot(address account) external view returns (
    uint256 errorCode,
    uint256 tokenBalance,
    uint256 borrowBalance,
    uint256 exchangeRateMantissa
  );

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
