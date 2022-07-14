// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/DataTypes.sol";

/// @notice A facade for the set of availalbe lending platforms
interface IBorrowManager {
  function addPlatform(string calldata title, address decorator) external;
  function addPool(uint platformUid, address poolAddress, address[] calldata assets) external;

  /// @notice Find lending pool capable of providing {targetAmount} and having best normalized borrow rate
  /// @param sourceAmount Max possible collateral value is source tokens
  /// @param targetAmount Minimum required target amount; result outMaxTargetAmount must be greater
  /// @param healthFactorOptional if 0 than default health factor specified for the target asset will be used
  /// @return outPool Result pool or 0 if a pool is not found
  /// @return outBorrowRate Pool normalized borrow rate per ethereum block
  /// @return outMaxTargetAmount Max available target amount that we can borrow for collateral = {sourceAmount}
  function findPool(
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount,
    uint96 healthFactorOptional
  ) external view returns (
    address outPool,
    uint outBorrowRate,
    uint outMaxTargetAmount
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
