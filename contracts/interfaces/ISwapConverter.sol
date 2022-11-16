// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";
import "./IConverter.sol";

interface ISwapConverter is IConverter {
  function getConversionKind()
  override external pure returns (AppDataTypes.ConversionKind);

  /// @notice Swap {sourceAmount_} of {sourceToken_} to {targetToken_} and send result amount to {receiver_}
  /// @param targetAmount_ Amount that should be received after swapping.
  ///                      Result amount can be a bit different from the target amount because of slippage.
  /// @return outputAmount The amount that has been sent to the receiver
  function swap(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_
  ) external returns (uint outputAmount);
}
