// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Min common set of functions of comptroller of Compound-based protocol
///         that are required in platform and pool adapters
interface ICompoundComptrollerBase {
  function oracle() external view returns (address);

  /// @notice Add assets to be included in account liquidity calculation
  /// @param cTokens The list of addresses of the cToken markets to be enabled
  /// @return Success indicator for whether each corresponding market was entered
  function enterMarkets(address[] memory cTokens) external returns (uint256[] memory);

  /// @notice Determine the current account liquidity wrt collateral requirements
  ///         Return (possible error code (semi-opaque),
  ///         account liquidity in excess of collateral requirements,
  ///         account shortfall below collateral requirements)
  function getAccountLiquidity(address account) external view returns (
    uint256 error,
    uint256 liquidity,
    uint256 shortfall
  );

  /// @return isListed represents whether the comptroller recognizes this cToken
  /// @return collateralFactorMantissa scaled by 1e18, is multiplied by a supply balance to determine how much value can be borrowed
  /// @return isComped indicates whether or not suppliers and borrowers are distributed COMP tokens.
  function markets(address) external view returns (
    bool isListed,
    uint256 collateralFactorMantissa,
    bool isComped // todo
  );

  /// @notice Borrow caps enforced by borrowAllowed for each cToken address. Defaults to zero which corresponds to unlimited borrowing.
  /// @dev https://github.com/compound-finance/compound-protocol/blob/master/contracts/ComptrollerStorage.sol
  function borrowCaps(address cToken) external view returns (uint256);
  function borrowGuardianPaused(address) external view returns (bool);
  function mintGuardianPaused(address) external view returns (bool);
}

