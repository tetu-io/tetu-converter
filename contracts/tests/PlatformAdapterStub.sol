// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Return predefined list of converters
contract PlatformAdapterStub {
  address[] _converters;
  constructor (address[] memory converters_) {
    for (uint i = 0; i < converters_.length; ++i) {
      _converters.push(converters_[i]);
    }
  }
  function converters() external view returns (address[] memory) {
    return _converters;
  }
}

