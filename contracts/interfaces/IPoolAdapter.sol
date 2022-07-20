// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Allow to work with specified pool of the platform.
///         There is Template-Pool-Adapter contract for each platform (AAVE, HF, etc).
///         This contract is used as a source by minimal-proxy pattern to create Pool-Adapters.
interface IPoolAdapter {

  function initialize(address pool_, address user_, address collateralUnderline_) external;

  function collateralToken() external view returns (address);
  function collateralFactor() external view returns (uint);
  function pool() external view returns (address);

  /// @notice Supply collateral to the pool and borrow {borrowedAmount_} in {borrowedToken_}
  function borrow(
    uint collateralAmount_,
    address borrowedToken_,
    uint borrowedAmount_,
    address receiverBorrowedAmount_
  ) external;

  /// @notice How much we should pay to close the borrow
  function getAmountToRepay(address borrowedToken_) external view returns (uint);

  /// @notice Repay borrowed amount, return collateral to the user
  function repay(
    address borrowedToken_,
    uint borrowedAmount_,
    address receiverCollateralAmount_
  ) external;

  function getOpenedPositions() external view returns (
    address[] memory borrowedTokens,
    uint[] memory collateralAmounts,
    uint[] memory amountsToRepay,
    uint[] memory healthFactors
  );
}