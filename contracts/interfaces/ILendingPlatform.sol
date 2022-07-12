// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./ILendingDataTypes.sol";

/// @notice A lending platform. Allow to borrow a loan and repay it back.
interface ILendingPlatform is ILendingDataTypes {

  /// @notice Estimate borrowing results
  /// @param sourceToken Asset to be used as collateral
  /// @param sourceAmount Max available amount of collateral
  /// @param targetToken Asset to borrow
  /// @param targetAmount Required amount to borrow
  /// @param minHealthFactor Minimal allowed health factor, decimals 18
  /// @param borrowDurationInBlocks Estimated duration of the borrowing in count of Ethereum blocks
  /// @return outCollateralAmount Required amount of collateral <= sourceAmount
  /// @return outEstimatedAmountToRepay How much target tokens should be paid at the end of the borrowing
  /// @return outErrorMessage A reason why the borrowing cannot be made; empty for success
  function buildBorrowPlan(
    address sourceToken,
    address sourceAmount,
    address targetToken,
    address targetAmount,
    uint256 minHealthFactor,
    uint256 borrowDurationInBlocks
  ) external view returns (
    uint outCollateralAmount,
    uint outEstimatedAmountToRepay,
    string memory outErrorMessage
  );
}
