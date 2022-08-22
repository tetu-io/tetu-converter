// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

library AppDataTypes {

  enum ConversionKind {
    UNKNOWN_0,
    SWAP_1,
    BORROW_2
  }

  /// @notice Input params for BorrowManager.findPool (stack is too deep problem)
  struct InputConversionParams {
    /// @notice if 0 than default health factor specified for the target asset will be used, decimals 2
    uint16 healthFactor2;

    address sourceToken;
    address targetToken;

    uint periodInBlocks;
    /// @notice Amount of {sourceToken} to be converted to {targetToken}
    uint sourceAmount;
  }

  /// @notice Explain how a given pool can make specified conversion
  struct ConversionPlan {
    /// @notice Template adapter contract that implements required strategy.
    address converter;
    /// @notice Current collateral factor [0..1e18], where 1e18 is corresponded to CF=1
    /// TODO: probably we need to use different decimals for the collateral factor to reduce size of this struct
    uint liquidationThreshold18;
    /// @notice APR per 1 block (normalized borrow rate, borrow-rate + any fees), decimals = 18
    uint aprPerBlock18;
    /// @notice Loan-to-value, decimals = 18 (wad)
    /// TODO: uint16? see aave..
    uint ltv18;
    /// @notice How much borrow asset we can borrow in the pool (in borrow tokens)
    uint maxAmountToBorrowBT;
    /// @notice How much collateral asset can be supplied (in collateral tokens).
    ///         type(uint).max - unlimited, 0 - no supply is possible
    uint maxAmountToSupplyCT;
  }
}