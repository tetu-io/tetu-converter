// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

/// @notice Implement configurable function of BorrowManager required in tests
contract BorrowManagerMock {

  //region ------------------------------------------- getPoolAdapter
  /// @notice keccak256(converter, user, collateral, borrow) => pool adapter
  mapping(uint => address) internal _setupGetPoolAdapter;

  function setupGetPoolAdapter(
    address converter_,
    address user_,
    address collateral_,
    address borrowToken_,
    address poolAdapter_
  ) external {
    _setupGetPoolAdapter[uint(keccak256(abi.encodePacked(converter_, user_, collateral_, borrowToken_)))] = poolAdapter_;
  }

  function getPoolAdapter(
    address converter_,
    address user_,
    address collateral_,
    address borrowToken_
  ) external view returns (
    address
  ) {
    return _setupGetPoolAdapter[uint(keccak256(abi.encodePacked(converter_, user_, collateral_, borrowToken_)))];
  }
  //endregion ------------------------------------------- getPoolAdapter

}
