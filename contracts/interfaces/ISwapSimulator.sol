// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface ISwapSimulator {

  /// @notice Make real swap to know result amount
  ///         but exclude any additional operations
  ///         like "sending result amount to receiver" or "emitting any events".
  /// @dev This function should be called only inside static call to know result amount.
  /// @param user_ A strategy which has approved source amount to TetuConverter
  ///              and called a function findSwapStrategy
  /// @param sourceAmount_ Amount in terms of {sourceToken_} to be converter to {targetToken_}
  /// @return amountOut Result amount in terms of {targetToken_} after conversion
  function simulateSwap(
    address user_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external returns (
    uint amountOut
  );
}
