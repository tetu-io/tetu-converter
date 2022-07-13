// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/DataTypes.sol";

/// @notice A facade for the set of availalbe lending platforms
interface IBorrowManager {
  function addPlatform(string calldata title, address decorator) external;
  function addPool(uint platformUid, address poolAddress, address[] calldata assets) external;

  /// @notice Find lending pool with best normalized borrow rate per ethereum block
  /// @return outPool Best pool or 0 if there is no suitable pool
  /// @return outBorrowRate Normalized borrow rate. It can include borrow-rate-per-block, additional fees, etc
  function getBestPool (
    address sourceToken,
    address targetToken
  ) external view returns (
    address outPool,
    uint outBorrowRate
  );

  /// @notice Calculate a collateral required to borrow {targetAmount} from the pool and get initial {healthFactor}
  function estimateSourceAmount(
    address pool,
    address sourceToken,
    address targetToken,
    uint targetAmount,
    uint96 healthFactor
  ) external view returns (
    uint outSourceAmount
  );

  /// @notice Calculate a target amount that can be borrowed from the pool using {sourceAmount} as collateral
  ///         with initial {healthFactor}
  function estimateTargetAmount(
    address pool,
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint96 healthFactor
  ) external view returns (
    uint outTargetAmount
  );

  /// @notice Estimate result health factor after borrowing {targetAmount} from the pool
  ///         using {sourceAmount} as collateral
  function estimateHealthFactor(
    address pool,
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount
  ) external view returns (
    uint96 outHealthFactor
  );

  /// @notice Borrow {targetAmount} from the pool using {sourceAmount} as collateral.
  /// @dev Result health factor cannot be less the default health factor specified for the target asset by governance.
  /// @param sourceToken Asset to be used as collateral
  /// @param sourceAmount Max available amount of collateral
  /// @param targetToken Asset to borrow
  /// @param targetAmount Required amount to borrow
  function borrow (
    address pool,
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount
  ) external;
}
