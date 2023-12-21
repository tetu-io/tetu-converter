// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice All XXXCurrent functions of Compound cTokens
interface ICTokenCurrent {
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
}