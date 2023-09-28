// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice A part of CToken-interface for compound with rates-per-block, i.e. Hundred finance
interface ICTokenRatesPerBlock {
  /// @notice Block number that interest was last accrued at
  function accrualBlockNumber() external view returns (uint256);

  /// @notice Returns the current per-block borrow interest rate for this cToken
  /// @return The borrow interest rate per block, scaled by 1e18
  function borrowRatePerBlock() external view returns (uint256);

  /// @notice Returns the current per-block supply interest rate for this cToken
  /// @return The supply interest rate per block, scaled by 1e18
  function supplyRatePerBlock() external view returns (uint256);
}
