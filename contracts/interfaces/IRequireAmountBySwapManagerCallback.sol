// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice TetuConverter supports this interface
///         It's called by SwapManager inside static-call swap simulation
///         to transfer amount approved to TetuConverter by user to SwapManager
///         before calling swap simulation
interface IRequireAmountBySwapManagerCallback {
  /// @notice Transfer {sourceAmount_} approved by {approver_} to swap manager
  function onRequireAmountBySwapManager(address approver_, address sourceToken_, uint sourceAmount_) external;
}
