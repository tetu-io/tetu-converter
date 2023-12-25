// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./ICompoundComptrollerBase.sol";

/// @notice ICompoundComptrollerBase + markets() implemented by ComptrollerV2Storage
///         In Zerovix markets() returns collateralFactorMantissa in last value
///         Supported by Compound >= v2.8
interface ICompoundComptrollerBaseV2Zerovix is ICompoundComptrollerBase {

  /// @return isListed represents whether the comptroller recognizes this cToken
  /// @return autoCollaterize markets marked with autoCollaterize are automatically set as collateral for the user at the first mint
  /// @return collateralFactorMantissa scaled by 1e18, is multiplied by a supply balance to determine how much value can be borrowed
  /// Multiplier representing the most one can borrow against their collateral in this market.
  /// For instance, 0.9 to allow borrowing 90% of collateral value.
  /// Must be between 0 and 1, and stored as a mantissa.
  function markets(address) external view returns (
    bool isListed,
    bool autoCollaterize,
    uint256 collateralFactorMantissa
  );
}

