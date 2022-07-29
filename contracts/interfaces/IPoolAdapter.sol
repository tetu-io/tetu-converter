// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./IConverter.sol";

/// @notice Allow to borrow given asset from the given pool using given asset as collateral.
///         There is Template-Pool-Adapter contract for each platform (AAVE, HF, etc).
/// @dev Terms: "pool adapter" is an instance of "converter" created using minimal-proxy-pattern
interface IPoolAdapter is IConverter {
  /// @dev Must be called before borrow (true) or repay (false) to sync current balances
  function syncBalance(bool beforeBorrow) external;

  /// @notice Supply collateral to the pool and borrow specified amount
  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) external;

  /// @notice Repay borrowed amount, return collateral to the user
  /// @param closePosition_ true to pay full borrowed amount
  function repay(
    uint amountToRepay_,
    address receiver_,
    bool closePosition_
  ) external;

  function getConfig() external view returns (
    address pool,
    address user,
    address collateralAsset,
    address borrowAsset
  );

  /// @notice Get current status of the borrow position
  /// @return collateralAmount Total amount of provided collateral in [collateral asset]
  /// @return amountToPay Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
  /// @return healthFactorWAD Current health factor, decimals 18
  function getStatus() external view returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactorWAD
  );
}