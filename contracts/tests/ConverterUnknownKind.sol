// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IPoolAdapter.sol";

contract ConverterUnknownKind is IConverter {
  function getConversionKind() external override pure returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.UNKNOWN_0;
  }
}