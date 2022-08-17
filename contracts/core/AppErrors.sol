// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

library AppErrors {
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
  /// @notice Passed arrays should have same length
  string public constant WRONG_LENGTHS = "12";
  /// @notice Pool adapter expects some amount of collateral on its balance
  string public constant WRONG_COLLATERAL_BALANCE="13";
  /// @notice Pool adapter expects some amount of derivative tokens on its balance after borrowing
  string public constant WRONG_DERIVATIVE_TOKENS_BALANCE="14";
  /// @notice Pool adapter expects some amount of borrowed tokens on its balance
  string public constant WRONG_BORROWED_BALANCE="15";
  /// @notice cToken is not found for provided underlying
  string public constant HF_DERIVATIVE_TOKEN_NOT_FOUND = "16";
  /// @notice cToken.mint failed
  string public constant MINT_FAILED = "17";
  string public constant COMPTROLLER_GET_ACCOUNT_LIQUIDITY_FAILED = "18";
  string public constant COMPTROLLER_GET_ACCOUNT_LIQUIDITY_UNDERWATER = "19";
  /// @notice borrow failed
  string public constant BORROW_FAILED = "20";
  string public constant CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED = "21";
  string public constant CTOKEN_GET_ACCOUNT_LIQUIDITY_FAILED = "22";
  string public constant HF_INCORRECT_RESULT_LIQUIDITY = "23";
  string public constant CLOSE_POSITION_FAILED = "24";
  string public constant CONVERTER_NOT_FOUND = "25";
  string public constant REDEEM_FAILED = "26";
  string public constant REPAY_FAILED = "27";
  /// @notice Balance shouldn't be zero
  string public constant ZERO_BALANCE="28";
  string public constant INCORRECT_VALUE ="29";
  /// @notice Only user can make this action
  string public constant USER_ONLY = "30";
  /// @notice It's not allowed to close position with a pool adapter and make re-conversion using the same adapter
  string public constant RECONVERSION_WITH_SAME_CONVERTER_FORBIDDEN = "31";

}