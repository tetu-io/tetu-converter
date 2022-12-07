// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice TetuConverter supports this interface
///         It's called by SwapManager inside static-call swap simulation
///         to transfer amount approved to TetuConverter by user to SwapManager
///         before calling swap simulation
interface IClaimAmountCallback {
  /// @notice Transfer {sourceAmount_} approved by {sourceAmountApprover_} to swap manager
  function onRequireAmount(
    address sourceAmountApprover_,
    address sourceToken_,
    uint sourceAmount_
  ) external;
}