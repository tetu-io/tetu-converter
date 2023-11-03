// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice A part of CToken-interface for compound with rates-per-timestamp, i.e. Moonwell
interface ICTokenRatesPerTimestamp {
  /// @notice Block number that interest was last accrued at
  function accrualBlockTimestamp() external view returns (uint256);

  /// @notice Returns the current per-timestamp borrow interest rate for this cToken
  /// @return The borrow interest rate per timestamp, scaled by 1e18
  function borrowRatePerTimestamp() external view returns (uint256);

  /// @notice Returns the current per-timestamp supply interest rate for this mToken
  /// @return The supply interest rate per timestmp, scaled by 1e18
  function supplyRatePerTimestamp() external view returns (uint256);
}
