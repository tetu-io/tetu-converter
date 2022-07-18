// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

library DataTypes {

  /// @notice Input params for BorroManager.findPool (stack is too deep problem)
  struct ExecuteFindPoolParams {
    /// @notice if 0 than default health factor specified for the target asset will be used
    uint96 healthFactorOptional;

    address sourceToken;
    address targetToken;

    /// @notice Max possible collateral value in source tokens
    uint sourceAmount;
  }
}