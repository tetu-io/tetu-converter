// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./IConverter.sol";

/// @notice Allow to borrow given asset from the given pool using given asset as collateral.
///         There is Template-Pool-Adapter contract for each platform (AAVE, HF, etc).
/// @dev Terms: "pool adapter" is an instance of "converter" created using minimal-proxy-pattern
interface IPoolAdapter is IConverter {
  /// @dev Must be called before borrow (true) or repay/reconvert (false) to sync current balances
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

  /// @return originConverter Address of original PoolAdapter contract that was cloned to make the instance of the pool adapter
  function getConfig() external view returns (
    address originConverter,
    address user,
    address collateralAsset,
    address borrowAsset
  );

  /// @notice Get current status of the borrow position
  /// @return collateralAmount Total amount of provided collateral, collateral currency
  /// @return amountToPay Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
  /// @return healthFactor18 Current health factor, decimals 18
  /// @return opened The position is opened (there is not empty collateral/borrow balance)
  function getStatus() external view returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened
  );

  /// @notice Compute current APR value, decimals 18
  /// @return Interest * 1e18, i.e. 2.25e18 means APR=2.25%
  function getAPR18() external view returns (int);


  /// @notice Check if any reward tokens exist on the balance of the pool adapter
  function hasRewards() external view returns (bool);

  /// @notice Transfer all reward tokens to {receiver_}
  function claimRewards(address receiver_) external;
}