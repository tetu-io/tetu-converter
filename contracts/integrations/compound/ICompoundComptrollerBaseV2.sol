// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./ICompoundComptrollerBase.sol";

/// @notice ICompoundComptrollerBase + markets() implemented by ComptrollerV2Storage
///         Supported by Compound >= v2.8
interface ICompoundComptrollerBaseV2 is ICompoundComptrollerBase {

  /// @return isListed represents whether the comptroller recognizes this cToken
  /// @return collateralFactorMantissa scaled by 1e18, is multiplied by a supply balance to determine how much value can be borrowed
  /// @return Whether or not this market receives COMP
  function markets(address) external view returns (
    bool isListed,
    uint256 collateralFactorMantissa,
    bool isComped
  );
}

