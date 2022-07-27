// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Allow to borrow given asset from the given pool using given asset as collateral.
///         There is Template-Pool-Adapter contract for each platform (AAVE, HF, etc).
///         This contract is used as a source by minimal-proxy pattern to create Pool-Adapters.
interface IPoolAdapter2 {

  function initialize(
    address controller_,
    address pool_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external;

  /// @notice Supply collateral to the pool and borrow specified amount
  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) external;

  /// @notice Repay borrowed amount, return collateral to the user
  /// @param closePosition true to pay full borrowed amount
  function repay(
    uint amountToRepay_,
    address receiver_,
    bool closePosition
  ) external;

  function getConfig() external view returns (
    address pool,
    address user,
    address collateralAsset,
    address borrowAsset
  );

  /// @notice Get current status of the borrow position
  /// @return collateralAmount Total amount of provided collateral in [collateral asset]
  /// @return amountsToPay Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
  /// @return healthFactor Current health factor
  function getStatus() external view returns (
    uint collateralAmount,
    uint amountsToPay,
    uint healthFactor
  );
}