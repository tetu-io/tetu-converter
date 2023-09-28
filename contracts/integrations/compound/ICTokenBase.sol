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
}
