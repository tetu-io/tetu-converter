// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";
import "./IConverter.sol";

interface ISwapConverter is IConverter {
  function getConversionKind()
  override external pure returns (AppDataTypes.ConversionKind);

  function swap(AppDataTypes.InputConversionParams memory params, uint priceImpactTolerance)
  external returns (uint outputAmount);
}
