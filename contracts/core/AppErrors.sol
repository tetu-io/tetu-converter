// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

library AppErrors {
  /// @notice Provided address should be not zero
  string public constant ZERO_ADDRESS = "TC-1";
  /// @notice Pool adapter for the given set {converter, user, collateral, borrowToken} not found and cannot be created
  string public constant POOL_ADAPTER_NOT_FOUND = "TC-2";
  /// @notice Health factor is not set or it's less then min allowed value
  string public constant WRONG_HEALTH_FACTOR = "TC-3";
  /// @notice Received price is zero
  string public constant ZERO_PRICE = "TC-4";
  /// @notice Given platform adapter is not found in Borrow Manager
  string public constant PLATFORM_ADAPTER_NOT_FOUND = "TC-6";
  /// @notice Only pool adapters are allowed to make such operation
  string public constant POOL_ADAPTER_ONLY = "TC-7";
  /// @notice Only TetuConveter is allowed to make such operation
  string public constant TETU_CONVERTER_ONLY = "TC-8";
  /// @notice Only Governance is allowed to make such operation
  string public constant GOVERNANCE_ONLY = "TC-9";
  /// @notice Cannot close borrow position if the position has not zero collateral or borrow balance
  string public constant ATTEMPT_TO_CLOSE_NOT_EMPTY_BORROW_POSITION = "TC-10";
  /// @notice Borrow position is not registered in DebtMonitor
  string public constant BORROW_POSITION_IS_NOT_REGISTERED = "TC-11";
  /// @notice Passed arrays should have same length
  string public constant WRONG_LENGTHS = "TC-12";
  /// @notice Pool adapter expects some amount of collateral on its balance
  string public constant WRONG_COLLATERAL_BALANCE="TC-13";
  /// @notice Pool adapter expects some amount of derivative tokens on its balance after borrowing
  string public constant WRONG_DERIVATIVE_TOKENS_BALANCE="TC-14";
  /// @notice Pool adapter expects some amount of borrowed tokens on its balance
  string public constant WRONG_BORROWED_BALANCE="TC-15";
  /// @notice cToken is not found for provided underlying
  string public constant HF_DERIVATIVE_TOKEN_NOT_FOUND = "TC-16";
  /// @notice cToken.mint failed
  string public constant MINT_FAILED = "TC-17";
  string public constant COMPTROLLER_GET_ACCOUNT_LIQUIDITY_FAILED = "TC-18";
  string public constant COMPTROLLER_GET_ACCOUNT_LIQUIDITY_UNDERWATER = "TC-19";
  /// @notice borrow failed
  string public constant BORROW_FAILED = "TC-20";
  string public constant CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED = "TC-21";
  string public constant CTOKEN_GET_ACCOUNT_LIQUIDITY_FAILED = "TC-22";
  string public constant HF_INCORRECT_RESULT_LIQUIDITY = "TC-23";
  string public constant CLOSE_POSITION_FAILED = "TC-24";
  string public constant CONVERTER_NOT_FOUND = "TC-25";
  string public constant REDEEM_FAILED = "TC-26";
  string public constant REPAY_FAILED = "TC-27";
  /// @notice Balance shouldn't be zero
  string public constant ZERO_BALANCE="TC-28";
  string public constant INCORRECT_VALUE ="TC-29";
  /// @notice Only user can make this action
  string public constant USER_ONLY = "TC-30";
  /// @notice It's not allowed to close position with a pool adapter and make re-conversion using the same adapter
  string public constant RECONVERSION_WITH_SAME_CONVERTER_FORBIDDEN = "TC-31";

  string public constant USER_OR_TETU_CONVERTER_ONLY = "TC-32";

}