// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../core/AppDataTypes.sol";

interface IConverter {
  function getConversionKind() external pure returns (
    AppDataTypes.ConversionKind
  );
}
