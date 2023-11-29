// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

/// @notice isPoolAdapter returns always expected value
contract BorrowManagerStub {
  bool public valueIsPoolAdapter;
  address public resultGetPoolAdapter;
  constructor (bool valueIsPoolAdapter_) {
    valueIsPoolAdapter = valueIsPoolAdapter_;
  }
  function isPoolAdapter(address) external view returns (bool) {
    return valueIsPoolAdapter;
  }

  function setIsPoolAdapter(bool valueIsPoolAdapter_) external {
    valueIsPoolAdapter = valueIsPoolAdapter_;
  }

  function setPoolAdapter(address resultGetPoolAdapter_) external {
    resultGetPoolAdapter = resultGetPoolAdapter_;
  }

  function getPoolAdapter(
    address converter_,
    address user_,
    address collateral_,
    address borrowToken_
  ) external view returns (address) {
    converter_;
    user_;
    collateral_;
    borrowToken_;
    return resultGetPoolAdapter;
  }

  function markPoolAdapterAsDirty (
    address converter_,
    address user_,
    address collateral_,
    address borrowToken_
  ) external pure {
    converter_;
    user_;
    collateral_;
    borrowToken_;
  }

}

