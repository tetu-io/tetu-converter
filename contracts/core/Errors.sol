// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

library Errors {
  /// @notice Provided address should be not zero
  string public constant ZERO_ADDRESS = "1";
  /// @notice Pool adapter for the given set {converter, user, collateral, borrowToken} not found and cannot be created
  string public constant POOL_ADAPTER_NOT_FOUND = "2";
  /// @notice Health factor is not set or it's less then min allowed value
  string public constant WRONG_HEALTH_FACTOR = "3";
  /// @notice Received price is zero
  string public constant ZERO_PRICE = "4";
  /// @notice Given platform adapter is not found in Borrow Manager
  string public constant PLATFORM_ADAPTER_NOT_FOUND = "6";
  /// @notice Only pool adapters are allowed to make such operation
  string public constant POOL_ADAPTER_ONLY = "7";
  /// @notice Only TetuConveter is allowed to make such operation
  string public constant TETU_CONVERTER_ONLY = "8";
  /// @notice Only Governance is allowed to make such operation
  string public constant GOVERNANCE_ONLY = "9";
  /// @notice Cannot close borrow position if the position has not zero collateral or borrow balance
  string public constant ATTEMPT_TO_CLOSE_NOT_EMPTY_BORROW_POSITION = "10";
  /// @notice Borrow position is not registered in DebtMonitor
  string public constant BORROW_POSITION_IS_NOT_REGISTERED = "11";

}