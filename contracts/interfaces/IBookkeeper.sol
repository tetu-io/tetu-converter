// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IBookkeeper {
  /// @notice Register a new loan
  /// @dev This function can be called by a pool adapter only
  /// @param collateralAmount Amount of supplied collateral for the new loan
  /// @param borrowedAmount Borrowed amount provided for the given {collateralAmount}
  function onBorrow(uint collateralAmount, uint borrowedAmount) external;

  /// @notice Register loan payment
  /// @dev This function can be called by a pool adapter only
  /// @param withdrawnCollateral Amount of collateral received by the user during the repaying.
  /// @param paidAmount Amount paid by the user during the repaying.
  function onRepay(uint withdrawnCollateral, uint paidAmount) external;


  /// @notice Save checkpoint for all pool adapters of the given {user_}
  /// @return deltaGains Total amount of gains for the {tokens_} by all pool adapter
  /// @return deltaLosses Total amount of losses for the {tokens_} by all pool adapter
  function checkpoint(address[] memory tokens_) external returns (
    uint[] memory deltaGains,
    uint[] memory deltaLosses
  );

  /// @notice Calculate deltas that user would receive if he creates a checkpoint at the moment
  /// @return deltaGains Total amount of gains for the {tokens_} by all pool adapter
  /// @return deltaLosses Total amount of losses for the {tokens_} by all pool adapter
  function previewCheckpoint(address user, address[] memory tokens_) external view returns (
    uint[] memory deltaGains,
    uint[] memory deltaLosses
  );
}