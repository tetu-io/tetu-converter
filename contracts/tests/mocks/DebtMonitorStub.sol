// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

/// @notice isConverterInUse returns always expected value
contract DebtMonitorStub {
  bool public valueIsConverterInUse;
  constructor (bool valueIsConverterInUse_) {
    valueIsConverterInUse = valueIsConverterInUse_;
  }
  function isConverterInUse(address) external view returns (bool) {
    return valueIsConverterInUse;
  }
}

