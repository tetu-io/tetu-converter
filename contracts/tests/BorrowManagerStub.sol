// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice isPoolAdapter returns always expected value
contract BorrowManagerStub {
  bool public valueIsPoolAdapter;
  constructor (bool valueIsPoolAdapter_) {
    valueIsPoolAdapter = valueIsPoolAdapter_;
  }
  function isPoolAdapter(address) external view returns (bool) {
    return valueIsPoolAdapter;
  }
}

