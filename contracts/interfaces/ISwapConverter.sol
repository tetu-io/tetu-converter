// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";
import "./IConverter.sol";

interface ISwapConverter is IConverter {
  function getConversionKind()
  override external pure returns (AppDataTypes.ConversionKind);

  function swap(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_
  ) external returns (uint outputAmount);
}
