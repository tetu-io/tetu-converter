// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

library AppDataTypes {

  /// @notice Kind of borrow rate
  ///         I.e. AAVE calculates borrow-rate per second
  ///              Compound calculates borrow-rate per block
  enum BorrowRateKind {
    UNKNOWN_0,
    PER_BLOCK_1,
    PER_SECOND_2
  }

  /// @notice Input params for BorroManager.findPool (stack is too deep problem)
  struct ExecuteFindPoolParams {
    /// @notice if 0 than default health factor specified for the target asset will be used
    uint96 healthFactorOptional;

    address sourceToken;
    address targetToken;

    /// @notice Max possible collateral value in source tokens
    uint sourceAmount;
  }

  /// @notice Explain how a given pool can make specified conversion
  struct ConversionPlan {
    /// @notice Template adapter contract that implements required strategy.
    address poolAdapterTemplate;
    /// @notice Kind of {borrowRatePerBlockWAD}. 0 if the borrow is not possible
    BorrowRateKind borrowRateKind;
    /// @notice Current collateral factor [0..1e18], where 1e18 is corresponded to CF=1
    /// TODO: probably we need to use different decimals for the collateral factor to reduce size of this struct
    uint collateralFactorWAD;
    /// @notice Normalized borrow rate (borrow-rate + any fees), decimals = 18 (wad)
    /// TODO: uint128? see aave
    uint borrowRate;
    /// @notice Loan-to-value, decimals = 18 (wad)
    /// TODO: uint16? see aave..
    uint ltvWAD;
    /// @notice How much borrow asset we can borrow in the pool (in borrow tokens)
    uint maxAmountToBorrowBT;
    /// @notice How much collateral asset can be supplied (in collateral tokens). 0 - unlimited
    uint maxAmountToSupplyCT;
  }
}