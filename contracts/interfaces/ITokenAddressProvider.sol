// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @dev Compound comptroller doesn't allow to get underlying by cToken,
///      so platform adapter provider provides such function
interface ITokenAddressProvider {
  /// @notice Get cTokens by underlying
  function getCTokenByUnderlying(address token1, address token2)
  external view
  returns (address cToken1, address cToken2);
}